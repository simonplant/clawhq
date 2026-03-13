import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deepMerge, loadConfig } from "./loader.js";

describe("deepMerge", () => {
  it("merges flat objects", () => {
    const base = { a: 1, b: 2 };
    const override = { b: 3, c: 4 };
    expect(deepMerge(base, override)).toEqual({ a: 1, b: 3, c: 4 });
  });

  it("merges nested objects recursively", () => {
    const base = { nested: { a: 1, b: 2 } };
    const override: Record<string, unknown> = { nested: { b: 3 } };
    expect(deepMerge(base, override)).toEqual({ nested: { a: 1, b: 3 } });
  });

  it("overrides arrays entirely (no merge)", () => {
    const base = { arr: [1, 2] };
    const override = { arr: [3] };
    expect(deepMerge(base, override)).toEqual({ arr: [3] });
  });

  it("does not modify base object", () => {
    const base = { a: 1, nested: { b: 2 } };
    const baseCopy = JSON.parse(JSON.stringify(base));
    deepMerge(base, { a: 99, nested: { b: 99 } });
    expect(base).toEqual(baseCopy);
  });

  it("ignores undefined values in override", () => {
    const base = { a: 1, b: 2 };
    const override = { a: undefined, b: 3 };
    expect(deepMerge(base, override)).toEqual({ a: 1, b: 3 });
  });
});

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "clawhq-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns defaults when no config files exist", async () => {
    const config = await loadConfig({
      userConfigPath: join(tempDir, "nonexistent-user.yaml"),
      projectConfigPath: join(tempDir, "nonexistent-project.yaml"),
    });
    expect(config.security?.posture).toBe("hardened");
    expect(config.cloud?.enabled).toBe(false);
  });

  it("loads user config and merges with defaults", async () => {
    const userPath = join(tempDir, "user.yaml");
    await writeFile(userPath, "security:\n  posture: paranoid\n");

    const config = await loadConfig({
      userConfigPath: userPath,
      projectConfigPath: join(tempDir, "nonexistent.yaml"),
    });
    expect(config.security?.posture).toBe("paranoid");
    expect(config.cloud?.enabled).toBe(false); // default preserved
  });

  it("loads project config with highest precedence", async () => {
    const userPath = join(tempDir, "user.yaml");
    const projectPath = join(tempDir, "project.yaml");
    await writeFile(userPath, "security:\n  posture: paranoid\n");
    await writeFile(projectPath, "security:\n  posture: standard\n");

    const config = await loadConfig({
      userConfigPath: userPath,
      projectConfigPath: projectPath,
    });
    expect(config.security?.posture).toBe("standard"); // project wins
  });

  it("project config overrides user config but preserves non-overlapping keys", async () => {
    const userPath = join(tempDir, "user.yaml");
    const projectPath = join(tempDir, "project.yaml");
    await writeFile(
      userPath,
      "cloud:\n  enabled: true\n  token: user-token\n",
    );
    await writeFile(projectPath, "cloud:\n  enabled: false\n");

    const config = await loadConfig({
      userConfigPath: userPath,
      projectConfigPath: projectPath,
    });
    expect(config.cloud?.enabled).toBe(false); // project wins
    expect(config.cloud?.token).toBe("user-token"); // user preserved
  });

  it("handles empty YAML files gracefully", async () => {
    const emptyPath = join(tempDir, "empty.yaml");
    await writeFile(emptyPath, "");

    const config = await loadConfig({
      userConfigPath: emptyPath,
      projectConfigPath: join(tempDir, "nonexistent.yaml"),
    });
    expect(config.security?.posture).toBe("hardened"); // defaults intact
  });

  it("throws on malformed YAML", async () => {
    const badPath = join(tempDir, "bad.yaml");
    await writeFile(badPath, "invalid: yaml: content: [unterminated");

    await expect(
      loadConfig({
        userConfigPath: badPath,
        projectConfigPath: join(tempDir, "nonexistent.yaml"),
      }),
    ).rejects.toThrow();
  });
});
