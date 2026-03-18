import { describe, expect, it } from "vitest";

import { runFleetDoctor } from "./doctor.js";
import type { FleetAgent } from "./types.js";

describe("runFleetDoctor", () => {
  it("runs diagnostics across multiple agents", async () => {
    // Use nonexistent paths — checks handle missing state gracefully
    const agents: FleetAgent[] = [
      {
        id: "agent-a",
        workspace: "/tmp/nonexistent-fleet-doctor-a/workspace",
        isDefault: true,
        openclawHome: "/tmp/nonexistent-fleet-doctor-a",
      },
      {
        id: "agent-b",
        workspace: "/tmp/nonexistent-fleet-doctor-b/workspace",
        isDefault: false,
        openclawHome: "/tmp/nonexistent-fleet-doctor-b",
      },
    ];

    const report = await runFleetDoctor(agents);

    expect(report.timestamp).toBeTruthy();
    expect(report.entries).toHaveLength(2);
    expect(report.entries[0].agentId).toBe("agent-a");
    expect(report.entries[1].agentId).toBe("agent-b");

    // Each entry has a doctor report
    for (const entry of report.entries) {
      expect(entry.report).toBeDefined();
      expect(entry.report.counts).toBeDefined();
      expect(typeof entry.report.counts.pass).toBe("number");
      expect(typeof entry.report.counts.warn).toBe("number");
      expect(typeof entry.report.counts.fail).toBe("number");
    }

    // Totals are aggregated
    expect(typeof report.totals.pass).toBe("number");
    expect(typeof report.totals.warn).toBe("number");
    expect(typeof report.totals.fail).toBe("number");
    expect(typeof report.allPassed).toBe("boolean");
  });

  it("handles empty agent list", async () => {
    const report = await runFleetDoctor([]);

    expect(report.entries).toHaveLength(0);
    expect(report.allPassed).toBe(true);
    expect(report.totals).toEqual({ pass: 0, warn: 0, fail: 0 });
  });
});
