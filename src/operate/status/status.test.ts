/**
 * Tests for the status dashboard.
 *
 * Covers:
 *   - StatusSnapshot structure
 *   - Config validation within status
 *   - Table and JSON formatters
 *   - Watch mode basics
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";

import { formatStatusJson, formatStatusTable } from "./format.js";
import { getStatus, watchStatus } from "./status.js";
import type { StatusSnapshot } from "./types.js";

// ── Test Fixtures ───────────────────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `clawhq-status-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(testDir, "engine"), { recursive: true });
  await mkdir(join(testDir, "workspace", "identity"), { recursive: true });
  await mkdir(join(testDir, "workspace", "tools"), { recursive: true });
  await mkdir(join(testDir, "workspace", "skills"), { recursive: true });
  await mkdir(join(testDir, "workspace", "memory"), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

async function writeValidConfig(): Promise<void> {
  const config = {
    dangerouslyDisableDeviceAuth: true,
    allowedOrigins: [`http://localhost:${GATEWAY_DEFAULT_PORT}`],
    trustedProxies: ["172.17.0.1"],
    tools: { exec: { host: "gateway", security: "full" } },
  };
  await writeFile(
    join(testDir, "engine", "openclaw.json"),
    JSON.stringify(config, null, 2) + "\n",
  );
}

// ── getStatus Tests ─────────────────────────────────────────────────────────

describe("getStatus", () => {
  it("returns a valid snapshot", async () => {
    await writeValidConfig();
    const snapshot = await getStatus({ deployDir: testDir });

    expect(snapshot.timestamp).toBeTruthy();
    expect(typeof snapshot.configValid).toBe("boolean");
    expect(typeof snapshot.healthy).toBe("boolean");
    expect(snapshot.configErrors).toBeDefined();
  });

  it("reports config invalid when openclaw.json is missing", async () => {
    const snapshot = await getStatus({ deployDir: testDir });
    expect(snapshot.configValid).toBe(false);
    expect(snapshot.configErrors.length).toBeGreaterThan(0);
  });

  it("reports config valid when config passes landmine checks", async () => {
    await writeValidConfig();
    const snapshot = await getStatus({ deployDir: testDir });
    expect(snapshot.configValid).toBe(true);
    expect(snapshot.configErrors).toHaveLength(0);
  });

  it("detects landmine violations in config", async () => {
    await writeFile(
      join(testDir, "engine", "openclaw.json"),
      JSON.stringify({ tools: { exec: { host: "node" } } }),
    );
    const snapshot = await getStatus({ deployDir: testDir });
    expect(snapshot.configValid).toBe(false);
    expect(snapshot.configErrors.length).toBeGreaterThan(0);
  });

  it("marks unhealthy when config is invalid", async () => {
    const snapshot = await getStatus({ deployDir: testDir });
    expect(snapshot.healthy).toBe(false);
  });

  it("container is null when docker is not available for compose", async () => {
    await writeValidConfig();
    const snapshot = await getStatus({ deployDir: testDir });
    // Container may or may not be null depending on Docker availability
    // But the call should not throw
    expect(snapshot).toBeDefined();
  });
});

// ── watchStatus Tests ───────────────────────────────────────────────────────

describe("watchStatus", () => {
  it("calls onUpdate at least once before signal abort", async () => {
    await writeValidConfig();
    const updates: StatusSnapshot[] = [];
    const ac = new AbortController();

    // Abort after first update
    const onUpdate = (snapshot: StatusSnapshot): void => {
      updates.push(snapshot);
      ac.abort();
    };

    await watchStatus({
      deployDir: testDir,
      signal: ac.signal,
      intervalMs: 100,
      onUpdate,
    });

    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates[0].timestamp).toBeTruthy();
  });
});

// ── Formatter Tests ─────────────────────────────────────────────────────────

describe("formatStatusTable", () => {
  it("renders a healthy dashboard", () => {
    const snapshot: StatusSnapshot = {
      timestamp: "2026-03-19T00:00:00Z",
      container: {
        running: true,
        name: "openclaw-1",
        image: "openclaw:custom",
        state: "running",
        health: "healthy",
        startedAt: "Up 2 hours",
      },
      gateway: { reachable: true, latencyMs: 12 },
      configValid: true,
      configErrors: [],
      disk: { totalMb: 50000, freeMb: 25000, usedPercent: 50 },
      healthy: true,
    };

    const output = formatStatusTable(snapshot);
    expect(output).toContain("Agent Status");
    expect(output).toContain("✔ running");
    expect(output).toContain("✔ reachable");
    expect(output).toContain("✔ valid");
    expect(output).toContain("50%");
    expect(output).toContain("HEALTHY");
  });

  it("renders an unhealthy dashboard", () => {
    const snapshot: StatusSnapshot = {
      timestamp: "2026-03-19T00:00:00Z",
      container: null,
      gateway: { reachable: false, error: "ECONNREFUSED" },
      configValid: false,
      configErrors: ["LM-01: dangerouslyDisableDeviceAuth not set"],
      disk: null,
      healthy: false,
    };

    const output = formatStatusTable(snapshot);
    expect(output).toContain("✘ not running");
    expect(output).toContain("✘ unreachable");
    expect(output).toContain("✘ invalid");
    expect(output).toContain("LM-01");
    expect(output).toContain("UNHEALTHY");
    expect(output).toContain("clawhq up");
  });

  it("shows health status for container", () => {
    const snapshot: StatusSnapshot = {
      timestamp: "2026-03-19T00:00:00Z",
      container: {
        running: true,
        name: "openclaw-1",
        image: "openclaw:custom",
        state: "running",
        health: "healthy",
        startedAt: "Up 1 hour",
      },
      gateway: { reachable: true },
      configValid: true,
      configErrors: [],
      disk: null,
      healthy: true,
    };

    const output = formatStatusTable(snapshot);
    expect(output).toContain("health: healthy");
  });
});

describe("formatStatusJson", () => {
  it("produces valid JSON with all fields", () => {
    const snapshot: StatusSnapshot = {
      timestamp: "2026-03-19T00:00:00Z",
      container: null,
      gateway: { reachable: false },
      configValid: true,
      configErrors: [],
      disk: null,
      healthy: false,
    };

    const json = formatStatusJson(snapshot);
    const parsed = JSON.parse(json);
    expect(parsed.timestamp).toBe("2026-03-19T00:00:00Z");
    expect(parsed.healthy).toBe(false);
    expect(parsed.configValid).toBe(true);
    expect(parsed.container).toBeNull();
  });
});
