import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  envToObject,
  getEnvValue,
  parseEnv,
  readEnvFile,
  removeEnvValue,
  serializeEnv,
  setEnvValue,
  writeEnvFile,
} from "./env.js";

describe("parseEnv", () => {
  it("parses key-value pairs", () => {
    const result = parseEnv("FOO=bar\nBAZ=qux");
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({ type: "pair", key: "FOO", value: "bar" });
    expect(result.entries[1]).toEqual({ type: "pair", key: "BAZ", value: "qux" });
  });

  it("preserves comments", () => {
    const result = parseEnv("# This is a comment\nFOO=bar");
    expect(result.entries[0]).toEqual({ type: "comment", raw: "# This is a comment" });
    expect(result.entries[1]).toEqual({ type: "pair", key: "FOO", value: "bar" });
  });

  it("preserves blank lines", () => {
    const result = parseEnv("FOO=bar\n\nBAZ=qux");
    expect(result.entries).toHaveLength(3);
    expect(result.entries[1]).toEqual({ type: "blank", raw: "" });
  });

  it("strips surrounding quotes from values", () => {
    const result = parseEnv('FOO="bar"\nBAZ=\'qux\'');
    expect(result.entries[0]?.value).toBe("bar");
    expect(result.entries[1]?.value).toBe("qux");
  });

  it("handles values with equals signs", () => {
    const result = parseEnv("FOO=bar=baz");
    expect(result.entries[0]?.value).toBe("bar=baz");
  });

  it("treats malformed lines as comments", () => {
    const result = parseEnv("not a valid line");
    expect(result.entries[0]?.type).toBe("comment");
  });
});

describe("serializeEnv", () => {
  it("round-trips content preserving comments and ordering", () => {
    const input = "# Database config\nDB_HOST=localhost\n\n# API keys\nAPI_KEY=secret";
    const env = parseEnv(input);
    const output = serializeEnv(env);
    expect(output).toBe(input);
  });
});

describe("getEnvValue / setEnvValue / removeEnvValue", () => {
  it("gets an existing value", () => {
    const env = parseEnv("FOO=bar");
    expect(getEnvValue(env, "FOO")).toBe("bar");
  });

  it("returns undefined for missing key", () => {
    const env = parseEnv("FOO=bar");
    expect(getEnvValue(env, "MISSING")).toBeUndefined();
  });

  it("updates an existing value", () => {
    const env = parseEnv("FOO=bar");
    setEnvValue(env, "FOO", "newval");
    expect(getEnvValue(env, "FOO")).toBe("newval");
  });

  it("appends a new value", () => {
    const env = parseEnv("FOO=bar");
    setEnvValue(env, "NEW", "added");
    expect(getEnvValue(env, "NEW")).toBe("added");
    expect(env.entries).toHaveLength(2);
  });

  it("removes an existing value", () => {
    const env = parseEnv("FOO=bar\nBAZ=qux");
    const removed = removeEnvValue(env, "FOO");
    expect(removed).toBe(true);
    expect(getEnvValue(env, "FOO")).toBeUndefined();
    expect(env.entries).toHaveLength(1);
  });

  it("returns false when removing non-existent key", () => {
    const env = parseEnv("FOO=bar");
    expect(removeEnvValue(env, "MISSING")).toBe(false);
  });
});

describe("envToObject", () => {
  it("converts entries to plain object", () => {
    const env = parseEnv("# comment\nFOO=bar\n\nBAZ=qux");
    expect(envToObject(env)).toEqual({ FOO: "bar", BAZ: "qux" });
  });
});

describe("readEnvFile / writeEnvFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "env-test-"));
  });

  afterEach(() => {
    // cleanup handled by OS
  });

  it("reads and writes .env files preserving content", async () => {
    const envPath = join(tmpDir, ".env");
    const content = "# Config\nFOO=bar\n\nBAZ=qux";
    await writeFile(envPath, content);

    const env = await readEnvFile(envPath);
    expect(getEnvValue(env, "FOO")).toBe("bar");

    setEnvValue(env, "FOO", "updated");
    await writeEnvFile(envPath, env);

    const raw = await readFile(envPath, "utf-8");
    expect(raw).toContain("FOO=updated");
    expect(raw).toContain("# Config");
  });
});
