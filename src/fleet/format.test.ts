import { describe, expect, it } from "vitest";

import {
  formatFleetDashboard,
  formatFleetDoctorTable,
  formatFleetJson,
} from "./format.js";
import type { FleetDoctorReport, FleetReport } from "./types.js";

function makeFleetReport(): FleetReport {
  return {
    timestamp: "2026-03-13T21:00:00Z",
    agents: [
      {
        agent: { id: "main", workspace: "/w", isDefault: true, openclawHome: "/h" },
        status: { state: "running", gatewayStatus: "up", gatewayLatencyMs: 12 },
        integrations: {
          integrations: [{ provider: "email", status: "valid", message: "OK" }],
          counts: { valid: 1, expired: 0, failing: 0, error: 0, missing: 0 },
        },
        workspace: {
          memoryTiers: [{ tier: "hot", path: "/h/memory/hot", sizeBytes: 1024, fileCount: 2 }],
          identityFiles: [{ name: "SOUL.md", path: "/h/SOUL.md", sizeBytes: 512, estimatedTokens: 128 }],
          totalMemoryBytes: 1024,
          totalIdentityTokens: 128,
        },
        egress: {
          today: { label: "Today", bytes: 0, calls: 0 },
          week: { label: "Week", bytes: 0, calls: 0 },
          month: { label: "Month", bytes: 0, calls: 0 },
          zeroEgress: true,
        },
      },
      {
        agent: { id: "work", workspace: "/w2", isDefault: false, openclawHome: "/h2" },
        status: { state: "stopped", gatewayStatus: "down" },
        integrations: {
          integrations: [{ provider: "calendar", status: "failing", message: "Expired" }],
          counts: { valid: 0, expired: 0, failing: 1, error: 0, missing: 0 },
        },
        workspace: {
          memoryTiers: [],
          identityFiles: [],
          totalMemoryBytes: 0,
          totalIdentityTokens: 0,
        },
        egress: {
          today: { label: "Today", bytes: 512, calls: 2 },
          week: { label: "Week", bytes: 2048, calls: 8 },
          month: { label: "Month", bytes: 4096, calls: 16 },
          zeroEgress: false,
        },
      },
    ],
    health: { total: 2, running: 1, stopped: 1, degraded: 0, unknown: 0 },
    cost: {
      totalEgressBytes: 4096,
      totalEgressCalls: 16,
      zeroEgressCount: 1,
      perAgent: [
        { agentId: "main", egressBytes: 0, egressCalls: 0, zeroEgress: true },
        { agentId: "work", egressBytes: 4096, egressCalls: 16, zeroEgress: false },
      ],
    },
    security: {
      totalIntegrations: 2,
      validCount: 1,
      failingCount: 1,
      perAgent: [
        { agentId: "main", valid: 1, failing: 0, total: 1 },
        { agentId: "work", valid: 0, failing: 1, total: 1 },
      ],
    },
  };
}

describe("formatFleetDashboard", () => {
  it("renders all fleet sections", () => {
    const report = makeFleetReport();
    const output = formatFleetDashboard(report);

    // Health section
    expect(output).toContain("FLEET HEALTH");
    expect(output).toContain("Total agents: 2");
    expect(output).toContain("Running:      1");
    expect(output).toContain("Stopped:      1");
    expect(output).toContain("main");
    expect(output).toContain("work");

    // Cost section
    expect(output).toContain("FLEET COST");
    expect(output).toContain("Zero-egress agents: 1/2");

    // Security section
    expect(output).toContain("FLEET SECURITY");
    expect(output).toContain("Total integrations: 2");
    expect(output).toContain("Failing:            1");

    // Per-agent drill-down
    expect(output).toContain("PER-AGENT DETAILS");
    expect(output).toContain("main (default)");
    expect(output).toContain("RUNNING");
    expect(output).toContain("STOPPED");
  });
});

describe("formatFleetJson", () => {
  it("returns valid JSON", () => {
    const report = makeFleetReport();
    const json = formatFleetJson(report);
    const parsed = JSON.parse(json);

    expect(parsed.health.total).toBe(2);
    expect(parsed.agents).toHaveLength(2);
  });
});

describe("formatFleetDoctorTable", () => {
  it("renders per-agent doctor results and summary", () => {
    const report: FleetDoctorReport = {
      timestamp: "2026-03-13T21:00:00Z",
      entries: [
        {
          agentId: "main",
          report: {
            checks: [
              { name: "Docker daemon", status: "pass", message: "Docker is running", fix: "" },
              { name: "Config validation", status: "warn", message: "Minor issue", fix: "Fix it" },
            ],
            passed: true,
            counts: { pass: 1, warn: 1, fail: 0 },
          },
        },
        {
          agentId: "work",
          report: {
            checks: [
              { name: "Docker daemon", status: "fail", message: "Not running", fix: "Start Docker" },
            ],
            passed: false,
            counts: { pass: 0, warn: 0, fail: 1 },
          },
        },
      ],
      allPassed: false,
      totals: { pass: 1, warn: 1, fail: 1 },
    };

    const output = formatFleetDoctorTable(report);

    expect(output).toContain("DOCTOR: main");
    expect(output).toContain("DOCTOR: work");
    expect(output).toContain("FLEET DOCTOR SUMMARY");
    expect(output).toContain("All passed: NO");
    expect(output).toContain("1 passed, 1 warnings, 1 failed");
  });
});
