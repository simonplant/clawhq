/**
 * cron/jobs.json — the single source of truth for read/write.
 *
 * OpenClaw's scheduler reads jobs.json as a `{"version":1,"jobs":[...]}`
 * envelope. Every other shape (bare array, missing `jobs` field, null, etc.)
 * is silently treated as "zero jobs configured" upstream — the class of bug
 * that took Clawdius's cron out for days without a single log line.
 *
 * This module is the one place clawhq touches cron/jobs.json on disk.
 * Every prior serializer (compiler renderCronJobs, apply mergeCronJobs,
 * migrate mergeCronJobs, fixCronHealth, web/demo inline JSON.stringify)
 * migrates onto loadCronStore/saveCronStore/renderCronJobsFile here.
 *
 * Guarantees:
 *   - Load throws `InvalidCronStoreError` on schema drift (never silently
 *     empty).
 *   - Save is atomic (tmp+rename via writeFileAtomic).
 *   - Render always emits the canonical envelope + default `state: {}`
 *     on every job.
 *
 * Not in scope for this module:
 *   - Per-job business validation (cron expression syntax, model routing,
 *     sessionTarget semantics) — those stay in compiler / validate.ts /
 *     doctor checks. This module is structural validity only.
 *   - Concurrency with OpenClaw's runtime writer. That's covered by
 *     src/config/lock.ts for clawhq↔clawhq and an upstream PR for
 *     OpenClaw↔clawhq.
 */

import { existsSync, readFileSync } from "node:fs";

import type { CronJobDefinition } from "../config/types.js";
import { FILE_MODE_SECRET } from "../config/defaults.js";
import { writeFileAtomic } from "../design/configure/writer.js";

// ── Types ───────────────────────────────────────────────────────────────────

/** The on-disk envelope shape. Jobs are opaque Record<string, unknown>
 *  because clawhq doesn't own the per-job schema — that's OpenClaw's. We
 *  validate the envelope and trust the per-job bits. */
export interface CronStoreFile {
  readonly version: 1;
  readonly jobs: readonly Record<string, unknown>[];
}

export class InvalidCronStoreError extends Error {
  constructor(storePath: string, detail: string) {
    super(
      `cron/jobs.json at ${storePath} is not a valid {"version":1,"jobs":[...]} envelope: ${detail}. ` +
        "OpenClaw's loader would treat this as zero jobs configured. " +
        "Run `clawhq apply` to regenerate from the blueprint.",
    );
    this.name = "InvalidCronStoreError";
  }
}

// ── Load ────────────────────────────────────────────────────────────────────

/**
 * Read and validate cron/jobs.json.
 *
 * @returns the envelope if the file exists and is well-formed; an empty
 *   envelope `{version:1, jobs:[]}` if the file is missing (first-deploy
 *   semantics — matches OpenClaw's loader behaviour on ENOENT).
 * @throws {InvalidCronStoreError} on any other shape drift — bare array,
 *   missing `jobs`, non-object root, invalid JSON. Never silently empty.
 */
export function loadCronStore(storePath: string): CronStoreFile {
  if (!existsSync(storePath)) {
    return { version: 1, jobs: [] };
  }

  const raw = readFileSync(storePath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new InvalidCronStoreError(storePath, `invalid JSON — ${msg}`);
  }

  if (parsed === null || typeof parsed !== "object") {
    throw new InvalidCronStoreError(storePath, `root is ${parsed === null ? "null" : typeof parsed}, expected object`);
  }
  if (Array.isArray(parsed)) {
    throw new InvalidCronStoreError(storePath, "root is a bare JSON array (expected envelope object)");
  }
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.jobs)) {
    throw new InvalidCronStoreError(storePath, "missing or non-array `jobs` field");
  }

  // Accept any version field — upstream may introduce version 2 — but
  // normalize to version 1 for serialization. Callers that need strict
  // version checks can inspect the returned envelope.
  return {
    version: 1,
    jobs: record.jobs as Record<string, unknown>[],
  };
}

// ── Save ────────────────────────────────────────────────────────────────────

/**
 * Write cron/jobs.json atomically in canonical form.
 *
 * Preserves jobs as given. Callers responsible for merging runtime state
 * before calling — see `src/evolve/apply/index.ts:mergeCronJobs`.
 */
export function saveCronStore(storePath: string, store: CronStoreFile): void {
  const content = JSON.stringify({ version: 1, jobs: store.jobs }, null, 2) + "\n";
  writeFileAtomic(storePath, content, FILE_MODE_SECRET);
}

// ── Render (compiler output path) ───────────────────────────────────────────

/**
 * Render cron/jobs.json content from ClawHQ's CronJobDefinition shape.
 *
 * Transforms:
 *   - strips ClawHQ-only extension fields (`fallbacks`, `activeHours`) that
 *     don't belong in OpenClaw's native schema;
 *   - defaults `state: {}` on every job (OpenClaw's scheduler crashes at
 *     boot with "Cannot read properties of undefined" when state is
 *     missing — fresh jobs from the compiler have no state).
 *
 * This is the sole emission path for compiled jobs.json content. Web,
 * demo, CLI helpers, and compiler.ts all route through here (directly
 * or via re-export from `src/design/configure/generate.ts`).
 */
export function renderCronJobsFile(cronJobs: readonly CronJobDefinition[]): string {
  const normalized = cronJobs.map(({ fallbacks: _f, activeHours: _a, ...rest }) => ({
    ...rest,
    state: rest.state ?? {},
  }));
  return JSON.stringify({ version: 1, jobs: normalized }, null, 2) + "\n";
}
