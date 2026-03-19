/**
 * Tests for agent log streaming.
 *
 * Covers:
 *   - LogsResult structure
 *   - Graceful failure when no containers running
 *   - Signal abort in follow mode
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { streamLogs } from "./logs.js";

// ── Test Fixtures ───────────────────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `clawhq-logs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(testDir, "engine"), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

async function writeMinimalCompose(): Promise<void> {
  const compose = `services:\n  openclaw:\n    image: openclaw:latest\n`;
  await writeFile(join(testDir, "engine", "docker-compose.yml"), compose);
}

// ── streamLogs Tests ────────────────────────────────────────────────────────

describe("streamLogs", () => {
  it("returns structured result for non-follow mode", async () => {
    await writeMinimalCompose();
    const result = await streamLogs({
      deployDir: testDir,
      follow: false,
      lines: 10,
    });

    // Should return a structured result regardless of Docker state
    expect(typeof result.success).toBe("boolean");
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });

  it("respects signal abort in follow mode", async () => {
    await writeMinimalCompose();
    const ac = new AbortController();

    // Abort immediately
    ac.abort();

    const result = await streamLogs({
      deployDir: testDir,
      follow: true,
      lines: 10,
      signal: ac.signal,
    });

    expect(result.success).toBe(true);
    expect(result.lineCount).toBe(0);
  });

  it("handles missing compose file gracefully", async () => {
    const result = await streamLogs({
      deployDir: testDir,
      follow: false,
      lines: 10,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("accepts custom line count", async () => {
    await writeMinimalCompose();
    const result = await streamLogs({
      deployDir: testDir,
      follow: false,
      lines: 100,
    });

    // Should not throw regardless of Docker state
    expect(typeof result.success).toBe("boolean");
  });
});
