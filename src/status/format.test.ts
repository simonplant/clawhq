import { describe, expect, it } from "vitest";

import { formatDashboard, formatJson } from "./format.js";
import type { StatusReport } from "./types.js";

function makeReport(overrides: Partial<StatusReport> = {}): StatusReport {
  return {
    timestamp: "2026-03-13T11:00:00Z",
    agent: {
      state: "running",
      containerId: "abc123def456",
      containerName: "openclaw-agent",
      image: "openclaw:custom",
      uptime: "Up 2 hours",
      gatewayStatus: "up",
      gatewayLatencyMs: 12,
    },
    integrations: {
      integrations: [
        { provider: "Anthropic", status: "valid", message: "API key valid" },
        { provider: "OpenAI", status: "missing", message: "OPENAI_API_KEY not configured" },
        { provider: "Telegram", status: "valid", message: "Bot token valid" },
      ],
      counts: { valid: 2, expired: 0, failing: 0, error: 0, missing: 1 },
    },
    workspace: {
      memoryTiers: [
        { tier: "hot", path: "/tmp/memory/hot", sizeBytes: 45056, fileCount: 3 },
        { tier: "warm", path: "/tmp/memory/warm", sizeBytes: 122880, fileCount: 12 },
        { tier: "cold", path: "/tmp/memory/cold", sizeBytes: 0, fileCount: 0 },
      ],
      identityFiles: [
        { name: "IDENTITY.md", path: "/tmp/IDENTITY.md", sizeBytes: 4096, estimatedTokens: 1024 },
        { name: "USER.md", path: "/tmp/USER.md", sizeBytes: 2048, estimatedTokens: 512 },
      ],
      totalMemoryBytes: 167936,
      totalIdentityTokens: 1536,
    },
    egress: {
      today: { label: "today", bytes: 0, calls: 0 },
      week: { label: "this week", bytes: 0, calls: 0 },
      month: { label: "this month", bytes: 0, calls: 0 },
      zeroEgress: true,
    },
    ...overrides,
  };
}

describe("formatDashboard", () => {
  it("renders all four sections", () => {
    const output = formatDashboard(makeReport());

    expect(output).toContain("AGENT STATE");
    expect(output).toContain("INTEGRATION HEALTH");
    expect(output).toContain("WORKSPACE METRICS");
    expect(output).toContain("DATA EGRESS");
  });

  it("shows agent state as RUNNING", () => {
    const output = formatDashboard(makeReport());

    expect(output).toContain("RUNNING");
    expect(output).toContain("abc123def456".slice(0, 12));
    expect(output).toContain("openclaw:custom");
    expect(output).toContain("Up 2 hours");
  });

  it("shows stopped state gracefully", () => {
    const output = formatDashboard(makeReport({
      agent: { state: "stopped", gatewayStatus: "down" },
    }));

    expect(output).toContain("STOPPED");
    expect(output).toContain("DOWN");
  });

  it("shows integration health table", () => {
    const output = formatDashboard(makeReport());

    expect(output).toContain("Anthropic");
    expect(output).toContain("VALID");
    expect(output).toContain("SKIP");
    expect(output).toContain("2 valid");
  });

  it("shows zero-egress badge", () => {
    const output = formatDashboard(makeReport());

    expect(output).toContain("ZERO EGRESS");
  });

  it("does not show zero-egress badge when data was sent", () => {
    const output = formatDashboard(makeReport({
      egress: {
        today: { label: "today", bytes: 1024, calls: 5 },
        week: { label: "this week", bytes: 4096, calls: 20 },
        month: { label: "this month", bytes: 8192, calls: 50 },
        zeroEgress: false,
      },
    }));

    expect(output).not.toContain("ZERO EGRESS");
  });

  it("shows workspace memory tiers and identity files", () => {
    const output = formatDashboard(makeReport());

    expect(output).toContain("hot");
    expect(output).toContain("warm");
    expect(output).toContain("cold");
    expect(output).toContain("IDENTITY.md");
    expect(output).toContain("USER.md");
    expect(output).toContain("1024 tokens");
  });

  it("handles empty integrations", () => {
    const output = formatDashboard(makeReport({
      integrations: {
        integrations: [],
        counts: { valid: 0, expired: 0, failing: 0, error: 0, missing: 0 },
      },
    }));

    expect(output).toContain("No integrations configured");
  });
});

describe("formatJson", () => {
  it("outputs valid JSON with all sections", () => {
    const output = formatJson(makeReport());
    const parsed = JSON.parse(output) as StatusReport;

    expect(parsed.timestamp).toBe("2026-03-13T11:00:00Z");
    expect(parsed.agent.state).toBe("running");
    expect(parsed.integrations.integrations).toHaveLength(3);
    expect(parsed.workspace.memoryTiers).toHaveLength(3);
    expect(parsed.egress.zeroEgress).toBe(true);
  });
});
