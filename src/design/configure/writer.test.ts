import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseEnvFile } from "../../config/env-merge.js";
import { writeFileAtomic } from "../../config/fs-atomic.js";

import type { FileEntry } from "./types.js";
import { writeBundle } from "./writer.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "clawhq-writer-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ── writeFileAtomic ──────────────────────────────────────────────────────────

describe("writeFileAtomic", () => {
  it("writes content to the target path", () => {
    const target = join(tempDir, "test.txt");
    writeFileAtomic(target, "hello world");

    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf-8")).toBe("hello world");
  });

  it("creates parent directories as needed", () => {
    const target = join(tempDir, "deep", "nested", "dir", "file.txt");
    writeFileAtomic(target, "nested content");

    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf-8")).toBe("nested content");
  });

  it("sets file permissions when specified", () => {
    const target = join(tempDir, "secret.env");
    writeFileAtomic(target, "SECRET=value", 0o600);

    const stat = statSync(target);
    // Check owner permissions only (mask out group/other that OS may modify)
    expect(stat.mode & 0o700).toBe(0o600);
  });

  it("overwrites existing files atomically", () => {
    const target = join(tempDir, "overwrite.txt");
    writeFileAtomic(target, "version 1");
    writeFileAtomic(target, "version 2");

    expect(readFileSync(target, "utf-8")).toBe("version 2");
  });

  it("does not leave temp files on success", () => {
    const target = join(tempDir, "clean.txt");
    writeFileAtomic(target, "content");

    const files = readdirSync(tempDir);
    expect(files).toEqual(["clean.txt"]);
  });

  it("does not leave temp files on failure", () => {
    // Write to a path with read-only parent that will fail
    const readOnlyDir = join(tempDir, "readonly");
    mkdirSync(readOnlyDir, { mode: 0o444 });

    try {
      writeFileAtomic(join(readOnlyDir, "sub", "fail.txt"), "content");
    } catch {
      // Expected to fail
    }

    // No temp files should remain
    const files = readdirSync(readOnlyDir);
    const tmpFiles = files.filter((f: string) => f.startsWith(".clawhq-tmp-"));
    expect(tmpFiles).toHaveLength(0);
  });
});

// ── parseEnvFile ────────────────────────────────────────────────────────────

describe("parseEnvFile", () => {
  it("strips surrounding double quotes from values", () => {
    const result = parseEnvFile('API_KEY="sk-ant-abc123"');
    expect(result.get("API_KEY")).toBe("sk-ant-abc123");
  });

  it("strips surrounding single quotes from values", () => {
    const result = parseEnvFile("KEY='single quoted'");
    expect(result.get("KEY")).toBe("single quoted");
  });

  it("parses double-quoted value with spaces", () => {
    const result = parseEnvFile('KEY="value with spaces"');
    expect(result.get("KEY")).toBe("value with spaces");
  });

  it("strips inline comments (# preceded by whitespace)", () => {
    const result = parseEnvFile("KEY=value # this is a comment");
    expect(result.get("KEY")).toBe("value");
  });

  it("does NOT treat # without preceding space as comment", () => {
    const result = parseEnvFile("URL=https://example.com#anchor");
    expect(result.get("URL")).toBe("https://example.com#anchor");
  });

  it("handles bare KEY=VALUE unchanged", () => {
    const result = parseEnvFile("KEY=value");
    expect(result.get("KEY")).toBe("value");
  });
});

// ── mergeEnv (via writeBundle) ──────────────────────────────────────────────

describe("mergeEnv preserves format", () => {
  it("preserves quoted format from existing file", () => {
    const envPath = join(tempDir, "engine", ".env");

    // Write an existing .env with quoted values
    writeFileAtomic(join(tempDir, "engine", ".env"), 'API_KEY="sk-real-key"\nOTHER=val\n', 0o600);

    // Write a generated .env where API_KEY is placeholder
    const files: FileEntry[] = [
      { relativePath: "engine/.env", content: "API_KEY=CHANGE_ME\nOTHER=CHANGE_ME\n", mode: 0o600 },
    ];

    writeBundle(tempDir, files);

    const merged = readFileSync(envPath, "utf-8");
    // Should preserve the quoted format from the existing file
    expect(merged).toContain('API_KEY="sk-real-key"');
    expect(merged).toContain("OTHER=val");
  });
});

// ── writeBundle ──────────────────────────────────────────────────────────────

describe("writeBundle", () => {
  it("writes all files to the deploy directory", () => {
    const files: FileEntry[] = [
      { relativePath: "engine/openclaw.json", content: '{"test": true}\n' },
      { relativePath: "engine/.env", content: "KEY=value\n", mode: 0o600 },
      { relativePath: "cron/jobs.json", content: '{"version":1,"jobs":[]}\n' },
    ];

    const result = writeBundle(tempDir, files);

    expect(result.written).toHaveLength(3);
    expect(existsSync(join(tempDir, "engine", "openclaw.json"))).toBe(true);
    expect(existsSync(join(tempDir, "engine", ".env"))).toBe(true);
    expect(existsSync(join(tempDir, "cron", "jobs.json"))).toBe(true);
  });

  it("preserves file content exactly", () => {
    const content = JSON.stringify({ key: "value", nested: { a: 1 } }, null, 2) + "\n";
    const files: FileEntry[] = [
      { relativePath: "test.json", content },
    ];

    writeBundle(tempDir, files);

    expect(readFileSync(join(tempDir, "test.json"), "utf-8")).toBe(content);
  });

  it("applies correct permissions to secret files", () => {
    const files: FileEntry[] = [
      { relativePath: "engine/.env", content: "SECRET=x\n", mode: 0o600 },
      { relativePath: "engine/openclaw.json", content: "{}\n" },
    ];

    writeBundle(tempDir, files);

    const envStat = statSync(join(tempDir, "engine", ".env"));
    expect(envStat.mode & 0o700).toBe(0o600);
  });

  it("returns the resolved deploy directory", () => {
    const result = writeBundle(tempDir, [
      { relativePath: "test.txt", content: "x" },
    ]);

    expect(result.deployDir).toBe(tempDir);
  });
});

// ── mergeEnv orphaned key preservation ──────────────────────────────────────

describe("mergeEnv preserves orphaned keys", () => {
  it("appends keys from existing .env that aren't in generated template", () => {
    // Existing .env has TELEGRAM_BOT_TOKEN (not in template)
    writeFileAtomic(join(tempDir, "engine", ".env"), "KEY=val\nTELEGRAM_BOT_TOKEN=secret123\n", 0o600);

    // Generated template only has KEY
    const files: FileEntry[] = [
      { relativePath: "engine/.env", content: "KEY=CHANGE_ME\n", mode: 0o600 },
    ];

    writeBundle(tempDir, files);

    const merged = readFileSync(join(tempDir, "engine", ".env"), "utf-8");
    // KEY should be preserved from existing (real value over placeholder)
    expect(merged).toContain("KEY=val");
    // TELEGRAM_BOT_TOKEN should be preserved even though it's not in the template
    expect(merged).toContain("TELEGRAM_BOT_TOKEN=secret123");
    // Should be on separate lines (not concatenated)
    expect(merged).not.toMatch(/val.*TELEGRAM/);
  });

  it("does not append orphaned keys that are just placeholders", () => {
    writeFileAtomic(join(tempDir, "engine", ".env"), "KEY=val\nUNUSED=CHANGE_ME\n", 0o600);

    const files: FileEntry[] = [
      { relativePath: "engine/.env", content: "KEY=CHANGE_ME\n", mode: 0o600 },
    ];

    writeBundle(tempDir, files);

    const merged = readFileSync(join(tempDir, "engine", ".env"), "utf-8");
    expect(merged).not.toContain("UNUSED");
  });

  it("each orphaned key is on its own line", () => {
    writeFileAtomic(join(tempDir, "engine", ".env"), "A=1\nB=2\nC=3\n", 0o600);

    const files: FileEntry[] = [
      { relativePath: "engine/.env", content: "A=CHANGE_ME\n", mode: 0o600 },
    ];

    writeBundle(tempDir, files);

    const merged = readFileSync(join(tempDir, "engine", ".env"), "utf-8");
    const lines = merged.split("\n").filter((l: string) => l.includes("="));
    // A preserved from existing, B and C appended as orphans
    expect(lines.length).toBe(3);
    expect(lines.find((l: string) => l.startsWith("B="))).toBe("B=2");
    expect(lines.find((l: string) => l.startsWith("C="))).toBe("C=3");
  });
});

