import { describe, expect, it } from "vitest";

import type { StatusReport } from "../status/types.js";

import { collectMetrics } from "./collector.js";

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
        { provider: "OpenAI", status: "expired", message: "Key expired" },
      ],
      counts: { valid: 1, expired: 1, failing: 0, error: 0, missing: 0 },
    },
    workspace: {
      memoryTiers: [
        { tier: "hot", path: "/tmp/memory/hot", sizeBytes: 45056, fileCount: 3 },
        { tier: "warm", path: "/tmp/memory/warm", sizeBytes: 122880, fileCount: 12 },
        { tier: "cold", path: "/tmp/memory/cold", sizeBytes: 0, fileCount: 0 },
      ],
      identityFiles: [
        { name: "IDENTITY.md", path: "/tmp/IDENTITY.md", sizeBytes: 4096, estimatedTokens: 1024 },
      ],
      totalMemoryBytes: 167936,
      totalIdentityTokens: 1024,
    },
    structuredMemory: {
      tiers: [
        { name: "hot", entryCount: 5, sizeBytes: 2048, oldestEntryAge: 3, newestEntryAge: 0 },
        { name: "warm", entryCount: 10, sizeBytes: 4096, oldestEntryAge: 30, newestEntryAge: 8 },
        { name: "cold", entryCount: 2, sizeBytes: 1024, oldestEntryAge: 90, newestEntryAge: 60 },
      ],
      totalEntries: 17,
      totalSizeBytes: 7168,
      hotTierOverBudget: false,
      staleEntriesCount: 3,
      pendingTransitions: 1,
      pendingConnections: 0,
    },
    channels: [],
    openclawSource: {
      pinnedVersion: "v0.14.2",
      cached: true,
      integrityOk: true,
      sourcePath: "/home/user/.clawhq/cache/openclaw-source/v0.14.2",
    },
    egress: {
      today: { label: "today", bytes: 512, calls: 3 },
      week: { label: "this week", bytes: 4096, calls: 20 },
      month: { label: "this month", bytes: 8192, calls: 50 },
      zeroEgress: false,
    },
    ...overrides,
  };
}

describe("collectMetrics", () => {
  it("extracts memory tier sizes", () => {
    const snapshot = collectMetrics(makeReport());

    expect(snapshot.metrics.memory_hot_bytes).toBe(45056);
    expect(snapshot.metrics.memory_warm_bytes).toBe(122880);
    expect(snapshot.metrics.memory_cold_bytes).toBe(0);
    expect(snapshot.metrics.memory_total_bytes).toBe(167936);
  });

  it("extracts identity token count", () => {
    const snapshot = collectMetrics(makeReport());
    expect(snapshot.metrics.identity_tokens).toBe(1024);
  });

  it("extracts egress bytes", () => {
    const snapshot = collectMetrics(makeReport());
    expect(snapshot.metrics.egress_bytes).toBe(512);
  });

  it("counts failing integrations as error rate", () => {
    const snapshot = collectMetrics(makeReport());
    // 1 expired
    expect(snapshot.metrics.error_rate).toBe(1);
  });

  it("sets credential_expiry_days to 0 for expired credentials", () => {
    const snapshot = collectMetrics(makeReport());
    expect(snapshot.metrics.credential_expiry_days).toBe(0);
  });

  it("omits credential_expiry_days when no credentials expired", () => {
    const report = makeReport({
      integrations: {
        integrations: [
          { provider: "Anthropic", status: "valid", message: "OK" },
        ],
        counts: { valid: 1, expired: 0, failing: 0, error: 0, missing: 0 },
      },
    });
    const snapshot = collectMetrics(report);
    expect(snapshot.metrics.credential_expiry_days).toBeUndefined();
  });

  it("extracts structured memory metrics", () => {
    const snapshot = collectMetrics(makeReport());
    expect(snapshot.metrics.memory_total_entries).toBe(17);
    expect(snapshot.metrics.stale_entries).toBe(3);
    expect(snapshot.metrics.structured_hot_entries).toBe(5);
  });

  it("preserves timestamp from report", () => {
    const snapshot = collectMetrics(makeReport());
    expect(snapshot.timestamp).toBe("2026-03-13T11:00:00Z");
  });

  it("handles missing structured memory", () => {
    const report = makeReport({ structuredMemory: null });
    const snapshot = collectMetrics(report);
    expect(snapshot.metrics.memory_total_entries).toBeUndefined();
  });
});
