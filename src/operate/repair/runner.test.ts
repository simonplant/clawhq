import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the dependencies
vi.mock("./monitor.js", () => ({
  detectIssues: vi.fn(),
}));

vi.mock("./actions.js", () => ({
  repairIssue: vi.fn(),
}));

vi.mock("./logger.js", () => ({
  logRepairAction: vi.fn(),
}));

import { repairIssue } from "./actions.js";
import { logRepairAction } from "./logger.js";
import { detectIssues } from "./monitor.js";
import { formatRepairReport, runRepair } from "./runner.js";
import type { DetectedIssue, RepairActionResult, RepairConfig, RepairContext, RepairReport } from "./types.js";
import { DEFAULT_REPAIR_CONFIG } from "./types.js";

function makeCtx(): RepairContext {
  return {
    openclawHome: "/tmp/openclaw",
    configPath: "/tmp/openclaw/openclaw.json",
  };
}

describe("runRepair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports all healthy when no issues detected", async () => {
    vi.mocked(detectIssues).mockResolvedValue([]);

    const report = await runRepair(makeCtx());

    expect(report.allHealthy).toBe(true);
    expect(report.issues).toHaveLength(0);
    expect(report.actions).toHaveLength(0);
  });

  it("repairs detected issues", async () => {
    const issue: DetectedIssue = {
      type: "gateway_down",
      message: "No container running",
      detectedAt: "2026-03-13T00:00:00Z",
    };
    vi.mocked(detectIssues).mockResolvedValue([issue]);

    const actionResult: RepairActionResult = {
      issue: "gateway_down",
      status: "repaired",
      action: "Container restart",
      message: "Container restarted",
      durationMs: 1500,
    };
    vi.mocked(repairIssue).mockResolvedValue(actionResult);
    vi.mocked(logRepairAction).mockResolvedValue(undefined);

    const report = await runRepair(makeCtx());

    expect(report.allHealthy).toBe(true);
    expect(report.actions).toHaveLength(1);
    expect(report.actions[0].status).toBe("repaired");
    expect(logRepairAction).toHaveBeenCalledOnce();
  });

  it("skips disabled repair behaviors", async () => {
    const issue: DetectedIssue = {
      type: "gateway_down",
      message: "Container crashed",
      detectedAt: "2026-03-13T00:00:00Z",
    };
    vi.mocked(detectIssues).mockResolvedValue([issue]);
    vi.mocked(logRepairAction).mockResolvedValue(undefined);

    const config: RepairConfig = {
      ...DEFAULT_REPAIR_CONFIG,
      gatewayRestart: false,
    };

    const report = await runRepair(makeCtx(), config);

    expect(report.actions).toHaveLength(1);
    expect(report.actions[0].status).toBe("skipped");
    expect(repairIssue).not.toHaveBeenCalled();
  });

  it("reports not healthy when repair fails", async () => {
    const issue: DetectedIssue = {
      type: "firewall_missing",
      message: "Chain missing",
      detectedAt: "2026-03-13T00:00:00Z",
    };
    vi.mocked(detectIssues).mockResolvedValue([issue]);

    const actionResult: RepairActionResult = {
      issue: "firewall_missing",
      status: "failed",
      action: "Firewall reapply",
      message: "iptables not available",
      durationMs: 100,
    };
    vi.mocked(repairIssue).mockResolvedValue(actionResult);
    vi.mocked(logRepairAction).mockResolvedValue(undefined);

    const report = await runRepair(makeCtx());

    expect(report.allHealthy).toBe(false);
    expect(report.actions[0].status).toBe("failed");
  });

  it("logs all repair actions including skipped", async () => {
    const issues: DetectedIssue[] = [
      { type: "gateway_down", message: "Down", detectedAt: "2026-03-13T00:00:00Z" },
      { type: "firewall_missing", message: "Missing", detectedAt: "2026-03-13T00:00:00Z" },
    ];
    vi.mocked(detectIssues).mockResolvedValue(issues);
    vi.mocked(logRepairAction).mockResolvedValue(undefined);

    const config: RepairConfig = {
      ...DEFAULT_REPAIR_CONFIG,
      gatewayRestart: false,
    };

    vi.mocked(repairIssue).mockResolvedValue({
      issue: "firewall_missing",
      status: "repaired",
      action: "Firewall reapply",
      message: "Applied",
      durationMs: 200,
    });

    await runRepair(makeCtx(), config);

    // Both issues should be logged (one skipped, one repaired)
    expect(logRepairAction).toHaveBeenCalledTimes(2);
  });
});

describe("formatRepairReport", () => {
  it("shows healthy message when no issues", () => {
    const report: RepairReport = { issues: [], actions: [], allHealthy: true };
    const output = formatRepairReport(report);
    expect(output).toContain("healthy");
  });

  it("formats repair actions into table", () => {
    const report: RepairReport = {
      issues: [
        { type: "gateway_down", message: "Down", detectedAt: "2026-03-13T00:00:00Z" },
      ],
      actions: [
        { issue: "gateway_down", status: "repaired", action: "Container restart", message: "Restarted", durationMs: 1500 },
      ],
      allHealthy: true,
    };
    const output = formatRepairReport(report);
    expect(output).toContain("Container restart");
    expect(output).toContain("REPAIRED");
    expect(output).toContain("1 repaired");
  });
});
