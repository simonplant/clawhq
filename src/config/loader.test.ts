import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { deepMerge, defaultConfig, loadConfig } from "./loader.js";

// ── deepMerge ───────────────────────────────────────────────────────────────

describe("deepMerge", () => {
  it("merges flat objects", () => {
    const result = deepMerge({ a: 1 }, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("later values override earlier", () => {
    const result = deepMerge({ a: 1 }, { a: 2 });
    expect(result).toEqual({ a: 2 });
  });

  it("deeply merges nested objects", () => {
    const result = deepMerge(
      { security: { posture: "standard", egress: "default" } },
      { security: { posture: "hardened" } },
    );
    expect(result).toEqual({
      security: { posture: "hardened", egress: "default" },
    });
  });

  it("replaces arrays entirely", () => {
    const result = deepMerge(
      { origins: ["a", "b"] },
      { origins: ["c"] },
    );
    expect(result).toEqual({ origins: ["c"] });
  });

  it("skips undefined values", () => {
    const result = deepMerge({ a: 1 }, { a: undefined, b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("merges three levels of precedence", () => {
    const defaults = { version: "1", security: { posture: "standard" }, cloud: { enabled: false } };
    const user = { security: { posture: "hardened" } };
    const project = { cloud: { enabled: true } };
    const result = deepMerge(defaults, user, project);
    expect(result).toEqual({
      version: "1",
      security: { posture: "hardened" },
      cloud: { enabled: true },
    });
  });
});

// ── defaultConfig ───────────────────────────────────────────────────────────

describe("defaultConfig", () => {
  it("returns sensible defaults", () => {
    const config = defaultConfig();
    expect(config.version).toBe("1");
    expect(config.installMethod).toBe("cache");
    expect(config.security?.posture).toBe("hardened");
    expect(config.cloud?.enabled).toBe(false);
    expect(config.cloud?.trustMode).toBe("paranoid");
  });
});

// ── loadConfig ──────────────────────────────────────────────────────────────

describe("loadConfig", () => {
  it("returns defaults when no config files exist", () => {
    const config = loadConfig({
      userConfigPath: "/nonexistent/user.yaml",
      projectConfigPath: "/nonexistent/project.yaml",
    });
    expect(config.version).toBe("1");
    expect(config.security?.posture).toBe("hardened");
  });

  it("merges user config over defaults", () => {
    const tmp = mkdtempSync(join(tmpdir(), "clawhq-test-"));
    const userPath = join(tmp, "user.yaml");
    writeFileSync(userPath, "security:\n  posture: paranoid\n");

    const config = loadConfig({
      userConfigPath: userPath,
      projectConfigPath: "/nonexistent/project.yaml",
    });
    expect(config.security?.posture).toBe("paranoid");
    expect(config.cloud?.enabled).toBe(false); // default preserved
  });

  it("project config overrides user config", () => {
    const tmp = mkdtempSync(join(tmpdir(), "clawhq-test-"));
    const userPath = join(tmp, "user.yaml");
    const projectPath = join(tmp, "project.yaml");
    writeFileSync(userPath, "security:\n  posture: paranoid\n");
    writeFileSync(projectPath, "security:\n  posture: standard\n");

    const config = loadConfig({
      userConfigPath: userPath,
      projectConfigPath: projectPath,
    });
    expect(config.security?.posture).toBe("standard");
  });

  it("preserves nested defaults not overridden", () => {
    const tmp = mkdtempSync(join(tmpdir(), "clawhq-test-"));
    const userPath = join(tmp, "user.yaml");
    writeFileSync(userPath, "cloud:\n  enabled: true\n");

    const config = loadConfig({
      userConfigPath: userPath,
      projectConfigPath: "/nonexistent/project.yaml",
    });
    expect(config.cloud?.enabled).toBe(true);
    expect(config.cloud?.trustMode).toBe("paranoid"); // default preserved
  });

  it("throws on invalid YAML", () => {
    const tmp = mkdtempSync(join(tmpdir(), "clawhq-test-"));
    const badPath = join(tmp, "bad.yaml");
    writeFileSync(badPath, "- this\n- is\n- an array not object");

    expect(() =>
      loadConfig({
        userConfigPath: badPath,
        projectConfigPath: "/nonexistent/project.yaml",
      }),
    ).toThrow("Expected object");
  });
});
