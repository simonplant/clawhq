import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  filterByCategory,
  formatCronHistory,
  listCronJobIds,
  parseSinceDuration,
  readCronHistory,
} from "./stream.js";
import type { CronRunEntry } from "./types.js";

describe("parseSinceDuration", () => {
  it("parses seconds", () => {
    expect(parseSinceDuration("30s")).toBe("30s");
  });

  it("parses minutes", () => {
    expect(parseSinceDuration("5m")).toBe("5m");
  });

  it("parses hours", () => {
    expect(parseSinceDuration("1h")).toBe("1h");
  });

  it("parses days as hours", () => {
    expect(parseSinceDuration("2d")).toBe("48h");
  });

  it("throws on invalid format", () => {
    expect(() => parseSinceDuration("abc")).toThrow("Invalid --since value");
    expect(() => parseSinceDuration("10x")).toThrow("Invalid --since value");
    expect(() => parseSinceDuration("")).toThrow("Invalid --since value");
  });
});

describe("filterByCategory", () => {
  const sampleLogs = [
    "2026-03-13T10:00:00Z  agent session started for user",
    "2026-03-13T10:00:01Z  gateway health check passed",
    "2026-03-13T10:00:02Z  cron job heartbeat triggered",
    "2026-03-13T10:00:03Z  error connecting to provider",
    "2026-03-13T10:00:04Z  tool execution completed",
    "2026-03-13T10:00:05Z  websocket connection established",
    "2026-03-13T10:00:06Z  scheduled task ran successfully",
  ].join("\n");

  it("filters agent logs", () => {
    const result = filterByCategory(sampleLogs, "agent");
    expect(result).toContain("agent session started");
    expect(result).toContain("tool execution completed");
    expect(result).not.toContain("gateway health");
  });

  it("filters gateway logs", () => {
    const result = filterByCategory(sampleLogs, "gateway");
    expect(result).toContain("gateway health check");
    expect(result).toContain("websocket connection");
    expect(result).not.toContain("agent session");
  });

  it("filters cron logs", () => {
    const result = filterByCategory(sampleLogs, "cron");
    expect(result).toContain("cron job heartbeat");
    expect(result).toContain("scheduled task");
  });

  it("filters error logs", () => {
    const result = filterByCategory(sampleLogs, "error");
    expect(result).toContain("error connecting");
    expect(result).not.toContain("agent session");
  });
});

describe("readCronHistory", () => {
  let tempDir: string;

  afterEach(async () => {
    // Cleanup handled by OS tmpdir
  });

  async function setupCronDir(
    jobId: string,
    entries: Record<string, unknown>[],
    jobs?: Array<{ id: string }>,
  ): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "clawhq-logs-test-"));
    const cronDir = join(tempDir, "cron");
    const runsDir = join(cronDir, "runs");
    await mkdir(runsDir, { recursive: true });

    if (jobs) {
      await writeFile(join(cronDir, "jobs.json"), JSON.stringify(jobs));
    }

    if (entries.length > 0) {
      const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
      await writeFile(join(runsDir, `${jobId}.jsonl`), content);
    }

    return tempDir;
  }

  it("reads cron execution history", async () => {
    const home = await setupCronDir("heartbeat", [
      { timestamp: "2026-03-13T10:00:00Z", success: true, durationMs: 150 },
      {
        timestamp: "2026-03-13T11:00:00Z",
        success: false,
        error: "timeout",
        durationMs: 30000,
      },
    ]);

    const entries = await readCronHistory(home, "heartbeat");
    expect(entries).toHaveLength(2);
    expect(entries[0].success).toBe(true);
    expect(entries[0].durationMs).toBe(150);
    expect(entries[1].success).toBe(false);
    expect(entries[1].error).toBe("timeout");
  });

  it("returns empty array when job exists but has no runs", async () => {
    const home = await setupCronDir("heartbeat", [], [{ id: "heartbeat" }]);

    const entries = await readCronHistory(home, "heartbeat");
    expect(entries).toHaveLength(0);
  });

  it("throws when job does not exist", async () => {
    const home = await setupCronDir("other", [], [{ id: "other" }]);

    await expect(readCronHistory(home, "nonexistent")).rejects.toThrow(
      'Cron job "nonexistent" not found',
    );
  });

  it("throws when no cron config exists", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "clawhq-logs-test-"));

    await expect(readCronHistory(tempDir, "anything")).rejects.toThrow(
      "No cron configuration found",
    );
  });
});

describe("listCronJobIds", () => {
  it("lists job IDs from runs directory", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "clawhq-logs-test-"));
    const runsDir = join(tempDir, "cron", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(join(runsDir, "heartbeat.jsonl"), "");
    await writeFile(join(runsDir, "morning-brief.jsonl"), "");

    const ids = await listCronJobIds(tempDir);
    expect(ids).toContain("heartbeat");
    expect(ids).toContain("morning-brief");
  });

  it("returns empty array when runs directory does not exist", async () => {
    const ids = await listCronJobIds("/tmp/nonexistent-cron-test");
    expect(ids).toHaveLength(0);
  });
});

describe("formatCronHistory", () => {
  it("formats entries with status and duration", () => {
    const entries: CronRunEntry[] = [
      {
        timestamp: "2026-03-13T10:00:00Z",
        jobId: "heartbeat",
        success: true,
        durationMs: 150,
      },
      {
        timestamp: "2026-03-13T11:00:00Z",
        jobId: "heartbeat",
        success: false,
        durationMs: 30000,
        error: "connection timeout",
      },
    ];

    const output = formatCronHistory(entries);
    expect(output).toContain("heartbeat");
    expect(output).toContain("2 executions");
    expect(output).toContain("OK");
    expect(output).toContain("FAIL");
    expect(output).toContain("150ms");
    expect(output).toContain("connection timeout");
  });

  it("returns message when no history", () => {
    expect(formatCronHistory([])).toContain("No execution history");
  });
});
