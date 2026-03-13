import { chmod, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkEnvPermissions, enforceEnvPermissions } from "./permissions.js";

describe("checkEnvPermissions", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "perms-test-"));
  });

  afterEach(() => {
    // cleanup handled by OS
  });

  it("returns correct=true when permissions are 0600", async () => {
    const envPath = join(tmpDir, ".env");
    await writeFile(envPath, "SECRET=value");
    await chmod(envPath, 0o600);

    const result = await checkEnvPermissions(envPath);
    expect(result).not.toBeNull();
    expect(result?.correct).toBe(true);
    expect(result?.mode).toBe(0o600);
  });

  it("returns correct=false when permissions are wrong", async () => {
    const envPath = join(tmpDir, ".env");
    await writeFile(envPath, "SECRET=value");
    await chmod(envPath, 0o644);

    const result = await checkEnvPermissions(envPath);
    expect(result).not.toBeNull();
    expect(result?.correct).toBe(false);
  });

  it("returns null when file does not exist", async () => {
    const result = await checkEnvPermissions(join(tmpDir, "nonexistent"));
    expect(result).toBeNull();
  });
});

describe("enforceEnvPermissions", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "perms-test-"));
  });

  afterEach(() => {
    // cleanup handled by OS
  });

  it("changes permissions to 0600 and returns true", async () => {
    const envPath = join(tmpDir, ".env");
    await writeFile(envPath, "SECRET=value");
    await chmod(envPath, 0o644);

    const changed = await enforceEnvPermissions(envPath);
    expect(changed).toBe(true);

    const s = await stat(envPath);
    expect(s.mode & 0o777).toBe(0o600);
  });

  it("returns false when already 0600", async () => {
    const envPath = join(tmpDir, ".env");
    await writeFile(envPath, "SECRET=value");
    await chmod(envPath, 0o600);

    const changed = await enforceEnvPermissions(envPath);
    expect(changed).toBe(false);
  });

  it("throws when file does not exist", async () => {
    await expect(
      enforceEnvPermissions(join(tmpDir, "nonexistent")),
    ).rejects.toThrow();
  });
});
