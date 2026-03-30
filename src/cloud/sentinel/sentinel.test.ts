import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";
import type { OpenClawConfig } from "../../config/types.js";
import { breakageToAlerts, predictBreakage } from "./analyzer.js";
import { deliverAlert, formatAlert, formatAlerts } from "./alerts.js";
import { generateFingerprint } from "./fingerprint.js";
import {
  analyzeUpstreamCommits,
  classifyConfigImpacts,
} from "./monitor.js";
import {
  disconnectSentinel,
  readSentinelState,
  sentinelPath,
  writeSentinelState,
} from "./subscription.js";
import type {
  ConfigFingerprint,
  SentinelAlert,
  SentinelSubscription,
  UpstreamAnalysis,
  UpstreamCommit,
} from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function tmpDeployDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "clawhq-sentinel-test-"));
  mkdirSync(join(dir, "cloud"), { recursive: true });
  mkdirSync(join(dir, "engine"), { recursive: true });
  mkdirSync(join(dir, "workspace", "memory", "hot"), { recursive: true });
  mkdirSync(join(dir, "workspace", "memory", "warm"), { recursive: true });
  mkdirSync(join(dir, "workspace", "memory", "cold"), { recursive: true });
  return dir;
}

function tmpDeployDirWithConfig(config: OpenClawConfig): string {
  const dir = tmpDeployDir();
  writeFileSync(
    join(dir, "engine", "openclaw.json"),
    JSON.stringify(config, null, 2),
  );
  return dir;
}

function makeCommit(overrides?: Partial<UpstreamCommit>): UpstreamCommit {
  return {
    sha: "abc123def456",
    message: overrides?.message ?? "feat: update config schema",
    date: "2026-03-30T10:00:00Z",
    author: "contributor",
    filesChanged: overrides?.filesChanged ?? ["src/config/schema.ts"],
    ...overrides,
  };
}

function makeFingerprint(overrides?: Partial<ConfigFingerprint>): ConfigFingerprint {
  return {
    agentId: "test-agent-id-12",
    openclawVersion: "0.8.6",
    configKeysSet: ["dangerouslyDisableDeviceAuth", "allowedOrigins", "tools", "gateway"],
    toolsEnabled: ["email", "calendar"],
    channelsConfigured: ["telegram"],
    cronJobCount: 2,
    hasIdentityConfig: true,
    hasGatewayConfig: true,
    hasAgentsConfig: false,
    landminesPassed: ["LM-01", "LM-02"],
    generatedAt: "2026-03-30T10:00:00Z",
    ...overrides,
  };
}

function makeAlert(overrides?: Partial<SentinelAlert>): SentinelAlert {
  return {
    id: "sentinel-test-1",
    category: "config-breakage",
    severity: "warning",
    title: "Config breakage: gateway (type-changed)",
    upstreamChange: "gateway change in src/gateway/server.ts: refactor: gateway types",
    configImpact: "Your deployment uses custom gateway configuration.",
    recommendedAction: "Review the changes before updating.",
    commitShas: ["abc123"],
    createdAt: "2026-03-30T10:00:00Z",
    ...overrides,
  };
}

// ── Fingerprint Tests ──────────────────────────────────────────────────────

describe("config fingerprint", () => {
  it("generates fingerprint from empty deploy dir", () => {
    const deployDir = tmpDeployDir();
    const fp = generateFingerprint(deployDir);

    expect(fp.agentId).toHaveLength(16);
    expect(fp.openclawVersion).toBe("unknown");
    expect(fp.configKeysSet).toEqual([]);
    expect(fp.toolsEnabled).toEqual([]);
    expect(fp.channelsConfigured).toEqual([]);
    expect(fp.cronJobCount).toBe(0);
    expect(fp.hasIdentityConfig).toBe(false);
    expect(fp.hasGatewayConfig).toBe(false);
    expect(fp.hasAgentsConfig).toBe(false);
    expect(fp.generatedAt).toBeDefined();
  });

  it("extracts config keys from openclaw.json", () => {
    const config: OpenClawConfig = {
      dangerouslyDisableDeviceAuth: true,
      allowedOrigins: [`http://localhost:${GATEWAY_DEFAULT_PORT}`],
      tools: { exec: { host: "gateway", security: "full" } },
      gateway: { port: GATEWAY_DEFAULT_PORT, bind: "0.0.0.0" },
    };
    const deployDir = tmpDeployDirWithConfig(config);
    const fp = generateFingerprint(deployDir);

    expect(fp.configKeysSet).toContain("dangerouslyDisableDeviceAuth");
    expect(fp.configKeysSet).toContain("allowedOrigins");
    expect(fp.configKeysSet).toContain("tools");
    expect(fp.configKeysSet).toContain("gateway");
    expect(fp.hasGatewayConfig).toBe(true);
  });

  it("extracts channel types without values", () => {
    const config: OpenClawConfig = {
      channels: {
        telegram: { enabled: true },
        signal: { enabled: false },
      },
    };
    const deployDir = tmpDeployDirWithConfig(config);
    const fp = generateFingerprint(deployDir);

    expect(fp.channelsConfigured).toEqual(["signal", "telegram"]);
  });

  it("includes blueprint ID when provided", () => {
    const deployDir = tmpDeployDir();
    const fp = generateFingerprint(deployDir, "email-manager");

    expect(fp.blueprintId).toBe("email-manager");
  });

  it("runs landmine validators on config", () => {
    const config: OpenClawConfig = {
      dangerouslyDisableDeviceAuth: true,
      allowedOrigins: [`http://localhost:${GATEWAY_DEFAULT_PORT}`],
      trustedProxies: ["172.17.0.1"],
      tools: { exec: { host: "gateway", security: "full" } },
      fs: { workspaceOnly: true },
    };
    const deployDir = tmpDeployDirWithConfig(config);
    const fp = generateFingerprint(deployDir);

    expect(fp.landminesPassed).toContain("LM-01");
    expect(fp.landminesPassed).toContain("LM-02");
  });

  it("produces deterministic agent ID for same deploy dir", () => {
    const deployDir = tmpDeployDir();
    const fp1 = generateFingerprint(deployDir);
    const fp2 = generateFingerprint(deployDir);

    expect(fp1.agentId).toBe(fp2.agentId);
  });

  it("counts cron jobs from cron/jobs.json", () => {
    const deployDir = tmpDeployDir();
    const cronDir = join(deployDir, "engine", "cron");
    mkdirSync(cronDir, { recursive: true });
    writeFileSync(
      join(cronDir, "jobs.json"),
      JSON.stringify([{ id: "j1" }, { id: "j2" }, { id: "j3" }]),
    );

    const fp = generateFingerprint(deployDir);
    expect(fp.cronJobCount).toBe(3);
  });
});

// ── Upstream Monitor Tests ────────────────────────────────────────────────

describe("upstream monitor", () => {
  describe("classifyConfigImpacts", () => {
    it("detects config-schema changes as breaking", () => {
      const commit = makeCommit({
        filesChanged: ["src/config/schema.ts"],
      });
      const impacts = classifyConfigImpacts(commit);

      expect(impacts.length).toBeGreaterThanOrEqual(1);
      expect(impacts.some((i) => i.level === "breaking" || i.level === "high")).toBe(true);
    });

    it("detects gateway changes as high impact", () => {
      const commit = makeCommit({
        filesChanged: ["src/gateway/server.ts"],
      });
      const impacts = classifyConfigImpacts(commit);

      expect(impacts.length).toBeGreaterThanOrEqual(1);
      expect(impacts[0].configPath).toBe("gateway");
      expect(impacts[0].level).toBe("high");
    });

    it("detects Dockerfile changes as high impact", () => {
      const commit = makeCommit({
        filesChanged: ["Dockerfile"],
      });
      const impacts = classifyConfigImpacts(commit);

      expect(impacts.length).toBe(1);
      expect(impacts[0].configPath).toBe("container");
    });

    it("returns empty impacts for non-config files", () => {
      const commit = makeCommit({
        filesChanged: ["README.md", "docs/api.md", ".github/workflows/ci.yml"],
      });
      const impacts = classifyConfigImpacts(commit);

      expect(impacts).toHaveLength(0);
    });

    it("detects change type from commit message", () => {
      const removed = makeCommit({ message: "chore: remove old config handler" });
      expect(classifyConfigImpacts(removed)[0]?.changeType).toBe("removed");

      const deprecated = makeCommit({ message: "feat: deprecate legacy gateway mode" });
      expect(classifyConfigImpacts(deprecated)[0]?.changeType).toBe("deprecated");

      const renamed = makeCommit({ message: "refactor: rename config fields" });
      expect(classifyConfigImpacts(renamed)[0]?.changeType).toBe("renamed");
    });

    it("produces one impact per file at most", () => {
      const commit = makeCommit({
        filesChanged: ["src/config/schema.ts"],
      });
      const impacts = classifyConfigImpacts(commit);

      // Even though the file matches multiple patterns, only one impact per file
      expect(impacts).toHaveLength(1);
    });
  });

  describe("analyzeUpstreamCommits", () => {
    it("returns empty analysis for no commits", () => {
      const analysis = analyzeUpstreamCommits([]);
      expect(analysis.commits).toHaveLength(0);
      expect(analysis.impacts).toHaveLength(0);
      expect(analysis.hasBreakingChanges).toBe(false);
    });

    it("aggregates impacts across multiple commits", () => {
      const commits: UpstreamCommit[] = [
        makeCommit({ sha: "aaa", filesChanged: ["src/gateway/server.ts"] }),
        makeCommit({ sha: "bbb", filesChanged: ["Dockerfile"] }),
        makeCommit({ sha: "ccc", filesChanged: ["README.md"] }),
      ];
      const analysis = analyzeUpstreamCommits(commits);

      expect(analysis.commits).toHaveLength(3);
      expect(analysis.impacts).toHaveLength(2); // gateway + container
    });

    it("flags breaking changes", () => {
      const commits: UpstreamCommit[] = [
        makeCommit({ filesChanged: ["src/core/schema.ts"] }),
      ];
      const analysis = analyzeUpstreamCommits(commits);

      expect(analysis.hasBreakingChanges).toBe(true);
    });
  });
});

// ── Breakage Analyzer Tests ───────────────────────────────────────────────

describe("breakage analyzer", () => {
  describe("predictBreakage", () => {
    it("predicts breakage when user config uses affected area", () => {
      const analysis: UpstreamAnalysis = {
        commits: [makeCommit()],
        impacts: [{
          commitSha: "abc123",
          configPath: "gateway",
          changeType: "type-changed",
          level: "high",
          description: "gateway type change",
        }],
        hasBreakingChanges: false,
        analyzedAt: "2026-03-30T10:00:00Z",
      };
      const fp = makeFingerprint({ hasGatewayConfig: true });

      const report = predictBreakage(analysis, fp);

      expect(report.predictions).toHaveLength(1);
      expect(report.predictions[0].affectedConfigKey).toBe("hasGatewayConfig");
      expect(report.shouldHoldUpdate).toBe(true);
    });

    it("returns no predictions when user config is unaffected", () => {
      const analysis: UpstreamAnalysis = {
        commits: [makeCommit()],
        impacts: [{
          commitSha: "abc123",
          configPath: "gateway",
          changeType: "type-changed",
          level: "high",
          description: "gateway type change",
        }],
        hasBreakingChanges: false,
        analyzedAt: "2026-03-30T10:00:00Z",
      };
      const fp = makeFingerprint({ hasGatewayConfig: false });

      const report = predictBreakage(analysis, fp);

      expect(report.predictions).toHaveLength(0);
      expect(report.shouldHoldUpdate).toBe(false);
    });

    it("sorts predictions by severity", () => {
      const analysis: UpstreamAnalysis = {
        commits: [makeCommit()],
        impacts: [
          { commitSha: "a", configPath: "cron", changeType: "added", level: "medium", description: "cron change" },
          { commitSha: "b", configPath: "config-schema", changeType: "removed", level: "breaking", description: "schema change" },
          { commitSha: "c", configPath: "gateway", changeType: "renamed", level: "high", description: "gateway change" },
        ],
        hasBreakingChanges: true,
        analyzedAt: "2026-03-30T10:00:00Z",
      };
      const fp = makeFingerprint({ cronJobCount: 3, hasGatewayConfig: true });

      const report = predictBreakage(analysis, fp);

      expect(report.predictions.length).toBeGreaterThanOrEqual(2);
      // First should be breaking, then high
      const levels = report.predictions.map((p) => p.impact.level);
      expect(levels[0]).toBe("breaking");
    });

    it("recommends holding update for breaking/high changes", () => {
      const analysis: UpstreamAnalysis = {
        commits: [makeCommit()],
        impacts: [{
          commitSha: "abc",
          configPath: "container",
          changeType: "type-changed",
          level: "high",
          description: "container change",
        }],
        hasBreakingChanges: false,
        analyzedAt: "2026-03-30T10:00:00Z",
      };
      const fp = makeFingerprint();

      const report = predictBreakage(analysis, fp);
      expect(report.shouldHoldUpdate).toBe(true);
    });
  });

  describe("breakageToAlerts", () => {
    it("converts breakage predictions to alerts", () => {
      const analysis: UpstreamAnalysis = {
        commits: [makeCommit()],
        impacts: [{
          commitSha: "abc123",
          configPath: "gateway",
          changeType: "type-changed",
          level: "high",
          description: "gateway type change",
        }],
        hasBreakingChanges: false,
        analyzedAt: "2026-03-30T10:00:00Z",
      };
      const fp = makeFingerprint({ hasGatewayConfig: true });
      const report = predictBreakage(analysis, fp);
      const alerts = breakageToAlerts(report);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].category).toBe("config-breakage");
      expect(alerts[0].severity).toBe("warning");
      expect(alerts[0].commitShas).toContain("abc123");
    });

    it("returns empty for no predictions", () => {
      const analysis: UpstreamAnalysis = {
        commits: [],
        impacts: [],
        hasBreakingChanges: false,
        analyzedAt: "2026-03-30T10:00:00Z",
      };
      const fp = makeFingerprint();
      const report = predictBreakage(analysis, fp);
      const alerts = breakageToAlerts(report);

      expect(alerts).toHaveLength(0);
    });

    it("sets critical severity for breaking changes", () => {
      const analysis: UpstreamAnalysis = {
        commits: [makeCommit()],
        impacts: [{
          commitSha: "abc",
          configPath: "config-schema",
          changeType: "removed",
          level: "breaking",
          description: "schema removed",
        }],
        hasBreakingChanges: true,
        analyzedAt: "2026-03-30T10:00:00Z",
      };
      const fp = makeFingerprint();
      const report = predictBreakage(analysis, fp);
      const alerts = breakageToAlerts(report);

      expect(alerts[0].severity).toBe("critical");
    });
  });
});

// ── Alert Formatting Tests ────────────────────────────────────────────────

describe("alert formatting", () => {
  it("formats a single alert with all fields", () => {
    const alert = makeAlert();
    const output = formatAlert(alert);

    expect(output).toContain("[~]"); // warning icon
    expect(output).toContain("Config breakage: gateway");
    expect(output).toContain("Category:");
    expect(output).toContain("Upstream:");
    expect(output).toContain("Impact:");
    expect(output).toContain("Action:");
    expect(output).toContain("abc123");
  });

  it("uses critical icon for critical alerts", () => {
    const alert = makeAlert({ severity: "critical" });
    const output = formatAlert(alert);

    expect(output).toContain("[!]");
  });

  it("uses info icon for info alerts", () => {
    const alert = makeAlert({ severity: "info" });
    const output = formatAlert(alert);

    expect(output).toContain("[i]");
  });

  it("formats empty alerts list", () => {
    const output = formatAlerts([]);
    expect(output).toBe("No alerts.");
  });

  it("formats multiple alerts with separator", () => {
    const alerts = [makeAlert({ id: "a1" }), makeAlert({ id: "a2" })];
    const output = formatAlerts(alerts);

    expect(output).toContain("Sentinel Alerts (2)");
    expect(output).toContain("─");
  });
});

// ── Alert Delivery Tests ──────────────────────────────────────────────────

describe("alert delivery", () => {
  it("returns CLI-only result when no delivery methods configured", async () => {
    const alert = makeAlert();
    const results = await deliverAlert(alert, {});

    expect(results).toHaveLength(1);
    expect(results[0].method).toBe("cli");
    expect(results[0].success).toBe(true);
  });
});

// ── Subscription State Tests ──────────────────────────────────────────────

describe("subscription state", () => {
  describe("readSentinelState", () => {
    it("returns default inactive state when no file exists", () => {
      const deployDir = tmpDeployDir();
      const state = readSentinelState(deployDir);

      expect(state.version).toBe(1);
      expect(state.active).toBe(false);
      expect(state.tier).toBe("free");
      expect(state.consecutiveFailures).toBe(0);
    });

    it("reads persisted state", () => {
      const deployDir = tmpDeployDir();
      const state: SentinelSubscription = {
        version: 1,
        active: true,
        tier: "pro",
        token: "test-token",
        activatedAt: "2026-03-30T10:00:00Z",
        consecutiveFailures: 0,
      };
      writeSentinelState(deployDir, state);

      const read = readSentinelState(deployDir);
      expect(read.active).toBe(true);
      expect(read.tier).toBe("pro");
      expect(read.token).toBe("test-token");
    });
  });

  describe("writeSentinelState", () => {
    it("creates cloud directory if missing", () => {
      const dir = mkdtempSync(join(tmpdir(), "clawhq-sentinel-test-"));
      // No cloud/ dir
      const state: SentinelSubscription = {
        version: 1,
        active: true,
        tier: "free",
        consecutiveFailures: 0,
      };
      writeSentinelState(dir, state);

      const read = readSentinelState(dir);
      expect(read.active).toBe(true);
    });

    it("overwrites existing state", () => {
      const deployDir = tmpDeployDir();
      writeSentinelState(deployDir, {
        version: 1, active: true, tier: "free", consecutiveFailures: 0,
      });
      writeSentinelState(deployDir, {
        version: 1, active: false, tier: "pro", consecutiveFailures: 3,
      });

      const read = readSentinelState(deployDir);
      expect(read.active).toBe(false);
      expect(read.tier).toBe("pro");
      expect(read.consecutiveFailures).toBe(3);
    });
  });

  describe("sentinelPath", () => {
    it("resolves to cloud/sentinel.json", () => {
      const path = sentinelPath("/home/user/.clawhq");
      expect(path).toBe("/home/user/.clawhq/cloud/sentinel.json");
    });
  });

  describe("disconnectSentinel", () => {
    it("deactivates an active subscription", () => {
      const deployDir = tmpDeployDir();
      writeSentinelState(deployDir, {
        version: 1, active: true, tier: "pro", consecutiveFailures: 0,
      });

      const result = disconnectSentinel(deployDir);
      expect(result.success).toBe(true);
      expect(result.wasActive).toBe(true);

      const state = readSentinelState(deployDir);
      expect(state.active).toBe(false);
    });

    it("reports wasActive=false when not active", () => {
      const deployDir = tmpDeployDir();
      const result = disconnectSentinel(deployDir);

      expect(result.success).toBe(true);
      expect(result.wasActive).toBe(false);
    });
  });
});
