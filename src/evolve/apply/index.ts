/**
 * `clawhq apply` — idempotent config regeneration from deployed clawhq.yaml.
 *
 * Reads the composition config (profile + personality + providers), calls the
 * catalog compiler, and writes all derivable files. Preserves stateful data
 * (memory, custom tools, credentials). Safe to run repeatedly.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as yamlParse } from "yaml";

import { GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";
import { DeployLockBusyError, withDeployLock } from "../../config/lock.js";
import { compile } from "../../design/catalog/index.js";
import { loadCronStore } from "../../openclaw/cron-store.js";
import { loadRuntimeConfig } from "../../openclaw/runtime-config.js";

import { withTransaction } from "./transaction.js";
import type { CompiledFile } from "../../design/catalog/types.js";
import type { UserConfig } from "../../design/catalog/types.js";
import { writeBundle } from "../../design/configure/writer.js";

import type { ApplyOptions, ApplyProgress, ApplyReport, ApplyResult } from "./types.js";

export type { ApplyOptions, ApplyProgress, ApplyReport, ApplyResult } from "./types.js";

// ── Stateful Paths (never overwritten) ──────────────────────────────────────

/** Files the compiler generates but apply must not overwrite. */
const SKIP_PATHS = new Set([
  "workspace/MEMORY.md",                        // user's curated memory
  "clawhq.yaml",                                // we're reading from it — don't overwrite
  "workspace/config/substack-aliases.json",      // user's publication aliases
  "engine/docker-compose.yml",                  // owned by clawhq build — apply must not overwrite
]);

/**
 * Files the compiler seeds with an empty template but never overwrites after.
 * credentials.json is populated by `clawhq integrate add` — every subsequent
 * apply would have wiped real integration secrets back to `{}` if this set
 * didn't exist.
 */
const SEED_ONCE_PATHS = new Set([
  "engine/credentials.json",
  "credentials.json",
]);

/** Files where apply merges compiled output with existing runtime state. */
const MERGE_PATHS = new Set([
  "cron/jobs.json",                              // compiler owns job definitions, preserve runtime state
]);

/** .env placeholder value — the writer preserves real values over this. */
const ENV_PLACEHOLDER = "CHANGE_ME";

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Apply config from deployed clawhq.yaml.
 *
 * Reads composition, compiles workspace, writes derivable files.
 * Credentials in .env are preserved. Stateful files are not touched.
 */
export async function apply(options: ApplyOptions): Promise<ApplyResult> {
  const { deployDir, dryRun } = options;
  const report = progress(options.onProgress);

  // Precheck clawhq.yaml presence *before* trying to lock, so the error
  // for a missing deployment is "clawhq.yaml not found" rather than a
  // confusing ENOENT from the lock primitive.
  const configPath = join(deployDir, "clawhq.yaml");
  if (!existsSync(configPath)) {
    report("read", "failed", "clawhq.yaml not found");
    return { success: false, error: `clawhq.yaml not found at ${configPath}`, report: emptyReport() };
  }

  // Dry-run skips the lock entirely — it's a read-only operation and
  // taking the lock would serialize dry-runs unnecessarily against live
  // applies. For actual writes, hold the lock across compile→diff→write
  // so two concurrent clawhq processes cannot interleave.
  const runCore = async (): Promise<ApplyResult> => applyCore(options, report);
  if (dryRun) {
    return runCore();
  }
  try {
    return await withDeployLock(deployDir, runCore);
  } catch (err) {
    if (err instanceof DeployLockBusyError) {
      report("read", "failed", err.message);
      return { success: false, error: err.message, report: emptyReport() };
    }
    throw err;
  }
}

async function applyCore(
  options: ApplyOptions,
  report: ReturnType<typeof progress>,
): Promise<ApplyResult> {
  const { deployDir, dryRun } = options;

  try {
    // 1. Read clawhq.yaml (presence already verified by apply())
    report("read", "running", "Reading clawhq.yaml…");
    const configPath = join(deployDir, "clawhq.yaml");

    const raw = yamlParse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    const comp = raw.composition as
      | {
          profile?: string;
          personality?: string;
          providers?: Record<string, string>;
          model?: string;
          modelContextWindow?: number;
          modelFallbacks?: string[];
        }
      | undefined;

    if (!comp?.profile) {
      report("read", "failed", "No composition.profile in clawhq.yaml");
      return { success: false, error: "clawhq.yaml has no composition.profile", report: emptyReport() };
    }

    report("read", "done", `Profile: ${comp.profile}, Personality: ${comp.personality ?? "default"}`);

    // 2. Extract user context from existing USER.md
    const user = readUserContext(deployDir);

    // 3. Read existing env (needed for proxy/Tailscale detection and credential preservation)
    const existingEnv = readExistingEnv(deployDir);

    // 4. Compile — pass existing env so compiler detects integrations from `integrate add`
    report("compile", "running", "Compiling workspace…");
    const gatewayPort = options.gatewayPort ?? GATEWAY_DEFAULT_PORT;
    const compiled = compile(
      {
        profile: comp.profile,
        personality: comp.personality ?? "digital-assistant",
        providers: comp.providers,
        model: comp.model,
        modelContextWindow: comp.modelContextWindow,
        modelFallbacks: comp.modelFallbacks,
      },
      user,
      deployDir,
      gatewayPort,
      existingEnv,
    );
    report("compile", "done", `${compiled.files.length} files compiled`);

    // 5. Filter stateful files + merge where needed
    //    - SKIP_PATHS: always excluded (user-owned or separately managed)
    //    - SEED_ONCE_PATHS: emitted only if the file doesn't already exist
    let files: CompiledFile[] = compiled.files.filter((f) => {
      if (SKIP_PATHS.has(f.relativePath)) return false;
      if (SEED_ONCE_PATHS.has(f.relativePath) && existsSync(join(deployDir, f.relativePath))) {
        return false;
      }
      return true;
    });

    // Merge cron/jobs.json: compiled definitions + preserved runtime state
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f || !MERGE_PATHS.has(f.relativePath)) continue;
      if (f.relativePath === "cron/jobs.json") {
        files[i] = mergeCronJobs(deployDir, f);
      }
    }

    // 6. Report proxy/Tailscale status
    const proxyFiles = files.filter((f) => f.relativePath.includes("cred-proxy"));
    const hasComposeTailscale = files.some((f) =>
      f.relativePath === "engine/docker-compose.yml" && f.content.includes("tailscale"),
    );
    if (proxyFiles.length > 0) {
      report("proxy", "done", `Proxy configured (${proxyFiles.length} files)${hasComposeTailscale ? " + Tailscale" : ""}`);
    } else if (hasComposeTailscale) {
      report("proxy", "done", "Tailscale configured");
    } else {
      report("proxy", "done", "No proxy or Tailscale");
    }

    // 7. Protect existing credentials — replace generated real values with
    //    CHANGE_ME so the writer's merge preserves existing .env values
    files = files.map((f) =>
      f.relativePath.endsWith(".env") ? protectCredentials(f, existingEnv) : f,
    );

    // 7. Compute diff
    report("diff", "running", "Computing changes…");
    const diffReport = computeDiff(deployDir, files);
    report("diff", "done",
      `${diffReport.added.length} added, ${diffReport.changed.length} changed, ${diffReport.unchanged.length} unchanged`,
    );

    // 8. Write (unless dry-run) — tree-scoped transaction wraps the write
    //    so any mid-write failure OR post-write validation failure rolls
    //    every touched file back to pre-apply state. All-or-nothing.
    if (!dryRun) {
      report("write", "running", "Writing files…");
      const touchedPaths = [...diffReport.added, ...diffReport.changed];
      try {
        await withTransaction(deployDir, touchedPaths, async () => {
          writeBundle(deployDir, files.map((f) => ({
            relativePath: f.relativePath,
            content: f.content,
            mode: f.mode,
          })));
          // Post-write validation: the new OpenClaw surfaces must load
          // through their strict readers. A broken compile that escapes
          // earlier checks triggers rollback here rather than shipping
          // a deployment that won't boot.
          validatePostWrite(deployDir, touchedPaths);
        });
        report("write", "done", `${diffReport.added.length + diffReport.changed.length} file(s) written`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        report("write", "failed", `Apply aborted — rolled back: ${msg}`);
        return { success: false, error: `Apply aborted and rolled back: ${msg}`, report: emptyReport() };
      }
    }

    // Report skipped paths truthfully: always-skipped + seed-once paths that
    // actually existed and were therefore preserved.
    const seedOnceSkipped = [...SEED_ONCE_PATHS].filter((p) =>
      existsSync(join(deployDir, p)),
    );
    return {
      success: true,
      report: {
        ...diffReport,
        skipped: [...SKIP_PATHS, ...seedOnceSkipped],
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, report: emptyReport() };
  }
}

// ── Post-write validation ──────────────────────────────────────────────────

/**
 * After apply writes the new deployment state, re-read every OpenClaw file
 * surface we have a strict loader for and confirm it parses. Any throw
 * here is caught by the surrounding transaction and triggers full
 * rollback — the deployment never sees a shape the scheduler / gateway
 * would reject at boot.
 *
 * Only validates surfaces that were actually written this apply, so a
 * no-change run is free and a cron-only change doesn't reload openclaw.json.
 */
function validatePostWrite(deployDir: string, touchedPaths: readonly string[]): void {
  const touched = new Set(touchedPaths);
  if (touched.has("cron/jobs.json")) {
    loadCronStore(join(deployDir, "cron/jobs.json"));
  }
  if (touched.has("engine/openclaw.json")) {
    loadRuntimeConfig(join(deployDir, "engine/openclaw.json"));
  }
  if (touched.has("openclaw.json")) {
    loadRuntimeConfig(join(deployDir, "openclaw.json"));
  }
}

// ── Cron Merge ─────────────────────────────────────────────────────────────

/**
 * Merge compiled cron jobs with existing deployed state.
 *
 * Compiled jobs are the source of truth for definitions (expr, task, delivery,
 * model). Runtime state fields (state, updatedAtMs, runningAtMs) are preserved
 * from the existing deployed file so we don't lose run history.
 *
 * Load side goes through loadCronStore (src/openclaw/cron-store.ts) which
 * throws on schema drift. On that error we log and fall through to using the
 * compiled output as-is — the corrupt file will be overwritten on write.
 */
function mergeCronJobs(deployDir: string, compiled: CompiledFile): CompiledFile {
  const existingPath = join(deployDir, compiled.relativePath);
  if (!existsSync(existingPath)) return compiled;

  try {
    const existingStore = loadCronStore(existingPath);
    const compiledRaw = JSON.parse(compiled.content);

    const existingJobs = existingStore.jobs;
    const compiledEnvelope = compiledRaw as { version: number; jobs: Record<string, unknown>[] };

    // Build lookup of existing runtime state by job ID
    const stateById = new Map<string, { state?: Record<string, unknown>; updatedAtMs?: number }>();
    for (const job of existingJobs) {
      if (job.id) {
        stateById.set(job.id as string, {
          state: job.state as Record<string, unknown> | undefined,
          updatedAtMs: job.updatedAtMs as number | undefined,
        });
      }
    }

    // Merge: compiled definitions + preserved runtime state
    const mergedJobs = compiledEnvelope.jobs.map((job) => {
      const id = job.id as string;
      const existing = stateById.get(id);
      if (existing) {
        return {
          ...job,
          ...(existing.state ? { state: existing.state } : {}),
          ...(existing.updatedAtMs ? { updatedAtMs: existing.updatedAtMs } : {}),
        };
      }
      return job;
    });

    const merged = { version: compiledEnvelope.version, jobs: mergedJobs };
    return {
      ...compiled,
      content: JSON.stringify(merged, null, 2) + "\n",
    };
  } catch (err) {
    console.warn(`[apply] Could not merge existing cron jobs, using compiled version: ${err instanceof Error ? err.message : String(err)}`);
    return compiled;
  }
}

// ── User Context Extraction ─────────────────────────────────────────────────

/**
 * Parse user context from existing USER.md.
 *
 * The compiler's renderUser() produces a deterministic format:
 *   **Name:** <value>
 *   **Timezone:** <value>
 *   **Communication preference:** <value>
 */
export function parseUserMd(content: string): UserConfig {
  const name = content.match(/\*\*Name:\*\*\s*(.+)/)?.[1]?.trim() ?? "User";
  const timezone = content.match(/\*\*Timezone:\*\*\s*(.+)/)?.[1]?.trim()
    ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const commMatch = content.match(/\*\*Communication preference:\*\*\s*(.+)/)?.[1]?.trim();
  const communication: UserConfig["communication"] =
    commMatch === "detailed" || commMatch === "conversational" ? commMatch : "brief";
  const constraintsMatch = content.match(/## Constraints\n\n([\s\S]*?)(?:\n##|\s*$)/);
  const constraints = constraintsMatch?.[1]?.trim() || undefined;
  return { name, timezone, communication, constraints };
}

function readUserContext(deployDir: string): UserConfig {
  const userMdPath = join(deployDir, "workspace", "USER.md");
  if (existsSync(userMdPath)) {
    return parseUserMd(readFileSync(userMdPath, "utf-8"));
  }
  return {
    name: "User",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    communication: "brief",
  };
}

// ── .env Credential Protection ──────────────────────────────────────────────

/**
 * Read existing .env files from the deploy directory.
 *
 * Checks both root .env and engine/.env (the compiler writes both).
 */
function readExistingEnv(deployDir: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const relPath of [".env", "engine/.env"]) {
    const envPath = join(deployDir, relPath);
    if (!existsSync(envPath)) continue;
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq);
      const val = trimmed.slice(eq + 1);
      if (val && val !== ENV_PLACEHOLDER) {
        env[key] = val;
      }
    }
  }

  return env;
}

/**
 * Replace generated non-placeholder values with CHANGE_ME so the writer's
 * merge logic preserves existing real credentials.
 *
 * The compiler generates fresh random tokens (e.g. OPENCLAW_GATEWAY_TOKEN).
 * During apply, we want to keep the existing token, not replace it.
 */
function protectCredentials(
  file: CompiledFile,
  existingEnv: Record<string, string>,
): CompiledFile {
  const lines = file.content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
    const eq = rawLine.indexOf("=");
    if (eq < 1) continue;
    const key = rawLine.slice(0, eq).trim();
    const newVal = rawLine.slice(eq + 1);
    // If existing .env has a real value for this key, and the generated
    // value is also real (not a placeholder), replace with placeholder
    // so the merge preserves the existing value.
    if (existingEnv[key] && newVal !== ENV_PLACEHOLDER) {
      lines[i] = `${key}=${ENV_PLACEHOLDER}`;
    }
  }
  return { ...file, content: lines.join("\n") };
}

// ── Diff Computation ────────────────────────────────────────────────────────

function computeDiff(
  deployDir: string,
  files: readonly CompiledFile[],
): Omit<ApplyReport, "skipped"> {
  const added: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const file of files) {
    const absPath = join(deployDir, file.relativePath);
    if (!existsSync(absPath)) {
      added.push(file.relativePath);
      continue;
    }
    const existingHash = hashContent(readFileSync(absPath, "utf-8"));
    const newHash = hashContent(file.content);
    if (existingHash === newHash) {
      unchanged.push(file.relativePath);
    } else {
      changed.push(file.relativePath);
    }
  }

  return { added, changed, unchanged };
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function emptyReport(): ApplyReport {
  return { added: [], changed: [], unchanged: [], skipped: [] };
}

function progress(callback?: (event: ApplyProgress) => void) {
  return (step: ApplyProgress["step"], status: ApplyProgress["status"], message: string): void => {
    callback?.({ step, status, message });
  };
}

