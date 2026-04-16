import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InvalidRuntimeConfigError, loadRuntimeConfig, saveRuntimeConfig } from "./runtime-config.js";

let testDir: string;
let configPath: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "clawhq-rtcfg-test-"));
  configPath = join(testDir, "openclaw.json");
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("loadRuntimeConfig", () => {
  it("loads a valid config", () => {
    writeFileSync(configPath, JSON.stringify({ gateway: { port: 18789 }, agent: { model: "gemma" } }));
    const cfg = loadRuntimeConfig(configPath);
    expect((cfg.gateway as { port: number }).port).toBe(18789);
  });

  it("throws when file is missing", () => {
    expect(() => loadRuntimeConfig(configPath)).toThrow(InvalidRuntimeConfigError);
    expect(() => loadRuntimeConfig(configPath)).toThrow(/does not exist/);
  });

  it("throws on malformed JSON", () => {
    writeFileSync(configPath, "{ not valid");
    expect(() => loadRuntimeConfig(configPath)).toThrow(/invalid JSON/i);
  });

  it("throws when root is a bare array", () => {
    writeFileSync(configPath, "[]");
    expect(() => loadRuntimeConfig(configPath)).toThrow(/array, expected object/);
  });

  it("throws when root is null", () => {
    writeFileSync(configPath, "null");
    expect(() => loadRuntimeConfig(configPath)).toThrow(/null, expected object/);
  });

  it("throws when root is a string", () => {
    writeFileSync(configPath, '"hello"');
    expect(() => loadRuntimeConfig(configPath)).toThrow(/string, expected object/);
  });

  it("error message points users at clawhq apply", () => {
    writeFileSync(configPath, "[]");
    expect(() => loadRuntimeConfig(configPath)).toThrow(/clawhq apply/);
  });
});

describe("saveRuntimeConfig", () => {
  it("writes canonical JSON with trailing newline", () => {
    saveRuntimeConfig(configPath, { k: "v" });
    const content = readFileSync(configPath, "utf-8");
    expect(content).toBe('{\n  "k": "v"\n}\n');
  });

  it("round-trips through load", () => {
    const cfg = { gateway: { port: 18789 }, tools: { accessGrants: [{ type: "user", value: "*" }] } };
    saveRuntimeConfig(configPath, cfg);
    expect(loadRuntimeConfig(configPath)).toEqual(cfg);
  });
});
