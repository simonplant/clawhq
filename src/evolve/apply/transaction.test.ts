import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { beginTransaction, withTransaction } from "./transaction.js";

let deployDir: string;

beforeEach(() => {
  deployDir = mkdtempSync(join(tmpdir(), "clawhq-tx-test-"));
});

afterEach(() => {
  rmSync(deployDir, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const abs = join(deployDir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

describe("beginTransaction + rollback", () => {
  it("restores file content after modification", () => {
    write("a.txt", "original");

    const tx = beginTransaction(deployDir, ["a.txt"]);
    writeFileSync(join(deployDir, "a.txt"), "modified");
    expect(readFileSync(join(deployDir, "a.txt"), "utf-8")).toBe("modified");

    tx.rollback();
    expect(readFileSync(join(deployDir, "a.txt"), "utf-8")).toBe("original");
  });

  it("deletes files that didn't exist before the transaction", () => {
    const tx = beginTransaction(deployDir, ["new-file.txt"]);
    writeFileSync(join(deployDir, "new-file.txt"), "created during tx");
    expect(existsSync(join(deployDir, "new-file.txt"))).toBe(true);

    tx.rollback();
    expect(existsSync(join(deployDir, "new-file.txt"))).toBe(false);
  });

  it("restores multiple files consistently", () => {
    write("a.txt", "A-original");
    write("b.txt", "B-original");

    const tx = beginTransaction(deployDir, ["a.txt", "b.txt", "c.txt"]);
    writeFileSync(join(deployDir, "a.txt"), "A-modified");
    writeFileSync(join(deployDir, "b.txt"), "B-modified");
    writeFileSync(join(deployDir, "c.txt"), "C-new");

    tx.rollback();
    expect(readFileSync(join(deployDir, "a.txt"), "utf-8")).toBe("A-original");
    expect(readFileSync(join(deployDir, "b.txt"), "utf-8")).toBe("B-original");
    expect(existsSync(join(deployDir, "c.txt"))).toBe(false);
  });

  it("is idempotent — second rollback is a no-op", () => {
    write("a.txt", "original");
    const tx = beginTransaction(deployDir, ["a.txt"]);
    writeFileSync(join(deployDir, "a.txt"), "modified");

    tx.rollback();
    tx.rollback(); // should not throw
    expect(readFileSync(join(deployDir, "a.txt"), "utf-8")).toBe("original");
  });

  it("dedupes paths passed to begin", () => {
    write("a.txt", "only-one");
    const tx = beginTransaction(deployDir, ["a.txt", "a.txt", "a.txt"]);
    expect(tx.paths).toEqual(["a.txt"]);
  });

  it("preserves file mode through rollback (no +x strip)", () => {
    write("tool.sh", "#!/bin/sh\necho hi");
    // Make it executable — the prior implementation restored mode 0o600 on
    // rollback regardless of the original mode. Now we preserve it.
    const toolPath = join(deployDir, "tool.sh");
    const { chmodSync } = require("node:fs") as typeof import("node:fs");
    chmodSync(toolPath, 0o755);

    const tx = beginTransaction(deployDir, ["tool.sh"]);
    writeFileSync(toolPath, "modified");
    chmodSync(toolPath, 0o644);

    tx.rollback();
    const mode = statSync(toolPath).mode & 0o777;
    expect(mode).toBe(0o755);
  });

});

describe("withTransaction", () => {
  it("commits writes on success", async () => {
    write("a.txt", "v1");

    await withTransaction(deployDir, ["a.txt"], async () => {
      writeFileSync(join(deployDir, "a.txt"), "v2");
    });

    expect(readFileSync(join(deployDir, "a.txt"), "utf-8")).toBe("v2");
  });

  it("rolls back on thrown error", async () => {
    write("a.txt", "v1");
    write("b.txt", "v1");

    await expect(
      withTransaction(deployDir, ["a.txt", "b.txt"], async () => {
        writeFileSync(join(deployDir, "a.txt"), "v2");
        writeFileSync(join(deployDir, "b.txt"), "v2");
        throw new Error("mid-transaction failure");
      }),
    ).rejects.toThrow("mid-transaction failure");

    expect(readFileSync(join(deployDir, "a.txt"), "utf-8")).toBe("v1");
    expect(readFileSync(join(deployDir, "b.txt"), "utf-8")).toBe("v1");
  });

  it("rolls back new files on error — deploy dir ends as it started", async () => {
    await expect(
      withTransaction(deployDir, ["fresh.txt"], async () => {
        writeFileSync(join(deployDir, "fresh.txt"), "created");
        throw new Error("validation failure after write");
      }),
    ).rejects.toThrow("validation failure");

    expect(existsSync(join(deployDir, "fresh.txt"))).toBe(false);
  });

  it("creates parent directories on rollback when restoring nested paths", async () => {
    write("dir1/dir2/a.txt", "original");

    await expect(
      withTransaction(deployDir, ["dir1/dir2/a.txt"], async () => {
        writeFileSync(join(deployDir, "dir1/dir2/a.txt"), "modified");
        // Simulate a rename/cleanup that removed the parent — rollback
        // must recreate it when restoring the file.
        rmSync(join(deployDir, "dir1/dir2/a.txt"));
        rmSync(join(deployDir, "dir1/dir2"), { recursive: true });
        throw new Error("boom");
      }),
    ).rejects.toThrow();

    expect(readFileSync(join(deployDir, "dir1/dir2/a.txt"), "utf-8")).toBe("original");
  });
});
