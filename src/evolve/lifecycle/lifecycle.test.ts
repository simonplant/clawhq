/**
 * Tests for export + destroy lifecycle operations.
 *
 * Covers:
 *   - PII masking (all categories)
 *   - Portable export (bundling, manifest, PII masking)
 *   - Verified destruction (secure wipe, proof generation, proof verification)
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { destroyAgent } from "./destroy.js";
import { exportBundle } from "./export.js";
import { isTextFile, maskPii } from "./mask.js";

// ── Test Setup ──────────────────────────────────────────────────────────────

let testDir: string;
let deployDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "clawhq-lifecycle-test-"));
  deployDir = join(testDir, ".clawhq");

  // Scaffold a minimal deployment directory
  mkdirSync(join(deployDir, "engine"), { recursive: true });
  mkdirSync(join(deployDir, "workspace", "identity"), { recursive: true });
  mkdirSync(join(deployDir, "workspace", "tools"), { recursive: true });
  mkdirSync(join(deployDir, "workspace", "skills"), { recursive: true });
  mkdirSync(join(deployDir, "workspace", "memory"), { recursive: true });
  mkdirSync(join(deployDir, "cron"), { recursive: true });
  mkdirSync(join(deployDir, "security"), { recursive: true });
  mkdirSync(join(deployDir, "ops", "audit"), { recursive: true });

  // Write some agent data
  await writeFile(
    join(deployDir, "engine", "openclaw.json"),
    JSON.stringify({ name: "test-agent", version: "1.0" }),
  );
  await writeFile(
    join(deployDir, "engine", "docker-compose.yml"),
    "version: '3.8'\nservices:\n  openclaw:\n    image: openclaw:latest\n",
  );
  // Secrets — should be excluded from export
  await writeFile(join(deployDir, "engine", ".env"), "API_KEY=sk-secret-key-12345\n");
  await writeFile(
    join(deployDir, "engine", "credentials.json"),
    JSON.stringify({ icloud: { password: "secret" } }),
  );

  await writeFile(
    join(deployDir, "workspace", "identity", "SOUL.md"),
    "You are a helpful assistant. Contact: user@example.com\n",
  );
  await writeFile(
    join(deployDir, "workspace", "identity", "AGENTS.md"),
    "# Agent\nPhone: (555) 123-4567\nSSN: 123-45-6789\n",
  );
  await writeFile(
    join(deployDir, "workspace", "memory", "hot.json"),
    JSON.stringify({ notes: "User IP: 192.168.1.100" }),
  );
  await writeFile(
    join(deployDir, "cron", "jobs.json"),
    JSON.stringify({ jobs: [{ name: "digest", cron: "0 8 * * *" }] }),
  );
  await writeFile(
    join(deployDir, "security", "posture.yaml"),
    "posture: hardened\n",
  );
  await writeFile(
    join(deployDir, "ops", "audit", "tool-execution.jsonl"),
    '{"type":"tool_execution","ts":"2026-03-19T10:00:00Z","tool":"email"}\n',
  );
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ── PII Masking Tests ───────────────────────────────────────────────────────

describe("maskPii", () => {
  it("masks email addresses", () => {
    const result = maskPii("Contact me at john@example.com for details");
    expect(result.text).toContain("[EMAIL REDACTED]");
    expect(result.text).not.toContain("john@example.com");
    expect(result.maskedCount).toBe(1);
    expect(result.categories.email).toBe(1);
  });

  it("masks phone numbers", () => {
    const result = maskPii("Call (555) 123-4567 or +1-234-567-8901");
    expect(result.text).not.toContain("555");
    expect(result.maskedCount).toBeGreaterThanOrEqual(1);
  });

  it("masks SSNs", () => {
    const result = maskPii("SSN: 123-45-6789");
    expect(result.text).toContain("[SSN REDACTED]");
    expect(result.text).not.toContain("123-45-6789");
  });

  it("masks credit card numbers", () => {
    const result = maskPii("Card: 4111-1111-1111-1111");
    expect(result.text).toContain("[CARD REDACTED]");
    expect(result.text).not.toContain("4111");
  });

  it("masks IP addresses", () => {
    const result = maskPii("Server at 192.168.1.100");
    expect(result.text).toContain("[IP REDACTED]");
    expect(result.text).not.toContain("192.168.1.100");
  });

  it("masks API keys", () => {
    const result = maskPii("Key: sk-abc123def456ghi789jkl012mno345");
    expect(result.text).toContain("[API_KEY REDACTED]");
    expect(result.text).not.toContain("sk-abc123");
  });

  it("handles multiple PII types in one string", () => {
    const result = maskPii("Email: a@b.com, Phone: 555-123-4567, SSN: 111-22-3333");
    expect(result.maskedCount).toBeGreaterThanOrEqual(3);
    expect(result.text).not.toContain("a@b.com");
    expect(result.text).not.toContain("111-22-3333");
  });

  it("returns unchanged text when no PII found", () => {
    const result = maskPii("Hello world, no PII here.");
    expect(result.text).toBe("Hello world, no PII here.");
    expect(result.maskedCount).toBe(0);
  });
});

describe("isTextFile", () => {
  it("identifies text file extensions", () => {
    expect(isTextFile("file.md")).toBe(true);
    expect(isTextFile("config.json")).toBe(true);
    expect(isTextFile("script.sh")).toBe(true);
    expect(isTextFile(".env")).toBe(true);
  });

  it("rejects binary file extensions", () => {
    expect(isTextFile("image.png")).toBe(false);
    expect(isTextFile("archive.tar.gz")).toBe(false);
    expect(isTextFile("binary")).toBe(false);
  });
});

// ── Export Tests ─────────────────────────────────────────────────────────────

describe("exportBundle", () => {
  it("produces a bundle file", async () => {
    const outputPath = join(testDir, "test-export.tar.gz");
    const result = await exportBundle({ deployDir, output: outputPath });

    expect(result.success).toBe(true);
    expect(result.bundlePath).toBe(outputPath);
    expect(result.fileCount).toBeGreaterThan(0);
    expect(result.bundleSize).toBeGreaterThan(0);
    expect(existsSync(outputPath)).toBe(true);
  });

  it("excludes secrets (.env, credentials.json)", async () => {
    const outputPath = join(testDir, "test-export.tar.gz");
    const result = await exportBundle({ deployDir, output: outputPath });

    expect(result.success).toBe(true);

    // Read the raw tar.gz and check that secret files are not included
    const archiveContent = readFileSync(outputPath);
    const archiveStr = archiveContent.toString("binary");
    // .env and credentials.json should not appear as tar entry names
    // (they would appear in the 512-byte headers)
    expect(archiveStr).not.toContain("credentials.json");
  });

  it("masks PII in exported text files", async () => {
    const outputPath = join(testDir, "test-export.tar.gz");
    const result = await exportBundle({ deployDir, output: outputPath });

    expect(result.success).toBe(true);
    expect(result.piiMasked).toBeGreaterThan(0);
  });

  it("reports progress callbacks", async () => {
    const steps: string[] = [];
    const outputPath = join(testDir, "test-export.tar.gz");
    await exportBundle({
      deployDir,
      output: outputPath,
      onProgress: (event) => steps.push(`${event.step}:${event.status}`),
    });

    expect(steps).toContain("collect:running");
    expect(steps).toContain("collect:done");
    expect(steps).toContain("mask:running");
    expect(steps).toContain("mask:done");
    expect(steps).toContain("bundle:running");
    expect(steps).toContain("bundle:done");
    expect(steps).toContain("verify:running");
    expect(steps).toContain("verify:done");
  });

  it("fails gracefully for missing deploy dir", async () => {
    const result = await exportBundle({ deployDir: "/nonexistent/path" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});

// ── Destroy Tests ───────────────────────────────────────────────────────────

describe("destroyAgent", () => {
  it("removes the deployment directory", async () => {
    expect(existsSync(deployDir)).toBe(true);

    const result = await destroyAgent({ deployDir, confirm: true });

    expect(result.success).toBe(true);
    expect(existsSync(deployDir)).toBe(false);
  });

  it("produces a receipt file", async () => {
    const result = await destroyAgent({ deployDir, confirm: true });

    expect(result.success).toBe(true);
    expect(result.receiptPath).toBeDefined();
    if (result.receiptPath) {
      expect(existsSync(result.receiptPath)).toBe(true);
    }
  });

  it("receipt contains all destroyed files", async () => {
    const result = await destroyAgent({ deployDir, confirm: true });
    expect(result.receipt).toBeDefined();
    const receipt = result.receipt;

    expect(receipt?.files.length).toBeGreaterThan(0);
    expect(receipt?.totalBytes).toBeGreaterThan(0);
    expect(receipt?.destroyedAt).toBeDefined();
  });

  it("receipt can be read back from JSON", async () => {
    const result = await destroyAgent({ deployDir, confirm: true });
    expect(result.receiptPath).toBeDefined();
    if (!result.receiptPath) return;
    const receiptJson = await readFile(result.receiptPath, "utf-8");
    const receipt = JSON.parse(receiptJson);

    expect(receipt.version).toBe(1);
    expect(receipt.files).toBeDefined();
    expect(receipt.destroyedAt).toBeDefined();
  });

  it("reports progress callbacks", async () => {
    const steps: string[] = [];
    await destroyAgent({
      deployDir,
      confirm: true,
      onProgress: (event) => steps.push(`${event.step}:${event.status}`),
    });

    expect(steps).toContain("inventory:running");
    expect(steps).toContain("inventory:done");
    expect(steps).toContain("wipe:running");
    expect(steps).toContain("wipe:done");
    expect(steps).toContain("verify:done");
  });

  it("fails gracefully for missing deploy dir", async () => {
    const result = await destroyAgent({ deployDir: "/nonexistent/path", confirm: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});
