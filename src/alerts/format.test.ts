import { describe, expect, it } from "vitest";

import { formatAlertJson, formatAlertSummary, formatAlertTable } from "./format.js";
import type { AlertReport, PredictiveAlert } from "./types.js";

function makeAlert(overrides: Partial<PredictiveAlert> = {}): PredictiveAlert {
  return {
    id: "alert-1",
    severity: "warning",
    category: "memory",
    title: "Hot memory tier growing",
    message: "Hot memory will reach capacity in ~5 days.",
    projectedTimeline: "~5 days",
    remediation: ["Run tier transitions", "Review hot tier entries"],
    trend: {
      metric: "memory_hot_bytes",
      direction: "rising",
      slopePerDay: 5000,
      rSquared: 0.95,
      currentValue: 60000,
      dataPoints: 5,
    },
    generatedAt: "2026-03-13T11:00:00Z",
    ...overrides,
  };
}

function makeReport(overrides: Partial<AlertReport> = {}): AlertReport {
  return {
    timestamp: "2026-03-13T11:00:00Z",
    alerts: [
      makeAlert(),
      makeAlert({
        id: "alert-2",
        severity: "critical",
        category: "credentials",
        title: "Credentials expired",
        message: "One or more credentials have expired.",
        projectedTimeline: "now",
        remediation: ["Rotate API keys"],
        trend: null,
      }),
    ],
    counts: { critical: 1, warning: 1, info: 0 },
    metricSummary: { tracked: 4, trending: 2, stable: 2 },
    ...overrides,
  };
}

describe("formatAlertTable", () => {
  it("renders all alerts with details", () => {
    const output = formatAlertTable(makeReport());

    expect(output).toContain("PREDICTIVE HEALTH ALERTS");
    expect(output).toContain("Hot memory tier growing");
    expect(output).toContain("Credentials expired");
    expect(output).toContain("~5 days");
    expect(output).toContain("Run tier transitions");
  });

  it("shows summary counts", () => {
    const output = formatAlertTable(makeReport());

    expect(output).toContain("1 critical");
    expect(output).toContain("1 warning");
    expect(output).toContain("4 metrics tracked");
  });

  it("shows no-alerts message when empty", () => {
    const output = formatAlertTable(makeReport({
      alerts: [],
      counts: { critical: 0, warning: 0, info: 0 },
      metricSummary: { tracked: 3, trending: 0, stable: 3 },
    }));

    expect(output).toContain("No alerts");
    expect(output).toContain("stable");
  });

  it("shows severity labels", () => {
    const output = formatAlertTable(makeReport());

    expect(output).toContain("[WARN]");
    expect(output).toContain("[CRIT]");
  });
});

describe("formatAlertSummary", () => {
  it("renders compact summary", () => {
    const output = formatAlertSummary(makeReport());

    expect(output).toContain("ALERTS");
    expect(output).toContain("CRIT");
    expect(output).toContain("WARN");
  });

  it("shows no active alerts when empty", () => {
    const output = formatAlertSummary(makeReport({
      alerts: [],
    }));

    expect(output).toContain("No active alerts");
  });

  it("limits to 3 alerts and shows overflow message", () => {
    const alerts = Array.from({ length: 5 }, (_, i) =>
      makeAlert({ id: `alert-${i}`, title: `Alert ${i}` }),
    );
    const output = formatAlertSummary(makeReport({
      alerts,
    }));

    expect(output).toContain("2 more");
    expect(output).toContain("clawhq alerts");
  });
});

describe("formatAlertJson", () => {
  it("outputs valid JSON", () => {
    const output = formatAlertJson(makeReport());
    const parsed = JSON.parse(output) as AlertReport;

    expect(parsed.timestamp).toBe("2026-03-13T11:00:00Z");
    expect(parsed.alerts).toHaveLength(2);
    expect(parsed.counts.critical).toBe(1);
  });
});
