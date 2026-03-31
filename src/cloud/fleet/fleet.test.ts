import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DIR_MODE_SECRET, GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";

import {
  discoverFleet,
  readFleetRegistry,
  registerAgent,
  unregisterAgent,
} from "./discovery.js";
import { runFleetDoctor } from "./doctor.js";
import {
  formatFleetDoctor,
  formatFleetDoctorJson,
  formatFleetHealth,
  formatFleetHealthJson,
  formatFleetList,
  formatFleetListJson,
} from "./format.js";
import { getFleetHealth } from "./health.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function tmpDeployDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "clawhq-fleet-test-"));
  mkdirSync(join(dir, "cloud"), { recursive: true });
  return dir;
}

function tmpAgentDir(options?: { configured?: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), "clawhq-agent-"));
  mkdirSync(join(dir, "cloud"), { recursive: true });
  mkdirSync(join(dir, "engine"), { recursive: true });
  mkdirSync(join(dir, "workspace", "memory", "hot"), { recursive: true });
  mkdirSync(join(dir, "workspace", "memory", "warm"), { recursive: true });
  mkdirSync(join(dir, "workspace", "memory", "cold"), { recursive: true });

  if (options?.configured !== false) {
    writeFileSync(
      join(dir, "engine", "openclaw.json"),
      JSON.stringify({ gateway: { port: GATEWAY_DEFAULT_PORT } }),
    );
    writeFileSync(
      join(dir, "engine", "docker-compose.yml"),
      "version: '3'\n",
    );
  }

  return dir;
}

// ── Registry Tests ──────────────────────────────────────────────────────────

describe("fleet registry", () => {
  describe("readFleetRegistry", () => {
    it("returns empty registry when no file exists", () => {
      const deployDir = tmpDeployDir();
      const registry = readFleetRegistry(deployDir);
      expect(registry.version).toBe(1);
      expect(registry.agents).toHaveLength(0);
    });
  });

  describe("registerAgent", () => {
    it("registers a new agent", () => {
      const deployDir = tmpDeployDir();
      const agentDir = tmpAgentDir();

      const agent = registerAgent(deployDir, "test-agent", agentDir);
      expect(agent.name).toBe("test-agent");
      expect(agent.deployDir).toBe(agentDir);
      expect(agent.addedAt).toBeDefined();

      const registry = readFleetRegistry(deployDir);
      expect(registry.agents).toHaveLength(1);
      expect(registry.agents[0].name).toBe("test-agent");
    });

    it("creates cloud/ directory with mode 0700", () => {
      const deployDir = mkdtempSync(join(tmpdir(), "clawhq-fleet-test-"));
      // Do NOT pre-create cloud/ — let registerAgent create it
      const agentDir = tmpAgentDir();

      registerAgent(deployDir, "test-agent", agentDir);

      const cloudDir = join(deployDir, "cloud");
      const stat = statSync(cloudDir);
      expect(stat.mode & 0o777).toBe(DIR_MODE_SECRET);
    });

    it("returns existing agent when registering duplicate path", () => {
      const deployDir = tmpDeployDir();
      const agentDir = tmpAgentDir();

      const first = registerAgent(deployDir, "agent-1", agentDir);
      const second = registerAgent(deployDir, "agent-1-dup", agentDir);

      expect(first.addedAt).toBe(second.addedAt);

      const registry = readFleetRegistry(deployDir);
      expect(registry.agents).toHaveLength(1);
    });

    it("registers multiple agents", () => {
      const deployDir = tmpDeployDir();
      const agentDir1 = tmpAgentDir();
      const agentDir2 = tmpAgentDir();

      registerAgent(deployDir, "agent-1", agentDir1);
      registerAgent(deployDir, "agent-2", agentDir2);

      const registry = readFleetRegistry(deployDir);
      expect(registry.agents).toHaveLength(2);
    });
  });

  describe("unregisterAgent", () => {
    it("removes an agent by name", () => {
      const deployDir = tmpDeployDir();
      const agentDir = tmpAgentDir();

      registerAgent(deployDir, "test-agent", agentDir);
      const removed = unregisterAgent(deployDir, "test-agent");
      expect(removed).toBe(true);

      const registry = readFleetRegistry(deployDir);
      expect(registry.agents).toHaveLength(0);
    });

    it("removes an agent by path", () => {
      const deployDir = tmpDeployDir();
      const agentDir = tmpAgentDir();

      registerAgent(deployDir, "test-agent", agentDir);
      const removed = unregisterAgent(deployDir, agentDir);
      expect(removed).toBe(true);
    });

    it("returns false when agent not found", () => {
      const deployDir = tmpDeployDir();
      const removed = unregisterAgent(deployDir, "nonexistent");
      expect(removed).toBe(false);
    });
  });
});

// ── Discovery Tests ─────────────────────────────────────────────────────────

describe("fleet discovery", () => {
  it("discovers configured agents", async () => {
    const deployDir = tmpDeployDir();
    const agentDir = tmpAgentDir({ configured: true });

    registerAgent(deployDir, "my-agent", agentDir);
    const result = await discoverFleet(deployDir);

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].exists).toBe(true);
    expect(result.agents[0].configured).toBe(true);
    expect(result.agents[0].health).toBeDefined();
    expect(result.agents[0].health?.agentId).toHaveLength(16);
    expect(result.activeCount).toBe(1);
  });

  it("marks unconfigured agents", async () => {
    const deployDir = tmpDeployDir();
    const agentDir = tmpAgentDir({ configured: false });

    registerAgent(deployDir, "unconfigured", agentDir);
    const result = await discoverFleet(deployDir);

    expect(result.agents[0].exists).toBe(true);
    expect(result.agents[0].configured).toBe(false);
    expect(result.agents[0].health).toBeUndefined();
    expect(result.activeCount).toBe(0);
  });

  it("marks missing agents", async () => {
    const deployDir = tmpDeployDir();

    registerAgent(deployDir, "ghost", "/tmp/nonexistent-clawhq-agent");
    const result = await discoverFleet(deployDir);

    expect(result.agents[0].exists).toBe(false);
    expect(result.agents[0].configured).toBe(false);
    expect(result.activeCount).toBe(0);
  });

  it("returns empty result for empty registry", async () => {
    const deployDir = tmpDeployDir();
    const result = await discoverFleet(deployDir);
    expect(result.agents).toHaveLength(0);
    expect(result.activeCount).toBe(0);
    expect(result.totalCount).toBe(0);
  });
});

// ── Health Aggregation Tests ────────────────────────────────────────────────

describe("fleet health", () => {
  it("reports unhealthy when Docker is unavailable (no false positives from file existence)", async () => {
    const deployDir = tmpDeployDir();
    const agentDir = tmpAgentDir();

    registerAgent(deployDir, "agent", agentDir);
    const health = await getFleetHealth(deployDir);

    // Docker is not available in test — configured agent should be unhealthy, not falsely healthy
    expect(health.unhealthyCount).toBe(1);
    expect(health.healthyCount).toBe(0);
    expect(health.allHealthy).toBe(false);
  });

  it("reports unavailable for missing agents", async () => {
    const deployDir = tmpDeployDir();

    registerAgent(deployDir, "ghost", "/tmp/nonexistent-clawhq-agent");
    const health = await getFleetHealth(deployDir);

    expect(health.healthyCount).toBe(0);
    expect(health.unavailableCount).toBe(1);
    expect(health.allHealthy).toBe(false);
  });

  it("reports not all healthy with mixed agents", async () => {
    const deployDir = tmpDeployDir();
    const agentDir1 = tmpAgentDir({ configured: true });
    const agentDir2 = tmpAgentDir({ configured: false });

    registerAgent(deployDir, "good", agentDir1);
    registerAgent(deployDir, "bad", agentDir2);
    const health = await getFleetHealth(deployDir);

    // Docker unavailable in test: configured agent is unhealthy, unconfigured is unavailable
    expect(health.unhealthyCount).toBe(1);
    expect(health.unavailableCount).toBe(1);
    expect(health.allHealthy).toBe(false);
  });

  it("reports not all healthy with empty fleet", async () => {
    const deployDir = tmpDeployDir();
    const health = await getFleetHealth(deployDir);
    expect(health.allHealthy).toBe(false);
  });
});

// ── Fleet Doctor Tests ──────────────────────────────────────────────────────

describe("fleet doctor", () => {
  it("runs doctor across all agents in parallel", async () => {
    const deployDir = tmpDeployDir();
    const agentDir1 = tmpAgentDir();
    const agentDir2 = tmpAgentDir();

    registerAgent(deployDir, "agent-1", agentDir1);
    registerAgent(deployDir, "agent-2", agentDir2);

    const report = await runFleetDoctor(deployDir);

    expect(report.agents).toHaveLength(2);
    expect(report.agents[0].name).toBe("agent-1");
    expect(report.agents[1].name).toBe("agent-2");
    expect(report.agents[0].report).toBeDefined();
    expect(report.agents[1].report).toBeDefined();
  });

  it("reports unreachable agents", async () => {
    const deployDir = tmpDeployDir();
    registerAgent(deployDir, "ghost", "/tmp/nonexistent-clawhq-agent");

    const report = await runFleetDoctor(deployDir);

    expect(report.agents[0].error).toContain("does not exist");
    expect(report.unreachableCount).toBe(1);
    expect(report.allHealthy).toBe(false);
  });

  it("returns empty report for empty fleet", async () => {
    const deployDir = tmpDeployDir();
    const report = await runFleetDoctor(deployDir);

    expect(report.agents).toHaveLength(0);
    expect(report.allHealthy).toBe(false);
  });
});

// ── Formatter Tests ─────────────────────────────────────────────────────────

describe("fleet formatters", () => {
  describe("formatFleetList", () => {
    it("shows empty message for empty registry", () => {
      const output = formatFleetList({ version: 1, agents: [] });
      expect(output).toContain("No agents registered");
    });

    it("shows agents in table format", () => {
      const output = formatFleetList({
        version: 1,
        agents: [
          { name: "prod", deployDir: "/opt/clawhq", addedAt: "2026-03-19T00:00:00Z" },
        ],
      });
      expect(output).toContain("prod");
      expect(output).toContain("/opt/clawhq");
    });

    it("produces valid JSON", () => {
      const json = formatFleetListJson({
        version: 1,
        agents: [
          { name: "prod", deployDir: "/opt/clawhq", addedAt: "2026-03-19T00:00:00Z" },
        ],
      });
      const parsed = JSON.parse(json);
      expect(parsed.agents).toHaveLength(1);
    });
  });

  describe("formatFleetHealth", () => {
    it("shows empty message for no agents", () => {
      const output = formatFleetHealth({
        agents: [],
        healthyCount: 0,
        unhealthyCount: 0,
        unavailableCount: 0,
        allHealthy: false,
        timestamp: new Date().toISOString(),
      });
      expect(output).toContain("No agents registered");
    });

    it("shows healthy summary", () => {
      const output = formatFleetHealth({
        agents: [
          {
            name: "prod",
            deployDir: "/opt/clawhq",
            exists: true,
            configured: true,
            health: {
              agentId: "abc123",
              trustMode: "zero-trust",
              containerRunning: true,
              uptimeSeconds: 3600,
              integrationCount: 3,
              memoryTierSizes: { hot: 100, warm: 200, cold: 300 },
              diskUsagePercent: 0,
              timestamp: new Date().toISOString(),
            },
          },
        ],
        healthyCount: 1,
        unhealthyCount: 0,
        unavailableCount: 0,
        allHealthy: true,
        timestamp: new Date().toISOString(),
      });
      expect(output).toContain("All 1 agent(s) healthy");
      expect(output).toContain("✔ running");
    });

    it("produces valid JSON", () => {
      const json = formatFleetHealthJson({
        agents: [],
        healthyCount: 0,
        unhealthyCount: 0,
        unavailableCount: 0,
        allHealthy: false,
        timestamp: new Date().toISOString(),
      });
      const parsed = JSON.parse(json);
      expect(parsed.allHealthy).toBe(false);
    });
  });

  describe("formatFleetDoctor", () => {
    it("shows empty message for no agents", () => {
      const output = formatFleetDoctor({
        agents: [],
        healthyCount: 0,
        unhealthyCount: 0,
        unreachableCount: 0,
        allHealthy: false,
        timestamp: new Date().toISOString(),
      });
      expect(output).toContain("No agents registered");
    });

    it("produces valid JSON", () => {
      const json = formatFleetDoctorJson({
        agents: [],
        healthyCount: 0,
        unhealthyCount: 0,
        unreachableCount: 0,
        allHealthy: false,
        timestamp: new Date().toISOString(),
      });
      const parsed = JSON.parse(json);
      expect(parsed.allHealthy).toBe(false);
    });
  });
});
