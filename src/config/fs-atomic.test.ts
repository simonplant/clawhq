import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeFileAtomic, WriteError } from "./fs-atomic.js";

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "clawhq-atomic-"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("writes content to the target path", () => {
    const path = join(sandbox, "hello.txt");
    writeFileAtomic(path, "hello world\n");
    expect(readFileSync(path, "utf-8")).toBe("hello world\n");
  });

  it("creates parent directories as needed", () => {
    const path = join(sandbox, "deep", "nested", "file.txt");
    writeFileAtomic(path, "ok");
    expect(readFileSync(path, "utf-8")).toBe("ok");
  });

  it("respects mode 0o600 for secret files", () => {
    const path = join(sandbox, "secret.env");
    writeFileAtomic(path, "X=y", 0o600);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("leaves no temp files on success", () => {
    const path = join(sandbox, "clean.txt");
    writeFileAtomic(path, "clean");
    const entries = readdirSync(sandbox);
    expect(entries).toEqual(["clean.txt"]);
  });

  it("does not clobber itself under rapid same-target writes", () => {
    // The old implementation used Date.now()+Math.random() for the temp
    // filename, which could collide across same-millisecond writes and
    // produce corrupt output. UUID temp names can't collide.
    const path = join(sandbox, "target.txt");
    for (let i = 0; i < 50; i++) {
      writeFileAtomic(path, `iteration-${i}`);
    }
    expect(readFileSync(path, "utf-8")).toBe("iteration-49");
    // No temp files left behind.
    const entries = readdirSync(sandbox);
    expect(entries).toEqual(["target.txt"]);
  });

  it("wraps underlying errors in WriteError with targetPath", () => {
    // Trigger a write error by targeting a path whose parent is a file.
    const blocker = join(sandbox, "blocker");
    writeFileAtomic(blocker, "x");
    const badPath = join(blocker, "child.txt"); // parent is a file, not a dir
    let caught: unknown;
    try {
      writeFileAtomic(badPath, "should fail");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WriteError);
    const wrapped = caught as WriteError;
    expect(wrapped.targetPath).toBe(badPath);
  });
});
