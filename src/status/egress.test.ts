import { mkdir, rm, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectEgressSummary } from "./egress.js";

const TEST_DIR = "/tmp/clawhq-egress-test";
const LOG_PATH = `${TEST_DIR}/egress.log`;

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("collectEgressSummary", () => {
  it("returns zero egress when log file is missing", async () => {
    const summary = await collectEgressSummary({
      egressLogPath: "/tmp/nonexistent-egress/egress.log",
    });

    expect(summary.zeroEgress).toBe(true);
    expect(summary.today.bytes).toBe(0);
    expect(summary.today.calls).toBe(0);
    expect(summary.week.bytes).toBe(0);
    expect(summary.month.bytes).toBe(0);
  });

  it("returns zero egress for empty log file", async () => {
    await writeFile(LOG_PATH, "");

    const summary = await collectEgressSummary({ egressLogPath: LOG_PATH });

    expect(summary.zeroEgress).toBe(true);
  });

  it("sums egress from recent log entries", async () => {
    const now = new Date();
    const entries = [
      { timestamp: now.toISOString(), provider: "anthropic", bytesOut: 1024 },
      { timestamp: now.toISOString(), provider: "openai", bytesOut: 2048 },
    ];

    await writeFile(LOG_PATH, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const summary = await collectEgressSummary({ egressLogPath: LOG_PATH });

    expect(summary.zeroEgress).toBe(false);
    expect(summary.today.bytes).toBe(3072);
    expect(summary.today.calls).toBe(2);
    expect(summary.month.bytes).toBe(3072);
    expect(summary.month.calls).toBe(2);
  });

  it("excludes old entries from today count", async () => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);

    const entries = [
      { timestamp: yesterday.toISOString(), provider: "anthropic", bytesOut: 500 },
      { timestamp: now.toISOString(), provider: "openai", bytesOut: 200 },
    ];

    await writeFile(LOG_PATH, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const summary = await collectEgressSummary({ egressLogPath: LOG_PATH });

    expect(summary.today.bytes).toBe(200);
    expect(summary.today.calls).toBe(1);
    // Both should be in week and month
    expect(summary.week.bytes).toBe(700);
    expect(summary.month.bytes).toBe(700);
  });

  it("skips malformed log lines", async () => {
    const now = new Date();
    const lines = [
      "not json",
      JSON.stringify({ timestamp: now.toISOString(), provider: "anthropic", bytesOut: 100 }),
      "{broken",
    ];

    await writeFile(LOG_PATH, lines.join("\n") + "\n");

    const summary = await collectEgressSummary({ egressLogPath: LOG_PATH });

    expect(summary.today.bytes).toBe(100);
    expect(summary.today.calls).toBe(1);
  });

  it("has correct period labels", async () => {
    const summary = await collectEgressSummary({ egressLogPath: LOG_PATH });

    expect(summary.today.label).toBe("today");
    expect(summary.week.label).toBe("this week");
    expect(summary.month.label).toBe("this month");
  });
});
