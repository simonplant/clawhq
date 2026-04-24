/**
 * `clawhq apply` — idempotent config regeneration from deployed clawhq.yaml.
 *
 * Reads the composition config (profile + personality + providers), calls the
 * catalog compiler, and writes all derivable files. Preserves stateful data
 * (memory, custom tools, credentials). Safe to run repeatedly.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { parse as yamlParse } from "yaml";

import type { BuildSecurityPosture } from "../../build/docker/index.js";
import { formatPostureDegradations, resolvePosture } from "../../build/docker/index.js";
import { GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";
import {
  ENV_PLACEHOLDER,
  protectCredentials as protectCredentialsText,
} from "../../config/env-merge.js";
import { DeployLockBusyError, withDeployLock } from "../../config/lock.js";
import { compile, validateCompiled } from "../../design/catalog/index.js";
import type { CompiledFile } from "../../design/catalog/types.js";
import type { UserConfig } from "../../design/catalog/types.js";
import { writeBundle } from "../../design/configure/writer.js";
import { loadCronStore } from "../../openclaw/cron-store.js";
import { loadRuntimeConfig } from "../../openclaw/runtime-config.js";

import { withTransaction } from "./transaction.js";
import type { ApplyOptions, ApplyProgress, ApplyReport, ApplyResult } from "./types.js";

export type { ApplyOptions, ApplyProgress, ApplyReport, ApplyResult } from "./types.js";

// ── Stateful Paths (never overwritten) ──────────────────────────────────────

/** Files the compiler generates but apply must not overwrite.
 *
 * compile() emits engine/docker-compose.yml and writes it through the
 * normal bundle path (replacing the previous build-time writer). The
 * skip set is narrow: just the compiler defaults we want to preserve on
 * every apply. clawhq.yaml is not emitted by compile() — scaffold owns
 * the initial seed. */
const SKIP_PATHS = new Set([
  "workspace/MEMORY.md",                          // user's curated memory
  "workspace/config/substack-aliases.json",       // user's publication aliases
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
  "workspace/x-watchlist.json",                 // user-curated X accounts/searches
]);

/** Files where apply merges compiled output with existing runtime state. */
const MERGE_PATHS = new Set([
  "cron/jobs.json",                              // compiler owns job definitions, preserve runtime state
]);


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
          providers?: Record<string, string>;
          model?: string;
          modelContextWindow?: number;
          modelFallbacks?: string[];
          extra_egress_domains?: string[];
        }
      | undefined;

    if (!comp?.profile) {
      report("read", "failed", "No composition.profile in clawhq.yaml");
      return { success: false, error: "clawhq.yaml has no composition.profile", report: emptyReport() };
    }

    const soulOverrides = typeof raw.soul_overrides === "string" ? raw.soul_overrides : undefined;

    report("read", "done", `Profile: ${comp.profile}`);

    // Extract optional top-level access block (runtime host-file mounts, etc.)
    const accessRaw = raw.access as Record<string, unknown> | undefined;
    const accessMounts = accessRaw?.readOnlyHostMounts;
    const readOnlyHostMounts = Array.isArray(accessMounts)
      ? accessMounts.filter((m): m is string => typeof m === "string")
      : undefined;

    // Deployment-scoped settings used by compose emission. instanceName
    // lives at the top level of clawhq.yaml; posture comes from the
    // security.posture block and drives container hardening.
    const instanceName = typeof raw.instanceName === "string" ? raw.instanceName : undefined;
    const securityRaw = raw.security as Record<string, unknown> | undefined;
    const postureVal = typeof securityRaw?.posture === "string" ? securityRaw.posture : undefined;
    const posture: BuildSecurityPosture | undefined =
      postureVal === "minimal" || postureVal === "hardened" || postureVal === "under-attack"
        ? postureVal
        : undefined;

    // 2. Extract user context from existing USER.md
    const user = readUserContext(deployDir);

    // 3. Read existing env (needed for proxy/Tailscale detection and credential preservation)
    const existingEnv = readExistingEnv(deployDir);

    // 4. Resolve posture against the host before compile, so compose-gen
    //    reflects reality (e.g. omits `runtime: runsc` when gVisor isn't
    //    installed). Degradations are surfaced as warnings — the user's
    //    security intent is preserved in the posture record, but the
    //    compose file must describe what will actually run.
    const resolved = await resolvePosture(posture ?? "hardened");
    const warnings = formatPostureDegradations(resolved.degradations);

    // 5. Compile — pass existing env so compiler detects integrations from `integrate add`
    report("compile", "running", "Compiling workspace…");
    const gatewayPort = options.gatewayPort ?? GATEWAY_DEFAULT_PORT;
    const compiled = compile(
      {
        profile: comp.profile,
        providers: comp.providers,
        model: comp.model,
        modelContextWindow: comp.modelContextWindow,
        modelFallbacks: comp.modelFallbacks,
        extra_egress_domains: comp.extra_egress_domains,
        soul_overrides: soulOverrides,
      },
      user,
      deployDir,
      gatewayPort,
      existingEnv,
      readOnlyHostMounts ? { readOnlyHostMounts } : {},
      {
        ...(posture ? { posture } : {}),
        ...(instanceName ? { instanceName } : {}),
        runtimeAvailable: resolved.runtimeAvailable,
      },
    );
    report("compile", "done", `${compiled.files.length} files compiled`);

    // 4b. Landmine validation — runs against the compiled output before
    //     any file is written. Fails fast with the specific rule(s) that
    //     would ship a broken deployment (device auth loop, missing CORS,
    //     container escape surface, etc.). This replaces the legacy
    //     DeploymentBundle-based validateBundle; the validator now
    //     consumes compile() output directly, no intermediate shim.
    const effectiveEnv = buildEffectiveEnv(compiled.files, existingEnv);
    const validation = validateCompiled(compiled, effectiveEnv);
    if (!validation.valid) {
      const errs = validation.errors
        .map((e) => `  • ${e.rule}: ${e.message}`)
        .join("\n");
      report("compile", "failed", `Landmine validation failed:\n${errs}`);
      return {
        success: false,
        error: `Landmine validation failed:\n${errs}`,
        report: emptyReport(),
      };
    }

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
      ...(warnings.length > 0 ? { warnings } : {}),
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
  const telegramChatId = content.match(/\*\*Telegram chat id:\*\*\s*(\S+)/)?.[1]?.trim() || undefined;
  return { name, timezone, communication, constraints, telegramChatId };
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

// ── Effective Env Key Set ──────────────────────────────────────────────────

/**
 * Build the env-var key set that the deployed .env will carry.
 *
 * LM-11 only checks presence of compose `${VAR}` references, so we just
 * need every key that will live in the final merged .env — union of
 * the compiler's freshly emitted keys and whatever real credentials the
 * existing deployment already holds (which the writer's mergeEnv
 * preserves). Values are placeholder; the check is key-only.
 */
function buildEffectiveEnv(
  files: readonly CompiledFile[],
  existingEnv: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = { ...existingEnv };
  for (const f of files) {
    if (!f.relativePath.endsWith(".env")) continue;
    for (const line of f.content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq);
      if (!(key in env)) env[key] = trimmed.slice(eq + 1);
    }
  }
  return env;
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
 * Wrap the canonical `protectCredentials` helper to return a CompiledFile
 * instead of a plain string. Delegates the string-level logic — including
 * multi-line quoted value handling — to the single source of truth in
 * `src/config/env-merge.ts`.
 */
function protectCredentials(
  file: CompiledFile,
  existingEnv: Record<string, string>,
): CompiledFile {
  return { ...file, content: protectCredentialsText(file.content, existingEnv) };
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
    // Mode drift also counts as a change: a 0o755 tool script that's been
    // chmodded to 0o644 has matching content but a broken execution bit.
    // Without this check, apply silently skips the file and the agent
    // keeps hitting "Permission denied" on every invocation.
    const existingMode = statSync(absPath).mode & 0o777;
    const expectedMode = file.mode ?? 0o644;
    if (existingHash === newHash && existingMode === expectedMode) {
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

