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
import { compile } from "../../design/catalog/index.js";
import type { CompiledFile } from "../../design/catalog/types.js";
import type { UserConfig } from "../../design/catalog/types.js";
import { writeBundle } from "../../design/configure/writer.js";

import type { ApplyOptions, ApplyProgress, ApplyReport, ApplyResult } from "./types.js";

export type { ApplyOptions, ApplyProgress, ApplyReport, ApplyResult } from "./types.js";

// ── Stateful Paths (never overwritten) ──────────────────────────────────────

/** Files the compiler generates but apply must not overwrite. */
const SKIP_PATHS = new Set([
  "workspace/MEMORY.md",  // user's curated memory
  "clawhq.yaml",          // we're reading from it — don't overwrite
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

  try {
    // 1. Read clawhq.yaml
    report("read", "running", "Reading clawhq.yaml…");
    const configPath = join(deployDir, "clawhq.yaml");
    if (!existsSync(configPath)) {
      report("read", "failed", "clawhq.yaml not found");
      return { success: false, error: `clawhq.yaml not found at ${configPath}`, report: emptyReport() };
    }

    const raw = yamlParse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    const comp = raw.composition as { profile?: string; personality?: string; providers?: Record<string, string> } | undefined;

    if (!comp?.profile) {
      report("read", "failed", "No composition.profile in clawhq.yaml");
      return { success: false, error: "clawhq.yaml has no composition.profile", report: emptyReport() };
    }

    report("read", "done", `Profile: ${comp.profile}, Personality: ${comp.personality ?? "default"}`);

    // 2. Extract user context from existing USER.md
    const user = readUserContext(deployDir);

    // 3. Compile
    report("compile", "running", "Compiling workspace…");
    const gatewayPort = options.gatewayPort ?? GATEWAY_DEFAULT_PORT;
    const compiled = compile(
      {
        profile: comp.profile,
        personality: comp.personality ?? "digital-assistant",
        providers: comp.providers,
      },
      user,
      deployDir,
      gatewayPort,
    );
    report("compile", "done", `${compiled.files.length} files compiled`);

    // 4. Filter stateful files
    let files: CompiledFile[] = compiled.files.filter((f) => !SKIP_PATHS.has(f.relativePath));

    // 5. Report proxy status (compiler handles proxy detection + wiring)
    const proxyFiles = files.filter((f) => f.relativePath.includes("cred-proxy"));
    if (proxyFiles.length > 0) {
      report("proxy", "done", `Proxy configured (${proxyFiles.length} files)`);
    } else {
      report("proxy", "done", "No proxy routes needed");
    }

    // 6. Protect existing credentials — replace generated real values with
    //    CHANGE_ME so the writer's merge preserves existing .env values
    const existingEnv = readExistingEnv(deployDir);
    files = files.map((f) =>
      f.relativePath.endsWith(".env") ? protectCredentials(f, existingEnv) : f,
    );

    // 7. Compute diff
    report("diff", "running", "Computing changes…");
    const diffReport = computeDiff(deployDir, files);
    report("diff", "done",
      `${diffReport.added.length} added, ${diffReport.changed.length} changed, ${diffReport.unchanged.length} unchanged`,
    );

    // 8. Write (unless dry-run)
    if (!dryRun) {
      report("write", "running", "Writing files…");
      writeBundle(deployDir, files.map((f) => ({
        relativePath: f.relativePath,
        content: f.content,
        mode: f.mode,
      })));
      report("write", "done", `${diffReport.added.length + diffReport.changed.length} file(s) written`);
    }

    return {
      success: true,
      report: {
        ...diffReport,
        skipped: [...SKIP_PATHS],
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, report: emptyReport() };
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
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq);
    const newVal = line.slice(eq + 1);
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

