/**
 * Tests for doctor diagnostics, auto-fix, and formatters.
 */

import { access, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { parse as yamlParse } from "yaml";

import { GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";
import { OPENCLAW_CONTAINER_WORKSPACE } from "../../config/paths.js";

import { compareVersions, detectOpenClawVersion, runChecks } from "./checks.js";
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
    allowedOrigins: [`http://localhost:${GATEWAY_DEFAULT_PORT}`],
    trustedProxies: ["172.17.0.1"],
    tools: {
      exec: { host: "gateway", security: "full" },
      accessGrants: [{ type: "user", value: "*" }],
      loopDetection: { enabled: true },
    },
    fs: { workspaceOnly: true },
  };
  await writeFile(
    join(testDir, "engine", "openclaw.json"),
    JSON.stringify(config, null, 2) + "\n",
  );
}

/** Write a minimal docker-compose.yml with all required structure. */
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
    extra_hosts:
      - "host.docker.internal:host-gateway"
      - "ollama:host-gateway"
    tmpfs:
      - /tmp:size=100m,noexec,nosuid
      - /home/node/.openclaw:exec,nosuid,size=256m,uid=1000,gid=1000
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
  const store = {
    version: 1,
    jobs: [
      {
        id: "heartbeat",
        name: "heartbeat",
        enabled: true,
        schedule: { kind: "cron", expr: "0-59/10 5-23 * * *" },
        delivery: { mode: "none" },
        payload: { kind: "agentTurn", message: "Run heartbeat" },
        sessionTarget: "isolated",
        state: {},
      },
    ],
  };
  await writeFile(join(testDir, "cron", "jobs.json"), JSON.stringify(store, null, 2));
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

describe("checks", { timeout: 30_000 }, () => {
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

  it("cron-schema passes with envelope format", async () => {
    await writeValidCron();
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "cron-schema");
    expect(check.passed).toBe(true);
  });

  it("cron-schema fails on bare array", async () => {
    await writeFile(join(testDir, "cron", "jobs.json"), "[]");
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "cron-schema");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("envelope");
    expect(check.fix).toContain("clawhq apply");
  });

  it("cron-syntax passes with valid cron expressions", async () => {
    await writeValidCron();
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "cron-syntax");
    expect(check.passed).toBe(true);
  });

  it("cron-syntax fails with invalid stepping", async () => {
    const envelope = { version: 1, jobs: [{ id: "bad", name: "bad", enabled: true, schedule: { kind: "cron", expr: "5/15 * * * *" }, delivery: { mode: "none" }, payload: { kind: "agentTurn", message: "Test" }, sessionTarget: "isolated" }] };
    await writeFile(join(testDir, "cron", "jobs.json"), JSON.stringify(envelope));
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "cron-syntax");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("silently not run");
  });

  it("cron-syntax fails with wrong field count", async () => {
    const envelope = { version: 1, jobs: [{ id: "bad", name: "bad", enabled: true, schedule: { kind: "cron", expr: "* * *" }, delivery: { mode: "none" }, payload: { kind: "agentTurn", message: "Test" }, sessionTarget: "isolated" }] };
    await writeFile(join(testDir, "cron", "jobs.json"), JSON.stringify(envelope));
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "cron-syntax");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("expected 5 fields");
  });

  it("cron-syntax fails with out-of-range field values", async () => {
    const envelope = { version: 1, jobs: [{ id: "bad", name: "bad", enabled: true, schedule: { kind: "cron", expr: "99 99 99 99 99" }, delivery: { mode: "none" }, payload: { kind: "agentTurn", message: "Test" }, sessionTarget: "isolated" }] };
    await writeFile(join(testDir, "cron", "jobs.json"), JSON.stringify(envelope));
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "cron-syntax");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("out of range");
  });

  it("cron-syntax fails with minute > 59", async () => {
    const envelope = { version: 1, jobs: [{ id: "bad", name: "bad", enabled: true, schedule: { kind: "cron", expr: "60 * * * *" }, delivery: { mode: "none" }, payload: { kind: "agentTurn", message: "Test" }, sessionTarget: "isolated" }] };
    await writeFile(join(testDir, "cron", "jobs.json"), JSON.stringify(envelope));
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "cron-syntax");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("minute");
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

  it("tool-access-grants fails when accessGrants missing", async () => {
    await writeFile(
      join(testDir, "engine", "openclaw.json"),
      JSON.stringify({
        dangerouslyDisableDeviceAuth: true,
        allowedOrigins: [`http://localhost:${GATEWAY_DEFAULT_PORT}`],
        trustedProxies: ["172.17.0.1"],
        tools: { exec: { host: "gateway", security: "full" } },
      }),
    );
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "tool-access-grants");
    expect(check.passed).toBe(false);
    expect(check.severity).toBe("warning");
    expect(check.message).toContain("invisible");
    expect(check.fixable).toBe(true);
  });

  it("tool-access-grants passes when accessGrants present", async () => {
    await writeValidConfig();
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "tool-access-grants");
    expect(check.passed).toBe(true);
  });

  it("egress-domains-coverage passes when no .env present", async () => {
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "egress-domains-coverage");
    expect(check.passed).toBe(true);
    expect(check.message).toContain("No .env");
  });

  it("egress-domains-coverage detects missing integration domains", async () => {
    // Write .env with anthropic credentials (prefix ANTHROPIC_)
    await writeFile(
      join(testDir, "engine", ".env"),
      "ANTHROPIC_API_KEY=sk-ant-test\n",
    );
    await chmod(join(testDir, "engine", ".env"), 0o600);

    // Write allowlist WITHOUT api.anthropic.com
    await mkdir(join(testDir, "ops", "firewall"), { recursive: true });
    await writeFile(
      join(testDir, "ops", "firewall", "allowlist.yaml"),
      "- domain: api.example.com\n  port: 443\n",
    );

    const checks = await runChecks(testDir);
    const check = findCheck(checks, "egress-domains-coverage");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("api.anthropic.com");
  });

  it("egress-domains-coverage passes when all domains covered", async () => {
    // Write .env with anthropic credentials
    await writeFile(
      join(testDir, "engine", ".env"),
      "ANTHROPIC_API_KEY=sk-ant-test\n",
    );
    await chmod(join(testDir, "engine", ".env"), 0o600);

    // Write allowlist WITH api.anthropic.com
    await mkdir(join(testDir, "ops", "firewall"), { recursive: true });
    await writeFile(
      join(testDir, "ops", "firewall", "allowlist.yaml"),
      "- domain: api.anthropic.com\n  port: 443\n",
    );

    const checks = await runChecks(testDir);
    const check = findCheck(checks, "egress-domains-coverage");
    expect(check.passed).toBe(true);
  });

  it("runs all checks", async () => {
    const checks = await runChecks(testDir);
    expect(checks.length).toBe(38);
  });
});

// ── Doctor Orchestrator Tests ───────────────────────────────────────────────

describe("runDoctor", { timeout: 30_000 }, () => {
  it("returns a valid DoctorReport", async () => {
    await writeValidConfig();
    await writeValidCompose();
    await writeValidEnv();
    await writeValidCron();
    await writeIdentityFiles();

    const report = await runDoctor({ deployDir: testDir });
    expect(report.timestamp).toBeTruthy();
    expect(report.checks.length).toBe(38);
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

describe("auto-fix", { timeout: 30_000 }, () => {
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

  it("fixes missing tool access grants", async () => {
    // Write config without accessGrants
    await writeFile(
      join(testDir, "engine", "openclaw.json"),
      JSON.stringify({
        dangerouslyDisableDeviceAuth: true,
        allowedOrigins: [`http://localhost:${GATEWAY_DEFAULT_PORT}`],
        trustedProxies: ["172.17.0.1"],
        tools: { exec: { host: "gateway", security: "full" } },
      }),
    );

    const checks = await runChecks(testDir);
    const fixReport = await runFixes(testDir, checks);

    const grantsFix = fixReport.fixes.find((f) => f.name === "tool-access-grants");
    expect(grantsFix).toBeDefined();
    expect(grantsFix?.success).toBe(true);

    // Verify the fix was applied
    const raw = await import("node:fs/promises").then((fs) =>
      fs.readFile(join(testDir, "engine", "openclaw.json"), "utf-8"),
    );
    const config = JSON.parse(raw) as Record<string, unknown>;
    const tools = config["tools"] as Record<string, unknown>;
    expect(tools["accessGrants"]).toEqual([{ type: "user", value: "*" }]);
  });

  it("returns empty report when no fixable issues", async () => {
    await writeValidConfig();
    await writeValidCompose();
    await writeValidEnv();
    await writeValidCron();
    await writeIdentityFiles();
    // Scaffold workspace directories + sanitize tool that doctor now checks
    await mkdir(join(testDir, "workspace", "tools"), { recursive: true });
    await mkdir(join(testDir, "workspace", "skills"), { recursive: true });
    await mkdir(join(testDir, "workspace", "memory"), { recursive: true });
    await writeFile(join(testDir, "workspace", "sanitize"), "#!/bin/bash\necho ok\n");
    await chmod(join(testDir, "workspace", "sanitize"), 0o755);

    const checks = await runChecks(testDir);
    const fixReport = await runFixes(testDir, checks);

    // All fixes should be no-ops (nothing actually changed)
    for (const fix of fixReport.fixes) {
      expect(fix.message).toMatch(/already/i);
    }
  });
});

// ── YAML-Based Compose Patching Tests ──────────────────────────────────────

/** Synthetic failed check results to trigger compose fixers (Docker not required). */
function failedComposeChecks(): DoctorCheckResult[] {
  return [
    { name: "cap-drop", passed: false, severity: "error", message: "Missing cap_drop", fixable: true },
    { name: "no-new-privileges", passed: false, severity: "error", message: "Missing no-new-privileges", fixable: true },
    { name: "user-uid", passed: false, severity: "error", message: "Missing user", fixable: true },
  ];
}

describe("YAML-based compose patching", { timeout: 30_000 }, () => {
  it("fixes compose with underscore service name", async () => {
    const compose = `
services:
  my_custom_agent:
    image: openclaw:custom
    volumes:
      - ./workspace:${OPENCLAW_CONTAINER_WORKSPACE}
`;
    await writeFile(join(testDir, "engine", "docker-compose.yml"), compose);

    const fixReport = await runFixes(testDir, failedComposeChecks());

    const capFix = fixReport.fixes.find((f) => f.name === "cap-drop");
    expect(capFix).toBeDefined();
    expect(capFix?.success).toBe(true);

    // Verify the output is valid YAML with the fix applied
    const patched = await readFile(join(testDir, "engine", "docker-compose.yml"), "utf-8");
    const parsed = yamlParse(patched) as Record<string, unknown>;
    const services = parsed["services"] as Record<string, unknown>;
    const svc = services["my_custom_agent"] as Record<string, unknown>;
    expect(svc["cap_drop"]).toEqual(["ALL"]);
  });

  it("fixes compose with multi-service file", async () => {
    const compose = `
services:
  openclaw:
    image: openclaw:custom
    volumes:
      - ./workspace:${OPENCLAW_CONTAINER_WORKSPACE}
  redis:
    image: redis:7
    ports:
      - "6379:6379"
`;
    await writeFile(join(testDir, "engine", "docker-compose.yml"), compose);

    const fixReport = await runFixes(testDir, failedComposeChecks());

    const capFix = fixReport.fixes.find((f) => f.name === "cap-drop");
    expect(capFix?.success).toBe(true);

    // Verify both services still exist in output
    const patched = await readFile(join(testDir, "engine", "docker-compose.yml"), "utf-8");
    const parsed = yamlParse(patched) as Record<string, unknown>;
    const services = parsed["services"] as Record<string, unknown>;
    expect(services["openclaw"]).toBeDefined();
    expect(services["redis"]).toBeDefined();
    // Fix applied to first service
    const svc = services["openclaw"] as Record<string, unknown>;
    expect(svc["cap_drop"]).toEqual(["ALL"]);
  });

  it("creates backup before modifying compose file", async () => {
    const compose = `services:
  openclaw:
    image: openclaw:custom
    volumes:
      - ./workspace:${OPENCLAW_CONTAINER_WORKSPACE}
`;
    await writeFile(join(testDir, "engine", "docker-compose.yml"), compose);

    // Run only one fix to verify backup contains original content
    const singleCheck: DoctorCheckResult[] = [
      { name: "cap-drop", passed: false, severity: "error", message: "Missing", fixable: true },
    ];
    await runFixes(testDir, singleCheck);

    // Backup file should exist
    const backupPath = join(testDir, "engine", "docker-compose.yml.bak");
    await expect(access(backupPath)).resolves.toBeUndefined();

    // Backup should contain original content (pre-fix)
    const backup = await readFile(backupPath, "utf-8");
    expect(backup).toBe(compose);
  });

  it("produces valid YAML after round-trip (output parses back correctly)", async () => {
    const compose = `
services:
  my_app:
    image: openclaw:custom
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV=production
    volumes:
      - ./workspace:${OPENCLAW_CONTAINER_WORKSPACE}
`;
    await writeFile(join(testDir, "engine", "docker-compose.yml"), compose);

    await runFixes(testDir, failedComposeChecks());

    const patched = await readFile(join(testDir, "engine", "docker-compose.yml"), "utf-8");
    // Must parse without throwing
    const parsed = yamlParse(patched) as Record<string, unknown>;
    const services = parsed["services"] as Record<string, unknown>;
    const svc = services["my_app"] as Record<string, unknown>;
    // All three fixes should have been applied
    expect(svc["cap_drop"]).toEqual(["ALL"]);
    expect(svc["security_opt"]).toContain("no-new-privileges");
    expect(svc["user"]).toBe("1000:1000");
    // Original fields preserved
    expect(svc["image"]).toBe("openclaw:custom");
    expect(svc["ports"]).toEqual(["8080:8080"]);
  });
});

// ── Version Detection Tests ─────────────────────────────────────────────────

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("0.8.7", "0.8.7")).toBe(0);
  });

  it("returns negative when a < b", () => {
    expect(compareVersions("0.8.6", "0.8.7")).toBeLessThan(0);
    expect(compareVersions("0.7.10", "0.8.0")).toBeLessThan(0);
  });

  it("returns positive when a > b", () => {
    expect(compareVersions("0.8.10", "0.8.7")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
  });
});

describe("detectOpenClawVersion", { timeout: 30_000 }, () => {
  it("parses version from docker-compose image tag", async () => {
    const compose = `
services:
  openclaw:
    image: openclaw:v0.8.9
    user: "1000:1000"
`;
    await writeFile(join(testDir, "engine", "docker-compose.yml"), compose);
    const version = await detectOpenClawVersion(testDir);
    expect(version).toBe("0.8.9");
  });

  it("parses version without v prefix", async () => {
    const compose = `
services:
  openclaw:
    image: openclaw:0.8.7
`;
    await writeFile(join(testDir, "engine", "docker-compose.yml"), compose);
    const version = await detectOpenClawVersion(testDir);
    expect(version).toBe("0.8.7");
  });

  it("parses version from namespaced image", async () => {
    const compose = `
services:
  openclaw:
    image: ghcr.io/nicepkg/openclaw:v0.8.10
`;
    await writeFile(join(testDir, "engine", "docker-compose.yml"), compose);
    const version = await detectOpenClawVersion(testDir);
    expect(version).toBe("0.8.10");
  });

  it("returns null when image tag has no version and no container is running", async () => {
    const compose = `
services:
  openclaw:
    image: openclaw:custom
`;
    await writeFile(join(testDir, "engine", "docker-compose.yml"), compose);
    const version = await detectOpenClawVersion(testDir);
    // Strategy 1 (regex) won't match because "custom" isn't a semver tag.
    // Strategy 2 (docker exec) may return a version if a real "engine" project
    // is running on the host, since docker compose derives the project name
    // from the directory name ("engine").  So we accept null OR a valid version.
    if (version !== null) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    } else {
      expect(version).toBeNull();
    }
  });

  it("returns null when compose file is missing", async () => {
    const version = await detectOpenClawVersion(join(testDir, "nonexistent"));
    expect(version).toBeNull();
  });
});

// ── Upgrade Check Tests ────────────────────────────────────────────────────

describe("upgrade checks", { timeout: 30_000 }, () => {
  it("migration-state returns info when no container running", async () => {
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "migration-state");
    // With no container, should skip gracefully
    expect(check.severity).toBe("info");
  });

  it("underscore-tool-methods passes with clean tool scripts", async () => {
    await writeValidConfig();
    await writeValidCompose();
    await writeValidEnv();
    // Write a tool script with no underscore methods
    await writeFile(
      join(testDir, "workspace", "tools", "email.sh"),
      '#!/bin/bash\nfunction send_email() {\n  echo "sending"\n}\n',
    );
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "underscore-tool-methods");
    expect(check.passed).toBe(true);
  });

  it("underscore-tool-methods warns on underscore-prefixed functions in bash", async () => {
    await writeValidConfig();
    await writeValidCompose();
    await writeValidEnv();
    await writeFile(
      join(testDir, "workspace", "tools", "helper.sh"),
      '#!/bin/bash\nfunction _internal_helper() {\n  echo "hidden"\n}\n',
    );
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "underscore-tool-methods");
    expect(check.passed).toBe(false);
    expect(check.severity).toBe("warning");
    expect(check.message).toContain("_internal_helper");
  });

  it("underscore-tool-methods warns on underscore-prefixed functions in python", async () => {
    await writeValidConfig();
    await writeValidCompose();
    await writeValidEnv();
    await writeFile(
      join(testDir, "workspace", "tools", "helper.py"),
      'def _private_method():\n    pass\n',
    );
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "underscore-tool-methods");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("_private_method");
  });

  it("underscore-tool-methods skipped when version < 0.8.10", async () => {
    // Write compose with v0.8.7 tag
    const compose = `
services:
  openclaw:
    image: openclaw:v0.8.7
    user: "1000:1000"
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges
    volumes:
      - ./workspace:${OPENCLAW_CONTAINER_WORKSPACE}
`;
    await writeFile(join(testDir, "engine", "docker-compose.yml"), compose);
    await writeValidConfig();
    await writeValidEnv();
    // Write a tool with underscore method — should be skipped due to version
    await writeFile(
      join(testDir, "workspace", "tools", "helper.sh"),
      '#!/bin/bash\nfunction _hidden() { echo "hi"; }\n',
    );
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "underscore-tool-methods");
    expect(check.passed).toBe(true);
    expect(check.severity).toBe("info");
    expect(check.message).toContain("skipped");
  });

  it("tool-access-grants skipped when version < 0.8.7", async () => {
    // Write compose with v0.8.6 tag
    const compose = `
services:
  openclaw:
    image: openclaw:v0.8.6
    user: "1000:1000"
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges
    volumes:
      - ./workspace:${OPENCLAW_CONTAINER_WORKSPACE}
`;
    await writeFile(join(testDir, "engine", "docker-compose.yml"), compose);
    // Config without access grants — should still pass because version < 0.8.7
    await writeFile(
      join(testDir, "engine", "openclaw.json"),
      JSON.stringify({
        dangerouslyDisableDeviceAuth: true,
        allowedOrigins: [`http://localhost:${GATEWAY_DEFAULT_PORT}`],
        trustedProxies: ["172.17.0.1"],
        tools: { exec: { host: "gateway", security: "full" } },
      }),
    );
    await writeValidEnv();
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "tool-access-grants");
    expect(check.passed).toBe(true);
    expect(check.severity).toBe("info");
    expect(check.message).toContain("skipped");
  });

  it("tool-access-grants fails when accessGrants missing", async () => {
    await writeValidCompose(); // uses "openclaw:custom" — no semver in tag
    await writeFile(
      join(testDir, "engine", "openclaw.json"),
      JSON.stringify({
        dangerouslyDisableDeviceAuth: true,
        allowedOrigins: [`http://localhost:${GATEWAY_DEFAULT_PORT}`],
        trustedProxies: ["172.17.0.1"],
        tools: { exec: { host: "gateway", security: "full" } },
      }),
    );
    await writeValidEnv();
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "tool-access-grants");
    // The check should fail because accessGrants is missing.
    // When version is unknown (no running container) the message includes
    // an advisory note; when version IS detected (e.g. from a running
    // container) it is omitted.  Either way the core message is present.
    expect(check.passed).toBe(false);
    expect(check.message).toContain("Missing tools.accessGrants");
  });

  it("underscore-tool-methods fails on underscore-prefixed functions", async () => {
    await writeValidCompose(); // uses "openclaw:custom" — no semver in tag
    await writeValidConfig();
    await writeValidEnv();
    await writeFile(
      join(testDir, "workspace", "tools", "helper.sh"),
      '#!/bin/bash\nfunction _hidden() { echo "hi"; }\n',
    );
    const checks = await runChecks(testDir);
    const check = findCheck(checks, "underscore-tool-methods");
    expect(check.passed).toBe(false);
    expect(check.message).toContain("underscore-prefixed methods");
  });

  it("runs all 38 checks", async () => {
    const checks = await runChecks(testDir);
    expect(checks.length).toBe(38);
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
