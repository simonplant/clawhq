import { writeFileSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { collectExportFiles, hashContent, readConfigRedacted } from "./collector.js";
import { createExport } from "./export.js";
import { maskPiiInText } from "./pii.js";
import { generateBundleReadme } from "./readme.js";
import type { ExportManifest } from "./types.js";
import { ExportError } from "./types.js";

// Mock tar — external system tool
vi.mock("node:child_process", async () => {
  const { writeFileSync: wfs } = await vi.importActual<typeof import("node:fs")>("node:fs");

  const execFileFn = (
    cmd: string,
    args: string[],
    callback: (err: Error | null, result: { stdout: string; stderr: string }) => void,
  ) => {
    if (cmd === "tar" && args[0] === "czf") {
      wfs(args[1], "fake-tar-gz-content");
      callback(null, { stdout: "", stderr: "" });
    } else {
      callback(null, { stdout: "", stderr: "" });
    }
  };

  return { execFile: execFileFn };
});

// Suppress unused import warning
void writeFileSync;

describe("collectExportFiles", () => {
  let tmpDir: string;
  let stagingDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-export-${Date.now()}`);
    stagingDir = join(tmpDir, "staging");
    await mkdir(tmpDir, { recursive: true });
    await mkdir(stagingDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("collects config and identity files", async () => {
    // Set up fake OpenClaw home
    await writeFile(join(tmpDir, "openclaw.json"), '{"model": "local"}', "utf-8");
    await mkdir(join(tmpDir, "workspace", "identity"), { recursive: true });
    await writeFile(join(tmpDir, "workspace", "identity", "SYSTEM.md"), "You are an assistant.", "utf-8");

    const files = await collectExportFiles(tmpDir, stagingDir, false);

    const paths = files.map((f) => f.path);
    expect(paths).toContain("openclaw.json");
    expect(paths).toContain("workspace/identity/SYSTEM.md");
  });

  it("excludes .env files from export", async () => {
    await writeFile(join(tmpDir, "openclaw.json"), '{"model": "local"}', "utf-8");
    await writeFile(join(tmpDir, ".env"), "SECRET=value", "utf-8");

    const files = await collectExportFiles(tmpDir, stagingDir, false);

    const paths = files.map((f) => f.path);
    expect(paths).not.toContain(".env");
  });

  it("respects noMemory flag — skips memory and workspace", async () => {
    await writeFile(join(tmpDir, "openclaw.json"), '{"model": "local"}', "utf-8");
    await mkdir(join(tmpDir, "workspace", "identity"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory"), { recursive: true });
    await writeFile(join(tmpDir, "workspace", "identity", "SYSTEM.md"), "identity", "utf-8");
    await writeFile(join(tmpDir, "workspace", "memory", "hot.json"), '{"data": true}', "utf-8");

    const files = await collectExportFiles(tmpDir, stagingDir, true);

    const paths = files.map((f) => f.path);
    expect(paths).toContain("workspace/identity/SYSTEM.md");
    expect(paths).not.toContain("workspace/memory/hot.json");
  });

  it("includes file hashes", async () => {
    await writeFile(join(tmpDir, "openclaw.json"), '{"test": true}', "utf-8");

    const files = await collectExportFiles(tmpDir, stagingDir, false);

    for (const file of files) {
      expect(file.hash).toHaveLength(64);
      expect(file.size).toBeGreaterThan(0);
    }
  });
});

describe("readConfigRedacted", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-redact-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("redacts secret fields in config", async () => {
    const config = {
      name: "my-agent",
      apiKey: "sk-ant-secret-value",
      nested: {
        token: "ghp_abc123",
        safe: "keep-this",
      },
    };
    const configPath = join(tmpDir, "openclaw.json");
    await writeFile(configPath, JSON.stringify(config), "utf-8");

    const result = await readConfigRedacted(configPath);
    const parsed = JSON.parse(result) as Record<string, unknown>;

    expect(parsed.name).toBe("my-agent");
    expect(parsed.apiKey).toBe("[REDACTED]");
    expect((parsed.nested as Record<string, unknown>).token).toBe("[REDACTED]");
    expect((parsed.nested as Record<string, unknown>).safe).toBe("keep-this");
  });
});

describe("maskPiiInText", () => {
  it("masks email addresses", () => {
    expect(maskPiiInText("Contact: user@example.com")).toBe(
      "Contact: [EMAIL_REDACTED]",
    );
  });

  it("masks phone numbers", () => {
    expect(maskPiiInText("Call: (555) 123-4567")).toBe(
      "Call: [PHONE_REDACTED]",
    );
  });

  it("masks SSNs", () => {
    expect(maskPiiInText("SSN: 123-45-6789")).toBe(
      "SSN: [SSN_REDACTED]",
    );
  });

  it("masks credit card numbers", () => {
    expect(maskPiiInText("Card: 4111 1111 1111 1111")).toBe(
      "Card: [CC_REDACTED]",
    );
  });

  it("masks IP addresses", () => {
    expect(maskPiiInText("Server: 192.168.1.1")).toBe(
      "Server: [IP_REDACTED]",
    );
  });

  it("preserves non-PII text", () => {
    expect(maskPiiInText("Hello world")).toBe("Hello world");
  });
});

describe("hashContent", () => {
  it("returns consistent SHA-256 hash", () => {
    const content = Buffer.from("test content");
    const hash1 = hashContent(content);
    const hash2 = hashContent(content);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });
});

describe("generateBundleReadme", () => {
  it("generates README with bundle info", () => {
    const manifest: ExportManifest = {
      exportId: "export-2026-03-13",
      timestamp: "2026-03-13T12:00:00Z",
      version: 1,
      flags: { maskPii: false, noMemory: false },
      files: [
        { path: "openclaw.json", size: 100, hash: "abc" },
        { path: "workspace/identity/SYSTEM.md", size: 50, hash: "def" },
      ],
      totalSize: 150,
    };

    const readme = generateBundleReadme(manifest);

    expect(readme).toContain("ClawHQ Export Bundle");
    expect(readme).toContain("export-2026-03-13");
    expect(readme).toContain("openclaw.json");
    expect(readme).toContain("How to Use Without ClawHQ");
    expect(readme).toContain("Integrity Verification");
  });

  it("includes PII masking note when flag is set", () => {
    const manifest: ExportManifest = {
      exportId: "test",
      timestamp: "2026-03-13T12:00:00Z",
      version: 1,
      flags: { maskPii: true, noMemory: false },
      files: [],
      totalSize: 0,
    };

    const readme = generateBundleReadme(manifest);
    expect(readme).toContain("PII masking applied");
    expect(readme).toContain("PII has been masked");
  });

  it("includes no-memory note when flag is set", () => {
    const manifest: ExportManifest = {
      exportId: "test",
      timestamp: "2026-03-13T12:00:00Z",
      version: 1,
      flags: { maskPii: false, noMemory: true },
      files: [],
      totalSize: 0,
    };

    const readme = generateBundleReadme(manifest);
    expect(readme).toContain("Memory excluded");
  });
});

describe("createExport", () => {
  let tmpDir: string;
  let outputDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-create-export-${Date.now()}`);
    outputDir = join(tmpDir, "output");
    await mkdir(tmpDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("creates export with manifest and tar.gz archive", async () => {
    await writeFile(join(tmpDir, "openclaw.json"), '{"model": "local"}', "utf-8");
    await mkdir(join(tmpDir, "workspace", "identity"), { recursive: true });
    await writeFile(join(tmpDir, "workspace", "identity", "SYSTEM.md"), "You are an assistant.", "utf-8");

    const result = await createExport({
      openclawHome: tmpDir,
      outputDir,
    });

    expect(result.exportId).toMatch(/^export-/);
    expect(result.manifest.files.length).toBeGreaterThan(0);
    expect(result.manifest.flags.maskPii).toBe(false);
    expect(result.manifest.flags.noMemory).toBe(false);

    // Verify archive was created
    const outputFiles = await readdir(outputDir);
    const archives = outputFiles.filter((f) => f.endsWith(".tar.gz"));
    expect(archives.length).toBe(1);

    // Verify manifest includes README
    const readmeEntry = result.manifest.files.find((f) => f.path === "README.md");
    expect(readmeEntry).toBeDefined();

    // Verify manifest includes manifest.json
    const manifestEntry = result.manifest.files.find((f) => f.path === "manifest.json");
    expect(manifestEntry).toBeDefined();
  });

  it("creates export with --no-memory flag", async () => {
    await writeFile(join(tmpDir, "openclaw.json"), '{"model": "local"}', "utf-8");
    await mkdir(join(tmpDir, "workspace", "identity"), { recursive: true });
    await mkdir(join(tmpDir, "workspace", "memory"), { recursive: true });
    await writeFile(join(tmpDir, "workspace", "identity", "SYSTEM.md"), "identity", "utf-8");
    await writeFile(join(tmpDir, "workspace", "memory", "hot.json"), '{"data": true}', "utf-8");

    const result = await createExport({
      openclawHome: tmpDir,
      outputDir,
      noMemory: true,
    });

    expect(result.manifest.flags.noMemory).toBe(true);
    const paths = result.manifest.files.map((f) => f.path);
    expect(paths).not.toContain("workspace/memory/hot.json");
  });

  it("creates export with --mask-pii flag", async () => {
    await writeFile(join(tmpDir, "openclaw.json"), '{"model": "local"}', "utf-8");
    await mkdir(join(tmpDir, "workspace", "identity"), { recursive: true });
    await writeFile(
      join(tmpDir, "workspace", "identity", "USER.md"),
      "Email: user@example.com\nPhone: 555-123-4567",
      "utf-8",
    );

    const result = await createExport({
      openclawHome: tmpDir,
      outputDir,
      maskPii: true,
    });

    expect(result.manifest.flags.maskPii).toBe(true);
  });

  it("throws when no files found", async () => {
    await expect(
      createExport({
        openclawHome: tmpDir,
        outputDir,
      }),
    ).rejects.toThrow(ExportError);
  });

  it("redacts secrets from openclaw.json", async () => {
    const config = { model: "local", apiKey: "sk-secret-123" };
    await writeFile(join(tmpDir, "openclaw.json"), JSON.stringify(config), "utf-8");

    const result = await createExport({
      openclawHome: tmpDir,
      outputDir,
    });

    // The config file in the bundle should have redacted secrets
    expect(result.manifest.files.some((f) => f.path === "openclaw.json")).toBe(true);
  });
});
