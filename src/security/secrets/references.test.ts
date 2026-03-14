import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, beforeEach } from "vitest";

import { scanDanglingReferences } from "./references.js";

describe("scanDanglingReferences", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "refs-test-"));
  });

  it("finds ${SECRET_NAME} pattern in config files", async () => {
    await writeFile(
      join(tmpDir, "openclaw.json"),
      '{"api_key": "${MY_SECRET}"}',
    );

    const refs = await scanDanglingReferences("MY_SECRET", tmpDir);

    expect(refs).toHaveLength(1);
    expect(refs[0].file).toContain("openclaw.json");
    expect(refs[0].line).toBe(1);
    expect(refs[0].match).toBe("${MY_SECRET}");
  });

  it("finds $SECRET_NAME pattern (no braces)", async () => {
    await writeFile(
      join(tmpDir, "docker-compose.yml"),
      "environment:\n  - API_KEY=$MY_SECRET\n",
    );

    const refs = await scanDanglingReferences("MY_SECRET", tmpDir);

    expect(refs).toHaveLength(1);
    expect(refs[0].match).toBe("$MY_SECRET");
    expect(refs[0].line).toBe(2);
  });

  it("finds references in workspace subdirectories", async () => {
    await mkdir(join(tmpDir, "workspace"), { recursive: true });
    await writeFile(
      join(tmpDir, "workspace", "config.json"),
      '{"token": "${API_TOKEN}"}',
    );

    const refs = await scanDanglingReferences("API_TOKEN", tmpDir);

    expect(refs).toHaveLength(1);
    expect(refs[0].file).toContain("config.json");
  });

  it("returns empty array when no references found", async () => {
    await writeFile(join(tmpDir, "openclaw.json"), '{"name": "agent"}');

    const refs = await scanDanglingReferences("NONEXISTENT", tmpDir);

    expect(refs).toHaveLength(0);
  });

  it("does not match partial names", async () => {
    await writeFile(
      join(tmpDir, "openclaw.json"),
      '{"key": "${MY_SECRET_EXTENDED}"}',
    );

    const refs = await scanDanglingReferences("MY_SECRET", tmpDir);

    // ${MY_SECRET_EXTENDED} should NOT match MY_SECRET because the braces
    // pattern requires exact match, and the bare $ pattern requires word boundary
    expect(refs).toHaveLength(0);
  });

  it("finds multiple references across files", async () => {
    await writeFile(
      join(tmpDir, "openclaw.json"),
      '{"key": "${BOT_TOKEN}"}',
    );
    await writeFile(
      join(tmpDir, "docker-compose.yml"),
      "env:\n  - TOKEN=${BOT_TOKEN}\n  - OTHER=$BOT_TOKEN\n",
    );

    const refs = await scanDanglingReferences("BOT_TOKEN", tmpDir);

    expect(refs).toHaveLength(3);
  });

  it("handles missing directories gracefully", async () => {
    // No files created — workspace/ and configs/ don't exist
    const refs = await scanDanglingReferences("ANYTHING", tmpDir);

    expect(refs).toHaveLength(0);
  });
});
