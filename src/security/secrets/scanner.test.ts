import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanContent, scanFiles } from "./scanner.js";

describe("scanContent", () => {
  it("detects Anthropic API keys", () => {
    const content = '{"key": "sk-ant-api03-abcdefghijklmnopqrstuvwxyz"}';
    const matches = scanContent(content, "test.json");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((m) => m.pattern === "Anthropic API key")).toBe(true);
  });

  it("detects OpenAI API keys", () => {
    const content = '{"key": "sk-abcdefghijklmnopqrstuvwxyz1234567890"}';
    const matches = scanContent(content, "test.json");
    expect(matches.some((m) => m.pattern === "OpenAI API key")).toBe(true);
  });

  it("detects AWS access keys", () => {
    const content = '{"key": "AKIAIOSFODNN7EXAMPLE"}';
    const matches = scanContent(content, "test.json");
    expect(matches.some((m) => m.pattern === "AWS access key")).toBe(true);
  });

  it("detects GitHub tokens", () => {
    const content = '{"token": "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"}';
    const matches = scanContent(content, "test.json");
    expect(matches.some((m) => m.pattern === "GitHub token")).toBe(true);
  });

  it("detects Telegram bot tokens", () => {
    const content = '{"token": "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi"}';
    const matches = scanContent(content, "test.json");
    expect(matches.some((m) => m.pattern === "Telegram bot token")).toBe(true);
  });

  it("returns empty for clean content", () => {
    const content = '{"name": "my-agent", "port": 18789}';
    const matches = scanContent(content, "test.json");
    expect(matches).toHaveLength(0);
  });

  it("reports correct line numbers", () => {
    const content = 'line1\nline2\n{"key": "sk-ant-api03-abcdefghijklmnopqrstuvwxyz"}';
    const matches = scanContent(content, "test.json");
    expect(matches[0]?.line).toBe(3);
  });

  it("detects multiple secrets on different lines", () => {
    const content = 'key1: sk-ant-api03-abcdefghijklmnopqrstuvwxyz\nkey2: AKIAIOSFODNN7EXAMPLE';
    const matches = scanContent(content, "test.json");
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe("scanFiles", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scanner-test-"));
  });

  afterEach(() => {
    // cleanup handled by OS
  });

  it("scans all config files in a directory", async () => {
    await writeFile(
      join(tmpDir, "config.json"),
      '{"key": "sk-ant-api03-abcdefghijklmnopqrstuvwxyz"}',
    );
    await writeFile(join(tmpDir, "clean.json"), '{"name": "agent"}');

    const result = await scanFiles(tmpDir);
    expect(result.filesScanned).toBe(2);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0]?.file).toContain("config.json");
  });

  it("skips .env files", async () => {
    await writeFile(
      join(tmpDir, ".env"),
      "API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
    );

    const result = await scanFiles(tmpDir);
    expect(result.filesScanned).toBe(0);
    expect(result.matches).toHaveLength(0);
  });

  it("scans subdirectories", async () => {
    const subDir = join(tmpDir, "sub");
    await mkdir(subDir);
    await writeFile(
      join(subDir, "nested.yml"),
      "key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
    );

    const result = await scanFiles(tmpDir);
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it("returns empty for clean directory", async () => {
    await writeFile(join(tmpDir, "config.json"), '{"clean": true}');

    const result = await scanFiles(tmpDir);
    expect(result.matches).toHaveLength(0);
  });

  it("handles empty directory", async () => {
    const result = await scanFiles(tmpDir);
    expect(result.filesScanned).toBe(0);
    expect(result.matches).toHaveLength(0);
  });
});
