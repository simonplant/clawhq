import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DoctorContext } from "../types.js";

import { filePermissionsCheck } from "./file-permissions.js";

describe("filePermissionsCheck", () => {
  let tmpDir: string;
  let workspacePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "doctor-perms-"));
    workspacePath = join(tmpDir, "workspace");
    await mkdir(workspacePath, { recursive: true });
  });

  afterEach(() => {
    // tmpDir cleanup handled by OS
  });

  function makeCtx(overrides: Partial<DoctorContext> = {}): DoctorContext {
    return {
      openclawHome: tmpDir,
      configPath: join(tmpDir, "openclaw.json"),
      ...overrides,
    };
  }

  it("passes when .env has correct permissions", async () => {
    const envPath = join(tmpDir, ".env");
    await writeFile(envPath, "SECRET=value");
    await chmod(envPath, 0o600);

    const result = await filePermissionsCheck.run(makeCtx({ envPath }));

    expect(result.status).toBe("pass");
  });

  it("fails when .env has wrong permissions", async () => {
    const envPath = join(tmpDir, ".env");
    await writeFile(envPath, "SECRET=value");
    await chmod(envPath, 0o644);

    const result = await filePermissionsCheck.run(makeCtx({ envPath }));

    expect(result.status).toBe("fail");
    expect(result.message).toContain("incorrect permissions");
  });

  it("fails when identity files are group-writable", async () => {
    const soulPath = join(workspacePath, "SOUL.md");
    await writeFile(soulPath, "# Identity");
    await chmod(soulPath, 0o666);

    const result = await filePermissionsCheck.run(makeCtx());

    expect(result.status).toBe("fail");
    expect(result.message).toContain("incorrect permissions");
  });

  it("passes when identity files have correct permissions", async () => {
    const soulPath = join(workspacePath, "SOUL.md");
    await writeFile(soulPath, "# Identity");
    await chmod(soulPath, 0o644);

    const result = await filePermissionsCheck.run(makeCtx());

    expect(result.status).toBe("pass");
  });

  it("fixes .env permissions", async () => {
    const envPath = join(tmpDir, ".env");
    await writeFile(envPath, "SECRET=value");
    await chmod(envPath, 0o644);

    const fixResult = await filePermissionsCheck.fix(makeCtx({ envPath }));

    expect(fixResult.fixed).toBe(true);
    expect(fixResult.message).toContain("Fixed permissions");

    // Verify the fix worked
    const checkResult = await filePermissionsCheck.run(makeCtx({ envPath }));
    expect(checkResult.status).toBe("pass");
  });

  it("fixes identity file permissions", async () => {
    const soulPath = join(workspacePath, "SOUL.md");
    await writeFile(soulPath, "# Identity");
    await chmod(soulPath, 0o666);

    const fixResult = await filePermissionsCheck.fix(makeCtx());

    expect(fixResult.fixed).toBe(true);

    // Verify the fix worked
    const checkResult = await filePermissionsCheck.run(makeCtx());
    expect(checkResult.status).toBe("pass");
  });

  it("reports no issues to fix when all permissions correct", async () => {
    const fixResult = await filePermissionsCheck.fix(makeCtx());

    expect(fixResult.fixed).toBe(true);
    expect(fixResult.message).toContain("No permission issues");
  });
});
