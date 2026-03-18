import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CronJobDefinition } from "../../../config/schema.js";

import { readExistingJobs, writeCronJobs } from "./writer.js";

describe("readExistingJobs", () => {
  let testHome: string;

  beforeEach(async () => {
    testHome = join(tmpdir(), `clawhq-writer-test-${Date.now()}`);
    await mkdir(testHome, { recursive: true });
  });

  afterEach(async () => {
    await rm(testHome, { recursive: true, force: true }).catch(() => {});
  });

  it("returns empty array when no jobs.json exists", async () => {
    const jobs = await readExistingJobs(testHome);
    expect(jobs).toEqual([]);
  });

  it("reads existing jobs from jobs.json", async () => {
    const cronDir = join(testHome, "cron");
    await mkdir(cronDir, { recursive: true });

    const existing: CronJobDefinition[] = [
      {
        id: "existing-1",
        kind: "cron",
        expr: "0 9 * * *",
        task: "Existing job",
        enabled: true,
      },
    ];

    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(cronDir, "jobs.json"), JSON.stringify(existing));

    const jobs = await readExistingJobs(testHome);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("existing-1");
  });
});

describe("writeCronJobs", () => {
  let testHome: string;

  beforeEach(async () => {
    testHome = join(tmpdir(), `clawhq-writer-test-${Date.now()}`);
    await mkdir(testHome, { recursive: true });
  });

  afterEach(async () => {
    await rm(testHome, { recursive: true, force: true }).catch(() => {});
  });

  it("creates cron directory and writes jobs", async () => {
    const newJobs: CronJobDefinition[] = [
      {
        id: "ga-morning",
        kind: "cron",
        expr: "0 7 * * 1,2,3,4,5",
        task: "Check weather",
        enabled: true,
      },
    ];

    const result = await writeCronJobs(testHome, newJobs);
    expect(result.added).toBe(1);
    expect(result.replaced).toBe(0);
    expect(result.total).toBe(1);

    // Verify file was written
    const raw = await readFile(join(testHome, "cron", "jobs.json"), "utf-8");
    const written = JSON.parse(raw) as CronJobDefinition[];
    expect(written).toHaveLength(1);
    expect(written[0].id).toBe("ga-morning");
  });

  it("merges with existing jobs", async () => {
    const cronDir = join(testHome, "cron");
    await mkdir(cronDir, { recursive: true });

    const existing: CronJobDefinition[] = [
      {
        id: "existing-heartbeat",
        kind: "every",
        everyMs: 3600000,
        task: "Heartbeat",
        enabled: true,
      },
    ];

    const { writeFile: wf } = await import("node:fs/promises");
    await wf(join(cronDir, "jobs.json"), JSON.stringify(existing));

    const newJobs: CronJobDefinition[] = [
      {
        id: "ga-morning",
        kind: "cron",
        expr: "0 7 * * *",
        task: "Morning brief",
        enabled: true,
      },
    ];

    const result = await writeCronJobs(testHome, newJobs);
    expect(result.added).toBe(1);
    expect(result.total).toBe(2);

    const raw = await readFile(join(cronDir, "jobs.json"), "utf-8");
    const written = JSON.parse(raw) as CronJobDefinition[];
    expect(written).toHaveLength(2);
    expect(written[0].id).toBe("existing-heartbeat");
    expect(written[1].id).toBe("ga-morning");
  });

  it("replaces jobs with matching IDs", async () => {
    const cronDir = join(testHome, "cron");
    await mkdir(cronDir, { recursive: true });

    const existing: CronJobDefinition[] = [
      {
        id: "ga-morning",
        kind: "cron",
        expr: "0 8 * * *",
        task: "Old task",
        enabled: true,
      },
    ];

    const { writeFile: wf } = await import("node:fs/promises");
    await wf(join(cronDir, "jobs.json"), JSON.stringify(existing));

    const newJobs: CronJobDefinition[] = [
      {
        id: "ga-morning",
        kind: "cron",
        expr: "0 7 * * *",
        task: "Updated task",
        enabled: true,
      },
    ];

    const result = await writeCronJobs(testHome, newJobs);
    expect(result.added).toBe(0);
    expect(result.replaced).toBe(1);
    expect(result.total).toBe(1);

    const raw = await readFile(join(cronDir, "jobs.json"), "utf-8");
    const written = JSON.parse(raw) as CronJobDefinition[];
    expect(written).toHaveLength(1);
    expect(written[0].task).toBe("Updated task");
  });
});
