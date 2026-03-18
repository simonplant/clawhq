import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DoctorContext } from "../types.js";

import { identityHealthCheck } from "./identity-health.js";

function makeCtx(dir: string): DoctorContext {
  return {
    openclawHome: dir,
    configPath: join(dir, "openclaw.json"),
  };
}

describe("identityHealthCheck", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `doctor-identity-${Date.now()}`);
    await mkdir(join(tmpDir, "workspace"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("passes when no identity files exist", async () => {
    const ctx = makeCtx(tmpDir);
    const result = await identityHealthCheck.run(ctx);
    expect(result.status).toBe("pass");
    expect(result.message).toContain("No identity files found");
  });

  it("passes for healthy identity files", async () => {
    const ctx = makeCtx(tmpDir);
    await writeFile(join(tmpDir, "workspace", "AGENTS.md"), "Small healthy content");
    await writeFile(join(tmpDir, "workspace", "IDENTITY.md"), "Another healthy file");

    const result = await identityHealthCheck.run(ctx);
    expect(result.status).toBe("pass");
    expect(result.message).toContain("within budget");
  });

  it("warns when budget threshold exceeded", async () => {
    const ctx = makeCtx(tmpDir);
    // Write a very large file to exceed the 20K default budget
    const bigContent = Array(20000).fill("word").join(" ");
    await writeFile(join(tmpDir, "workspace", "AGENTS.md"), bigContent);

    const result = await identityHealthCheck.run(ctx);
    expect(result.status).toBe("warn");
    expect(result.message).toContain("Token budget");
  });

  it("warns when files are stale", async () => {
    const ctx = makeCtx(tmpDir);
    const filePath = join(tmpDir, "workspace", "AGENTS.md");
    await writeFile(filePath, "content");

    // Set mtime to 60 days ago
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await utimes(filePath, sixtyDaysAgo, sixtyDaysAgo);

    const result = await identityHealthCheck.run(ctx);
    expect(result.status).toBe("warn");
    expect(result.message).toContain("stale");
  });

  it("warns when contradictions found", async () => {
    const ctx = makeCtx(tmpDir);
    await writeFile(
      join(tmpDir, "workspace", "AGENTS.md"),
      "Act autonomously on all tasks.",
    );
    await writeFile(
      join(tmpDir, "workspace", "IDENTITY.md"),
      "Always ask for permission before acting.",
    );

    const result = await identityHealthCheck.run(ctx);
    expect(result.status).toBe("warn");
    expect(result.message).toContain("contradiction");
  });
});
