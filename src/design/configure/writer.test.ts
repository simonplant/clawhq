import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FileEntry } from "./types.js";
import { writeBundle, writeFileAtomic } from "./writer.js";

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

// ── writeBundle ──────────────────────────────────────────────────────────────

describe("writeBundle", () => {
  it("writes all files to the deploy directory", () => {
    const files: FileEntry[] = [
      { relativePath: "engine/openclaw.json", content: '{"test": true}\n' },
      { relativePath: "engine/.env", content: "KEY=value\n", mode: 0o600 },
      { relativePath: "cron/jobs.json", content: "[]\n" },
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

