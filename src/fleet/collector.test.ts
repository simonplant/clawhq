import { describe, expect, it } from "vitest";

import { collectFleetStatus } from "./collector.js";
import type { FleetAgent } from "./types.js";

describe("collectFleetStatus", () => {
  it("returns aggregated report for multiple agents", async () => {
    // Use nonexistent paths — collectors handle missing state gracefully
    const agents: FleetAgent[] = [
      {
        id: "agent-a",
        workspace: "/tmp/nonexistent-fleet-a/workspace",
        isDefault: true,
        openclawHome: "/tmp/nonexistent-fleet-a",
      },
      {
        id: "agent-b",
        workspace: "/tmp/nonexistent-fleet-b/workspace",
        isDefault: false,
        openclawHome: "/tmp/nonexistent-fleet-b",
      },
    ];

    const report = await collectFleetStatus(agents);

    // Report structure
    expect(report.timestamp).toBeTruthy();
    expect(report.agents).toHaveLength(2);

    // Health aggregation
    expect(report.health.total).toBe(2);
    expect(
      report.health.running + report.health.stopped + report.health.degraded + report.health.unknown,
    ).toBe(2);

    // Cost aggregation
    expect(report.cost.perAgent).toHaveLength(2);
    expect(report.cost.perAgent[0].agentId).toBe("agent-a");
    expect(report.cost.perAgent[1].agentId).toBe("agent-b");
    expect(typeof report.cost.totalEgressBytes).toBe("number");
    expect(typeof report.cost.totalEgressCalls).toBe("number");

    // Security aggregation
    expect(report.security.perAgent).toHaveLength(2);
    expect(typeof report.security.totalIntegrations).toBe("number");
    expect(typeof report.security.validCount).toBe("number");
  });

  it("handles empty agent list", async () => {
    const report = await collectFleetStatus([]);

    expect(report.agents).toHaveLength(0);
    expect(report.health.total).toBe(0);
    expect(report.cost.perAgent).toHaveLength(0);
    expect(report.security.perAgent).toHaveLength(0);
  });
});
