import { describe, expect, it } from "vitest";

import { collectStatus } from "./collector.js";
import type { StatusReport } from "./types.js";

describe("collectStatus", () => {
  it("returns a StatusReport with all five sections", async () => {
    // Run with defaults — no agent running, no .env, no workspace, no egress log.
    // All collectors handle missing state gracefully.
    const report: StatusReport = await collectStatus({
      openclawHome: "/tmp/nonexistent-openclaw-test",
      envPath: "/tmp/nonexistent-env-test/.env",
      egressLogPath: "/tmp/nonexistent-egress-test/egress.log",
    });

    expect(report.timestamp).toBeTruthy();

    // Agent section
    expect(report.agent).toBeDefined();
    expect(["running", "stopped", "degraded", "unknown"]).toContain(report.agent.state);
    expect(["up", "down", "degraded"]).toContain(report.agent.gatewayStatus);

    // Integration section
    expect(report.integrations).toBeDefined();
    expect(report.integrations.counts).toBeDefined();

    // Channels section
    expect(report.channels).toBeInstanceOf(Array);

    // Workspace section
    expect(report.workspace).toBeDefined();
    expect(report.workspace.memoryTiers).toBeInstanceOf(Array);
    expect(report.workspace.identityFiles).toBeInstanceOf(Array);
    expect(typeof report.workspace.totalMemoryBytes).toBe("number");
    expect(typeof report.workspace.totalIdentityTokens).toBe("number");

    // Egress section
    expect(report.egress).toBeDefined();
    expect(report.egress.today).toBeDefined();
    expect(report.egress.week).toBeDefined();
    expect(report.egress.month).toBeDefined();
    expect(report.egress.zeroEgress).toBe(true);
  });

  it("reports stopped agent when Docker is not available", async () => {
    const report = await collectStatus({
      openclawHome: "/tmp/nonexistent-openclaw-test",
    });

    // Without Docker compose, agent should be stopped
    expect(report.agent.state).toBe("stopped");
  });
});
