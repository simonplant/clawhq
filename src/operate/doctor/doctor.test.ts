/**
 * Tests for doctor diagnostics, auto-fix, and formatters.
 */

import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { OPENCLAW_CONTAINER_WORKSPACE } from "../../config/paths.js";

import { runChecks } from "./checks.js";
import { runDoctor, runDoctorWithFix } from "./doctor.js";
import { runFixes } from "./fix.js";
import { formatDoctorJson, formatDoctorTable, formatFixTable } from "./format.js";
import type {
  DoctorCheckResult,
  DoctorReport,
  FixReport,
} from "./types.js";

// ── Test Fixtures ───────────────────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `clawhq-doctor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(testDir, "engine"), { recursive: true });
  await mkdir(join(testDir, "workspace", "identity"), { recursive: true });
  await mkdir(join(testDir, "workspace", "tools"), { recursive: true });
  await mkdir(join(testDir, "workspace", "skills"), { recursive: true });
  await mkdir(join(testDir, "workspace", "memory"), { recursive: true });
  await mkdir(join(testDir, "cron"), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

/** Write a valid openclaw.json to the test directory. */
async function writeValidConfig(): Promise<void> {
  const config = {
    dangerouslyDisableDeviceAuth: true,
    allowedOrigins: ["http://localhost:18789"],
    trustedProxies: ["172.17.0.1"],
    tools: {
      exec: { host: "gateway", security: "full" },
    },
    fs: { workspaceOnly: true },
  };
  await writeFile(
    join(testDir, "engine", "openclaw.json"),
    JSON.stringify(config, null, 2) + "\n",
  );
}

/** Write a minimal docker-compose.yml. */
async function writeValidCompose(): Promise<void> {
  const compose = `
services:
  openclaw:
    image: openclaw:custom
    user: "1000:1000"
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges
    volumes:
      - ./workspace:${OPENCLAW_CONTAINER_WORKSPACE}
`;
  await writeFile(join(testDir, "engine", "docker-compose.yml"), compose);
}

/** Write a valid .env with 0600 permissions. */
async function writeValidEnv(): Promise<void> {
  await writeFile(join(testDir, "engine", ".env"), "ANTHROPIC_API_KEY=sk-ant-test\n");
  await chmod(join(testDir, "engine", ".env"), 0o600);
}

/** Write valid cron jobs. */
async function writeValidCron(): Promise<void> {
  const jobs = [
    {
      id: "heartbeat",
      kind: "cron",
      expr: "0-59/10 5-23 * * *",
      task: "Run heartbeat",
      enabled: true,
    },
  ];
  await writeFile(join(testDir, "cron", "jobs.json"), JSON.stringify(jobs, null, 2));
}

/** Write identity files. */
async function writeIdentityFiles(): Promise<void> {
  await writeFile(join(testDir, "workspace", "identity", "SOUL.md"), "# Soul\nTest agent.");
  await writeFile(join(testDir, "workspace", "identity", "AGENTS.md"), "# Agents\nInstructions.");
}

/** Find a check by name and assert it exists. */
function findCheck(checks: readonly DoctorCheckResult[], name: string): DoctorCheckResult {
  const check = checks.find((c) => c.name === name);
  if (!check) {
    throw new Error(`Expected check "${name}" not found`);
  }
  return check;
}

// ── Type Tests ──────────────────────────────────────────────────────────────

describe("types", () => {
  it("DoctorCheckResult has required fields", () => {
    const result: DoctorCheckResult = {
      name: "config-exists",
      passed: true,
      severity: "error",
      message: "Config file exists",
    };
    expect(result.name).toBe("config-exists");
    expect(result.passed).toBe(true);
  });

  it("DoctorCheckResult supports optional fix and fixable", () => {
    const result: DoctorCheckResult = {
      name: "secrets-perms",
      passed: false,
      severity: "error",
      message: "Bad permissions",
      fix: "chmod 600",
      fixable: true,
    };
    expect(result.fix).toBe("chmod 600");
    expect(result.fixable).toBe(true);
  });
});

// ── Checks Tests ────────────────────────────────────────────────────────────

describe("checks", () => {
  it("config-exists fails when openclaw.json is missing", async () => {
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "config-exists");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("not found");
  });

  it("config-exists passes when openclaw.json exists", async () => {
    await writeValidConfig();
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "config-exists");
    expect(check.passed).toBe(true);
  });

  it("config-valid detects landmine violations", async () => {
    await writeFile(
      join(testDir, "engine", "openclaw.json"),
      JSON.stringify({ tools: { exec: { host: "node" } } }),
    );
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "config-valid");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("landmine");
  });

  it("config-valid passes with correct config", async () => {
    await writeValidConfig();
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "config-valid");
    expect(check.passed).toBe(true);
  });

  it("secrets-perms fails with wrong permissions", async () => {
    await writeFile(join(testDir, "engine", ".env"), "KEY=val\n");
    await chmod(join(testDir, "engine", ".env"), 0o644);
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "secrets-perms");
    expect(check.passed).toBe(false);
    expect(check.fixable).toBe(true);
  });

  it("secrets-perms passes with 0600", async () => {
    await writeValidEnv();
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "secrets-perms");
    expect(check.passed).toBe(true);
  });

  it("cron-syntax passes with valid cron expressions", async () => {
    await writeValidCron();
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "cron-syntax");
    expect(check.passed).toBe(true);
  });

  it("cron-syntax fails with invalid stepping", async () => {
    const jobs = [{ id: "bad", kind: "cron", expr: "5/15 * * * *", task: "Test", enabled: true }];
    await writeFile(join(testDir, "cron", "jobs.json"), JSON.stringify(jobs));
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "cron-syntax");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("silently not run");
  });

  it("workspace-exists passes with complete structure", async () => {
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "workspace-exists");
    expect(check.passed).toBe(true);
  });

  it("identity-size passes when within limit", async () => {
    await writeValidConfig();
    await writeIdentityFiles();
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "identity-size");
    expect(check.passed).toBe(true);
  });

  it("runs all 17 checks", async () => {
    const checks = await runChecks(testDir);
    expect(checks.length).toBe(17);
  });
});

// ── Doctor Orchestrator Tests ───────────────────────────────────────────────

describe("runDoctor", () => {
  it("returns a valid DoctorReport", async () => {
    await writeValidConfig();
    await writeValidCompose();
    await writeValidEnv();
    await writeValidCron();
    await writeIdentityFiles();

    const report = await runDoctor({ deployDir: testDir });
    expect(report.timestamp).toBeTruthy();
    expect(report.checks.length).toBe(17);
    expect(report.passed.length).toBeGreaterThan(0);
    expect(typeof report.healthy).toBe("boolean");
  });

  it("errors array is populated on failures", async () => {
    // Empty dir — config missing
    const report = await runDoctor({ deployDir: testDir });
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.healthy).toBe(false);
  });
});

// ── Auto-Fix Tests ──────────────────────────────────────────────────────────

describe("auto-fix", () => {
  it("fixes .env permissions", async () => {
    await writeFile(join(testDir, "engine", ".env"), "KEY=val\n");
    await chmod(join(testDir, "engine", ".env"), 0o644);

    const checks = await runChecks(testDir);
    const fixReport = await runFixes(testDir, checks);

    const secretsFix = fixReport.fixes.find((f) => f.name === "secrets-perms");
    expect(secretsFix).toBeDefined();
    expect(secretsFix?.success).toBe(true);
  });

  it("fixes config landmine violations", async () => {
    // Write config with missing landmine fields
    await writeFile(
      join(testDir, "engine", "openclaw.json"),
      JSON.stringify({ tools: { exec: { host: "node", security: "ask" } } }),
    );

    const checks = await runChecks(testDir);
    const fixReport = await runFixes(testDir, checks);

    const configFix = fixReport.fixes.find((f) => f.name === "config-valid");
    expect(configFix).toBeDefined();
    expect(configFix?.success).toBe(true);
    expect(configFix?.message).toContain("landmine");
  });

  it("runDoctorWithFix re-verifies after fixes", async () => {
    await writeFile(
      join(testDir, "engine", "openclaw.json"),
      JSON.stringify({ tools: { exec: { host: "node" } } }),
    );
    await writeFile(join(testDir, "engine", ".env"), "KEY=val\n");
    await chmod(join(testDir, "engine", ".env"), 0o644);
    await writeValidCompose();
    await writeValidCron();
    await writeIdentityFiles();

    const { report, fixReport } = await runDoctorWithFix({ deployDir: testDir });

    // Config and secrets should have been fixed
    expect(fixReport.fixed).toBeGreaterThanOrEqual(2);

    // Re-verified checks should show fixed config
    const configCheck = findCheck(report.checks, "config-valid");
    expect(configCheck.passed).toBe(true);

    const secretsCheck = findCheck(report.checks, "secrets-perms");
    expect(secretsCheck.passed).toBe(true);
  });

  it("returns empty report when no fixable issues", async () => {
    await writeValidConfig();
    await writeValidCompose();
    await writeValidEnv();
    await writeValidCron();
    await writeIdentityFiles();

    const checks = await runChecks(testDir);
    const fixReport = await runFixes(testDir, checks);

    expect(fixReport.fixes.length).toBe(0);
    expect(fixReport.fixed).toBe(0);
  });
});

// ── Formatter Tests ─────────────────────────────────────────────────────────

describe("formatDoctorTable", () => {
  it("renders a table with header, separator, and rows", () => {
    const report: DoctorReport = {
      timestamp: "2026-03-19T00:00:00Z",
      checks: [
        { name: "config-exists", passed: true, severity: "error", message: "Config file exists" },
        { name: "secrets-perms", passed: false, severity: "error", message: "Bad perms", fix: "chmod 600", fixable: true },
      ],
      passed: [{ name: "config-exists", passed: true, severity: "error", message: "Config file exists" }],
      errors: [{ name: "secrets-perms", passed: false, severity: "error", message: "Bad perms", fix: "chmod 600", fixable: true }],
      warnings: [],
      healthy: false,
    };

    const output = formatDoctorTable(report);
    expect(output).toContain("Check");
    expect(output).toContain("Status");
    expect(output).toContain("✔ pass");
    expect(output).toContain("✘ FAIL");
    expect(output).toContain("→ chmod 600");
    expect(output).toContain("1 passed");
    expect(output).toContain("1 error(s)");
  });

  it("shows all-pass summary when healthy", () => {
    const report: DoctorReport = {
      timestamp: "2026-03-19T00:00:00Z",
      checks: [{ name: "config-exists", passed: true, severity: "error", message: "OK" }],
      passed: [{ name: "config-exists", passed: true, severity: "error", message: "OK" }],
      errors: [],
      warnings: [],
      healthy: true,
    };

    const output = formatDoctorTable(report);
    expect(output).toContain("All 1 checks passed");
  });
});

describe("formatFixTable", () => {
  it("renders fix results", () => {
    const fixReport: FixReport = {
      fixes: [
        { name: "secrets-perms", success: true, message: "Set .env permissions to 600" },
        { name: "config-valid", success: false, message: "Failed to fix" },
      ],
      fixed: 1,
      failed: 1,
    };

    const output = formatFixTable(fixReport);
    expect(output).toContain("Auto-fix Results");
    expect(output).toContain("✔ secrets-perms");
    expect(output).toContain("✘ config-valid");
    expect(output).toContain("1 fixed, 1 failed");
  });

  it("returns message when no fixable issues", () => {
    const output = formatFixTable({ fixes: [], fixed: 0, failed: 0 });
    expect(output).toContain("No fixable issues");
  });
});

describe("formatDoctorJson", () => {
  it("produces valid JSON with all fields", () => {
    const report: DoctorReport = {
      timestamp: "2026-03-19T00:00:00Z",
      checks: [
        { name: "config-exists", passed: true, severity: "error", message: "OK" },
        { name: "secrets-perms", passed: false, severity: "error", message: "Fail", fix: "chmod", fixable: true },
      ],
      passed: [{ name: "config-exists", passed: true, severity: "error", message: "OK" }],
      errors: [{ name: "secrets-perms", passed: false, severity: "error", message: "Fail", fix: "chmod", fixable: true }],
      warnings: [],
      healthy: false,
    };

    const json = formatDoctorJson(report);
    const parsed = JSON.parse(json);
    expect(parsed.timestamp).toBe("2026-03-19T00:00:00Z");
    expect(parsed.healthy).toBe(false);
    expect(parsed.summary.total).toBe(2);
    expect(parsed.summary.passed).toBe(1);
    expect(parsed.summary.errors).toBe(1);
    expect(parsed.checks).toHaveLength(2);
    expect(parsed.checks[0].name).toBe("config-exists");
    expect(parsed.checks[1].fix).toBe("chmod");
    expect(parsed.checks[1].fixable).toBe(true);
  });

  it("includes fix report when provided", () => {
    const report: DoctorReport = {
      timestamp: "2026-03-19T00:00:00Z",
      checks: [],
      passed: [],
      errors: [],
      warnings: [],
      healthy: true,
    };
    const fixReport: FixReport = {
      fixes: [{ name: "secrets-perms", success: true, message: "Fixed" }],
      fixed: 1,
      failed: 0,
    };

    const json = formatDoctorJson(report, fixReport);
    const parsed = JSON.parse(json);
    expect(parsed.fixes).toBeDefined();
    expect(parsed.fixes.fixed).toBe(1);
    expect(parsed.fixes.results[0].name).toBe("secrets-perms");
  });
});
