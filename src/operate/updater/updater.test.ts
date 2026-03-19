/**
 * Tests for the update module.
 *
 * Covers:
 *   - UpdateResult and UpdateCheckResult structure
 *   - Image name extraction from docker-compose.yml
 *   - Progress callback invocation
 *   - Graceful failure modes
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { UpdateProgress } from "./types.js";
import { checkForUpdates } from "./updater.js";

// ── Test Fixtures ───────────────────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `clawhq-updater-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(testDir, "engine"), { recursive: true });
  await mkdir(join(testDir, "workspace", "identity"), { recursive: true });
  await mkdir(join(testDir, "workspace", "tools"), { recursive: true });
  await mkdir(join(testDir, "workspace", "skills"), { recursive: true });
  await mkdir(join(testDir, "workspace", "memory"), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

async function writeCompose(image: string = "openclaw:latest"): Promise<void> {
  const compose = `services:\n  openclaw:\n    image: ${image}\n`;
  await writeFile(join(testDir, "engine", "docker-compose.yml"), compose);
}

// ── checkForUpdates Tests ───────────────────────────────────────────────────

describe("checkForUpdates", () => {
  it("returns structured result", async () => {
    await writeCompose();
    const result = await checkForUpdates({
      deployDir: testDir,
      checkOnly: true,
    });

    expect(typeof result.available).toBe("boolean");
    expect(result.currentImage).toBe("openclaw:latest");
    // Will likely fail in test env without Docker, but should return error not throw
  });

  it("reports progress events", async () => {
    await writeCompose();
    const events: UpdateProgress[] = [];
    await checkForUpdates({
      deployDir: testDir,
      checkOnly: true,
      onProgress: (event) => events.push(event),
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].step).toBe("check");
    expect(events[0].status).toBe("running");
  });

  it("handles missing compose file", async () => {
    const result = await checkForUpdates({
      deployDir: testDir,
      checkOnly: true,
    });

    expect(result.available).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("respects abort signal", async () => {
    await writeCompose();
    const ac = new AbortController();
    ac.abort();

    const result = await checkForUpdates({
      deployDir: testDir,
      checkOnly: true,
      signal: ac.signal,
    });

    // Should not throw, should return a result
    expect(typeof result.available).toBe("boolean");
  });
});
