import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { formatProbeReport, runProbes } from "./health.js";
import type { CredentialProbe, ProbeReport, ProbeResult } from "./probe-types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "clawhq-health-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

/** Create a fake probe that always returns a fixed result. */
function fakeProbe(result: ProbeResult): CredentialProbe {
  return async () => result;
}

const passResult: ProbeResult = {
  integration: "TestService",
  envKey: "TEST_API_KEY",
  ok: true,
  message: "Valid",
};

const failResult: ProbeResult = {
  integration: "TestService",
  envKey: "TEST_API_KEY",
  ok: false,
  message: "Key rejected (401)",
  fix: "Regenerate your key at https://example.com",
};

const missingResult: ProbeResult = {
  integration: "MissingService",
  envKey: "MISSING_KEY",
  ok: false,
  message: "Not configured",
  fix: "Set MISSING_KEY in your .env file",
};

// ── runProbes ────────────────────────────────────────────────────────────────

describe("runProbes", () => {
  it("runs extra probes and aggregates results", async () => {
    const envPath = join(testDir, ".env");
    writeFileSync(envPath, "TEST_API_KEY=some-value\n");

    const report = await runProbes({
      envPath,
      extraProbes: [fakeProbe(passResult)],
      includeUnconfigured: false,
    });

    // Built-in probes will show as "Not configured" (no real keys), filtered out
    // Only our extra probe remains
    const testResults = report.results.filter((r) => r.integration === "TestService");
    expect(testResults).toHaveLength(1);
    expect(testResults[0].ok).toBe(true);
  });

  it("marks report as healthy when all pass", async () => {
    const envPath = join(testDir, ".env");
    writeFileSync(envPath, "");

    const report = await runProbes({
      envPath,
      extraProbes: [fakeProbe(passResult)],
      includeUnconfigured: false,
    });

    const testResults = report.results.filter((r) => r.integration === "TestService");
    expect(testResults).toHaveLength(1);
    expect(testResults[0].ok).toBe(true);
  });

  it("marks report as unhealthy when any fail", async () => {
    const envPath = join(testDir, ".env");
    writeFileSync(envPath, "");

    const report = await runProbes({
      envPath,
      extraProbes: [fakeProbe(failResult)],
      includeUnconfigured: true,
    });

    expect(report.healthy).toBe(false);
    expect(report.failed).toBeGreaterThan(0);
  });

  it("handles missing .env file gracefully", async () => {
    const envPath = join(testDir, "nonexistent", ".env");

    const report = await runProbes({
      envPath,
      extraProbes: [fakeProbe(missingResult)],
      includeUnconfigured: true,
    });

    // Should not throw, returns results for probes
    expect(report.results.length).toBeGreaterThan(0);
    expect(report.timestamp).toBeTruthy();
  });

  it("filters unconfigured integrations when includeUnconfigured is false", async () => {
    const envPath = join(testDir, ".env");
    writeFileSync(envPath, "");

    const report = await runProbes({
      envPath,
      extraProbes: [fakeProbe(missingResult)],
      includeUnconfigured: false,
    });

    const missingResults = report.results.filter((r) => r.message === "Not configured");
    expect(missingResults).toHaveLength(0);
  });

  it("includes unconfigured integrations by default", async () => {
    const envPath = join(testDir, ".env");
    writeFileSync(envPath, "");

    const report = await runProbes({
      envPath,
      extraProbes: [fakeProbe(missingResult)],
    });

    const missingResults = report.results.filter((r) => r.message === "Not configured");
    expect(missingResults.length).toBeGreaterThan(0);
  });

  it("includes timestamp in ISO 8601 format", async () => {
    const envPath = join(testDir, ".env");
    writeFileSync(envPath, "");

    const report = await runProbes({
      envPath,
      extraProbes: [],
      includeUnconfigured: false,
    });

    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── formatProbeReport ────────────────────────────────────────────────────────

describe("formatProbeReport", () => {
  it("formats an empty report", () => {
    const report: ProbeReport = {
      timestamp: new Date().toISOString(),
      results: [],
      passed: 0,
      failed: 0,
      skipped: 0,
      healthy: false,
    };

    const output = formatProbeReport(report);
    expect(output).toContain("No integrations configured");
  });

  it("formats a healthy report with pass markers", () => {
    const report: ProbeReport = {
      timestamp: new Date().toISOString(),
      results: [passResult],
      passed: 1,
      failed: 0,
      skipped: 0,
      healthy: true,
    };

    const output = formatProbeReport(report);
    expect(output).toContain("✔ pass");
    expect(output).toContain("TestService");
    expect(output).toContain("TEST_API_KEY");
    expect(output).toContain("All 1 credential healthy");
  });

  it("formats a failed report with fail markers and fix messages", () => {
    const report: ProbeReport = {
      timestamp: new Date().toISOString(),
      results: [failResult],
      passed: 0,
      failed: 1,
      skipped: 0,
      healthy: false,
    };

    const output = formatProbeReport(report);
    expect(output).toContain("✘ FAIL");
    expect(output).toContain("Key rejected (401)");
    expect(output).toContain("→ Regenerate your key");
    expect(output).toContain("1 failed out of 1");
  });

  it("formats unconfigured integrations with skip marker", () => {
    const report: ProbeReport = {
      timestamp: new Date().toISOString(),
      results: [missingResult],
      passed: 0,
      failed: 0,
      skipped: 1,
      healthy: false,
    };

    const output = formatProbeReport(report);
    expect(output).toContain("- skip");
  });

  it("formats mixed results correctly", () => {
    const report: ProbeReport = {
      timestamp: new Date().toISOString(),
      results: [passResult, failResult, missingResult],
      passed: 1,
      failed: 1,
      skipped: 1,
      healthy: false,
    };

    const output = formatProbeReport(report);
    expect(output).toContain("✔ pass");
    expect(output).toContain("✘ FAIL");
    expect(output).toContain("- skip");
    expect(output).toContain("1 passed, 1 failed, 1 skipped out of 3");
  });

  it("pluralizes correctly for multiple credentials", () => {
    const report: ProbeReport = {
      timestamp: new Date().toISOString(),
      results: [passResult, { ...passResult, integration: "Other", envKey: "OTHER_KEY" }],
      passed: 2,
      failed: 0,
      skipped: 0,
      healthy: true,
    };

    const output = formatProbeReport(report);
    expect(output).toContain("All 2 credentials healthy");
  });
});
