import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";

import { deploy, restart, shutdown } from "./deploy.js";
import { applyFirewall, removeFirewall } from "./firewall.js";
import { smokeTest, verifyHealth } from "./health.js";
import { runPreflight } from "./preflight.js";
import type {
  DeployProgress,
  PreflightCheckResult,
} from "./types.js";

// ── Test Fixtures ───────────────────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `clawhq-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(testDir, "engine"), { recursive: true });
  await mkdir(join(testDir, "ops", "firewall"), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ── Type Tests ──────────────────────────────────────────────────────────────

describe("types", () => {
  it("PreflightCheckResult has required fields", () => {
    const result: PreflightCheckResult = {
      name: "docker",
      passed: true,
      message: "Docker is running",
    };
    expect(result.name).toBe("docker");
    expect(result.passed).toBe(true);
    expect(result.message).toBe("Docker is running");
    expect(result.fix).toBeUndefined();
  });

  it("PreflightCheckResult accepts fix field", () => {
    const result: PreflightCheckResult = {
      name: "config",
      passed: false,
      message: "Config missing",
      fix: "Run: clawhq init --guided",
    };
    expect(result.fix).toBe("Run: clawhq init --guided");
  });

  it("DeployProgress captures step status", () => {
    const progress: DeployProgress = {
      step: "preflight",
      status: "running",
      message: "Running preflight checks…",
    };
    expect(progress.step).toBe("preflight");
    expect(progress.status).toBe("running");
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function findCheck(checks: readonly PreflightCheckResult[], name: string): PreflightCheckResult {
  const check = checks.find((c) => c.name === name);
  if (!check) throw new Error(`Check "${name}" not found`);
  return check;
}

// ── Preflight Tests ─────────────────────────────────────────────────────────

describe("preflight", () => {
  it("config check fails when openclaw.json is missing", async () => {
    const report = await runPreflight(testDir);
    const configCheck = findCheck(report.checks, "config");
    expect(configCheck.passed).toBe(false);
    expect(configCheck.message).toContain("not found");
    expect(configCheck.fix).toContain("clawhq init");
  });

  it("config check fails on invalid JSON", async () => {
    await writeFile(join(testDir, "engine", "openclaw.json"), "{ invalid json", "utf-8");
    const report = await runPreflight(testDir);
    const configCheck = findCheck(report.checks, "config");
    expect(configCheck.passed).toBe(false);
    expect(configCheck.message).toContain("invalid JSON");
  });

  it("config check passes with valid JSON", async () => {
    await writeFile(
      join(testDir, "engine", "openclaw.json"),
      JSON.stringify({ gateway: { port: GATEWAY_DEFAULT_PORT } }),
      "utf-8",
    );
    const report = await runPreflight(testDir);
    const configCheck = findCheck(report.checks, "config");
    expect(configCheck.passed).toBe(true);
  });

  it("secrets check fails when .env is missing", async () => {
    const report = await runPreflight(testDir);
    const secretsCheck = findCheck(report.checks, "secrets");
    expect(secretsCheck.passed).toBe(false);
    expect(secretsCheck.message).toContain("not found");
  });

  it("images check fails when build manifest is missing", async () => {
    const report = await runPreflight(testDir);
    const imagesCheck = findCheck(report.checks, "images");
    expect(imagesCheck.passed).toBe(false);
    expect(imagesCheck.message).toContain("build manifest");
    expect(imagesCheck.fix).toContain("clawhq build");
  });

  it("runs all 6 checks", async () => {
    const report = await runPreflight(testDir);
    expect(report.checks).toHaveLength(6);
    const names = report.checks.map((c) => c.name);
    expect(names).toContain("docker");
    expect(names).toContain("images");
    expect(names).toContain("config");
    expect(names).toContain("secrets");
    expect(names).toContain("ports");
    expect(names).toContain("ollama");
  });

  it("reports all failures in one pass", async () => {
    const report = await runPreflight(testDir);
    // At minimum, config, secrets, and images will fail in a fresh temp dir
    expect(report.failed.length).toBeGreaterThanOrEqual(3);
    expect(report.passed).toBe(false);
  });

  it("failed array only contains checks that failed", async () => {
    const report = await runPreflight(testDir);
    for (const check of report.failed) {
      expect(check.passed).toBe(false);
    }
  });

  it("respects AbortSignal", async () => {
    const ac = new AbortController();
    ac.abort();
    // Should still complete (preflight is fail-safe)
    const report = await runPreflight(testDir, ac.signal);
    expect(report.checks).toHaveLength(6);
  });
});

// ── Health Verify Tests ─────────────────────────────────────────────────────

describe("health", () => {
  it("verifyHealth fails when no gateway is running", async () => {
    const result = await verifyHealth({
      gatewayToken: "test-token",
      gatewayPort: 19999, // unlikely to be in use
      timeoutMs: 3_000,
      intervalMs: 500,
    });
    expect(result.healthy).toBe(false);
    expect(result.attempts).toBeGreaterThan(0);
    expect(result.error).toBeDefined();
  });

  it("verifyHealth respects AbortSignal", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 500);

    const result = await verifyHealth({
      gatewayToken: "test-token",
      gatewayPort: 19999,
      timeoutMs: 30_000,
      intervalMs: 200,
      signal: ac.signal,
    });

    expect(result.healthy).toBe(false);
    expect(result.error).toContain("aborted");
    expect(result.elapsedMs).toBeLessThan(5_000);
  });

  it("smokeTest fails when no gateway is running", async () => {
    const result = await smokeTest({
      gatewayToken: "test-token",
      gatewayPort: 19999,
    });
    expect(result.healthy).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.error).toContain("Smoke test failed");
    expect(result.messageSent).toBe(false);
    expect(result.responseReceived).toBe(false);
  });

  it("smokeTest returns actionable fix guidance on failure", async () => {
    const result = await smokeTest({
      gatewayToken: "test-token",
      gatewayPort: 19999,
    });
    expect(result.healthy).toBe(false);
    expect(result.error).toContain("Troubleshooting");
    expect(result.error).toContain("clawhq logs");
    expect(result.error).toContain("clawhq doctor");
  });
});

// ── Firewall Tests ──────────────────────────────────────────────────────────

describe("firewall", () => {
  it("removeFirewall succeeds even when chain doesn't exist", async () => {
    // This will fail gracefully since we're not root / iptables not available
    const result = await removeFirewall();
    // Either success (no chain to remove) or graceful error
    expect(typeof result.success).toBe("boolean");
  });

  it("applyFirewall returns structured result on failure", async () => {
    const result = await applyFirewall({ deployDir: testDir });
    // Will fail without root — but should return structured error, not throw
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("rulesApplied");
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });
});

// ── Deploy Orchestrator Tests ───────────────────────────────────────────────

describe("deploy", () => {
  it("fails with actionable error on preflight failure", async () => {
    const progress: DeployProgress[] = [];

    const result = await deploy({
      deployDir: testDir,
      gatewayToken: "test-token",
      onProgress: (p) => progress.push(p),
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Preflight failed");

    // Progress was reported
    const preflightEvents = progress.filter((p) => p.step === "preflight");
    expect(preflightEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("reports progress for each step", async () => {
    const progress: DeployProgress[] = [];

    await deploy({
      deployDir: testDir,
      gatewayToken: "test-token",
      onProgress: (p) => progress.push(p),
    });

    // At minimum, preflight running + failed
    expect(progress.some((p) => p.step === "preflight" && p.status === "running")).toBe(true);
    expect(progress.some((p) => p.step === "preflight" && p.status === "failed")).toBe(true);
  });

  it("respects skipPreflight option", async () => {
    const progress: DeployProgress[] = [];

    const result = await deploy({
      deployDir: testDir,
      gatewayToken: "test-token",
      skipPreflight: true,
      onProgress: (p) => progress.push(p),
    });

    // Should fail at compose-up (no docker-compose.yml), not preflight
    expect(result.success).toBe(false);
    expect(progress.some((p) => p.step === "preflight")).toBe(false);
    expect(progress.some((p) => p.step === "compose-up")).toBe(true);
  });

  it("respects AbortSignal", async () => {
    const ac = new AbortController();
    ac.abort();

    const result = await deploy({
      deployDir: testDir,
      gatewayToken: "test-token",
      skipPreflight: true,
      signal: ac.signal,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("abort");
  });

  it("never returns success without healthy=true", async () => {
    const result = await deploy({
      deployDir: testDir,
      gatewayToken: "test-token",
    });

    if (result.success) {
      expect(result.healthy).toBe(true);
    }
  });
});

describe("shutdown", () => {
  it("fails gracefully when compose file is missing", async () => {
    const result = await shutdown({ deployDir: testDir });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("reports progress during shutdown", async () => {
    const progress: DeployProgress[] = [];
    await shutdown({
      deployDir: testDir,
      onProgress: (p) => progress.push(p),
    });
    expect(progress.length).toBeGreaterThan(0);
  });
});

describe("restart", () => {
  it("fails when shutdown fails", async () => {
    const result = await restart({
      deployDir: testDir,
      gatewayToken: "test-token",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("shutdown");
  });
});
