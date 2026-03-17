/**
 * Cron job writer for Google Assistant routine import.
 *
 * Reads existing cron/jobs.json (if any), merges approved new jobs,
 * and writes the result atomically.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { CronJobDefinition } from "../../../config/schema.js";

/**
 * Read existing cron jobs from jobs.json.
 * Returns an empty array if the file doesn't exist.
 */
export async function readExistingJobs(
  openclawHome: string,
): Promise<CronJobDefinition[]> {
  const jobsPath = join(openclawHome, "cron", "jobs.json");

  try {
    const raw = await readFile(jobsPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as CronJobDefinition[];
    return [];
  } catch {
    return [];
  }
}

/**
 * Write cron jobs to jobs.json, merging with existing jobs.
 * Jobs with duplicate IDs are replaced by the new versions.
 *
 * Uses atomic write (write to temp file, then rename).
 */
export async function writeCronJobs(
  openclawHome: string,
  newJobs: CronJobDefinition[],
): Promise<{ total: number; added: number; replaced: number }> {
  const cronDir = join(openclawHome, "cron");
  const jobsPath = join(cronDir, "jobs.json");

  await mkdir(cronDir, { recursive: true });

  const existing = await readExistingJobs(openclawHome);
  const existingIds = new Set(existing.map((j) => j.id));

  let added = 0;
  let replaced = 0;

  // Build merged list: existing jobs (minus duplicates) + new jobs
  const merged: CronJobDefinition[] = [];
  const newIds = new Set(newJobs.map((j) => j.id));

  for (const job of existing) {
    if (newIds.has(job.id)) {
      replaced++;
    } else {
      merged.push(job);
    }
  }

  for (const job of newJobs) {
    if (!existingIds.has(job.id)) {
      added++;
    }
    merged.push(job);
  }

  // Atomic write
  const tmpPath = `${jobsPath}.tmp.${Date.now()}`;
  await mkdir(dirname(tmpPath), { recursive: true });
  await writeFile(tmpPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  await rename(tmpPath, jobsPath);

  return { total: merged.length, added, replaced };
}
