/**
 * Atomic file writer for generated config.
 *
 * Never produces partial files. Uses the temp-file + fsync + rename pattern:
 * 1. Write content to a temporary file in the same directory
 * 2. fsync to ensure content is on disk
 * 3. Rename (atomic on POSIX) to the final path
 *
 * If any step fails, the temporary file is cleaned up and the target
 * path is never modified.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { FILE_MODE_CONFIG } from "../../config/defaults.js";

import type { FileEntry, WriteResult } from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Temp file prefix for atomic writes. */
const TEMP_PREFIX = ".clawhq-tmp-";

// ── Errors ───────────────────────────────────────────────────────────────────

/** Error during atomic file writing. */
export class WriteError extends Error {
  readonly targetPath: string;

  constructor(targetPath: string, message: string, options?: ErrorOptions) {
    super(`Failed to write "${targetPath}": ${message}`, options);
    this.name = "WriteError";
    this.targetPath = targetPath;
  }
}

// ── Atomic Write ─────────────────────────────────────────────────────────────

/**
 * Write a single file atomically.
 *
 * Creates parent directories as needed. The target path is never left
 * in a partial state — either the full content is written or the
 * original file (if any) is untouched.
 *
 * @param absolutePath — Full path to the target file
 * @param content — File content to write
 * @param mode — File permission mode (default FILE_MODE_CONFIG / 0o644)
 */
export function writeFileAtomic(
  absolutePath: string,
  content: string,
  mode: number = FILE_MODE_CONFIG,
): void {
  const dir = dirname(absolutePath);
  const tempPath = join(dir, `${TEMP_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`);

  // Ensure parent directory exists
  mkdirSync(dir, { recursive: true });

  let fd: number | undefined;
  try {
    // Write to temp file
    fd = openSync(tempPath, "w", mode);
    writeSync(fd, content, 0, "utf-8");

    // Flush to disk
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;

    // Atomic rename
    renameSync(tempPath, absolutePath);
  } catch (error) {
    // Clean up temp file on failure
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* best effort */ }
    }
    try { unlinkSync(tempPath); } catch { /* may not exist */ }

    throw new WriteError(
      absolutePath,
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
}

// ── Env Merge ───────────────────────────────────────────────────────────────

/** Placeholder value emitted by the compiler for unfilled credentials. */
const ENV_PLACEHOLDER = "CHANGE_ME";

/**
 * Parse a raw .env value: strip surrounding quotes and inline comments.
 *
 * - Quoted values (`"val"` or `'val'`): return content between quotes
 * - Unquoted values: strip inline comments (`#` preceded by whitespace)
 * - `#` without preceding whitespace is NOT a comment (e.g. URL anchors)
 */
function parseEnvValue(raw: string): string {
  const first = raw.charAt(0);

  // Quoted value — extract content between matching quotes (handling escaped quotes)
  if ((first === '"' || first === "'") && raw.length >= 2) {
    let i = 1;
    while (i < raw.length) {
      if (raw[i] === "\\" && i + 1 < raw.length) {
        i += 2; // skip escaped character
        continue;
      }
      if (raw[i] === first) {
        return raw.slice(1, i).replace(/\\(.)/g, "$1"); // unescape
      }
      i++;
    }
    // No closing quote found — return as-is minus opening quote
    return raw.slice(1);
  }

  // Unquoted — strip inline comment (# preceded by whitespace)
  const commentIdx = raw.search(/\s#/);
  if (commentIdx !== -1) {
    return raw.slice(0, commentIdx).trimEnd();
  }

  return raw;
}

/**
 * Parse a .env file into a map of KEY → parsed value.
 * Strips surrounding quotes and inline comments from values.
 * Skips comment lines and blank lines.
 */
export function parseEnvFile(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    map.set(trimmed.slice(0, eqIdx), parseEnvValue(trimmed.slice(eqIdx + 1)));
  }
  return map;
}

/**
 * Merge a newly generated .env with an existing one on disk.
 *
 * Rules:
 * - New keys/comments/structure always come from the generated content
 * - If the existing file has a real value (not CHANGE_ME) for a key,
 *   that value is preserved even if the generated file says CHANGE_ME
 * - If the generated file has a new real value, it wins
 */
function mergeEnv(absolutePath: string, generated: string): string {
  if (!existsSync(absolutePath)) return generated;

  let existing: string;
  try {
    existing = readFileSync(absolutePath, "utf-8");
  } catch {
    return generated;
  }

  const existingParsed = parseEnvFile(existing);
  if (existingParsed.size === 0) return generated;

  // Build a map of KEY → raw line from the existing file (preserves quotes)
  const existingRawLines = new Map<string, string>();
  for (const line of existing.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    existingRawLines.set(trimmed.slice(0, eqIdx), trimmed);
  }

  // Walk the generated content line by line, substituting preserved values
  const lines = generated.split("\n");
  const generatedKeys = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx < 1) continue;

    const key = line.slice(0, eqIdx);
    const newVal = parseEnvValue(line.slice(eqIdx + 1));
    const oldParsed = existingParsed.get(key);

    // Preserve existing real value when generated is a placeholder
    if (oldParsed && oldParsed !== ENV_PLACEHOLDER && newVal === ENV_PLACEHOLDER) {
      const rawLine = existingRawLines.get(key);
      if (rawLine) lines[i] = rawLine;
    }

    // Track which existing keys appear in the generated template
    generatedKeys.add(key);
  }

  // Append existing keys that aren't in the generated template.
  // These are credentials added after init (e.g. via `clawhq integrate add`)
  // that the template doesn't know about.
  const orphanedLines: string[] = [];
  for (const [key, rawLine] of existingRawLines) {
    if (!generatedKeys.has(key)) {
      const parsed = existingParsed.get(key);
      if (parsed && parsed !== ENV_PLACEHOLDER) {
        orphanedLines.push(rawLine);
      }
    }
  }

  if (orphanedLines.length > 0) {
    // Ensure a blank line separates generated content from preserved keys
    const lastLine = lines[lines.length - 1]?.trim();
    if (lastLine !== "") {
      lines.push("");
    }
    lines.push("# Preserved from previous configuration", ...orphanedLines);
  }

  return lines.join("\n") + "\n";
}

// ── Batch Write ──────────────────────────────────────────────────────────────

/**
 * Files that first-time install flows (init / quickstart) must NOT clobber
 * when the deploy already exists. Intentionally small — these are files
 * where a fresh bundle carries stub / default content that would replace
 * legitimate user input or runtime state:
 *
 * - `clawhq.yaml`     — user's input manifest (composition block).
 * - `cron/jobs.json`  — OpenClaw daemon's persistent job store.
 * - `engine/openclaw.json` — OpenClaw runtime config (provider routing,
 *                      channel allowlist, plugin state).
 *
 * Used by `filesForFreshInstall()` — init/quickstart wrap their bundle
 * through that filter. `clawhq apply` does NOT use the filter: apply is
 * the "regenerate from manifest" path and is supposed to rewrite these
 * files from current composition.
 *
 * `clawhq init --reset` archives the existing deploy to an attic first,
 * so the preserved paths don't exist by the time the filter runs — fresh
 * install proceeds as intended.
 */
const PRESERVE_ON_FRESH_INSTALL = new Set([
  "clawhq.yaml",
  "cron/jobs.json",
  "engine/openclaw.json",
]);

/**
 * Filter a bundle for first-time-install callers (init / quickstart).
 *
 * Drops entries whose target already exists on disk AND is in the
 * "preserve on re-init" list — protects the user from an accidental
 * re-init from replacing their composition / cron / openclaw config with
 * stubs. Apply does not use this filter — it uses the full bundle and
 * the caller's merge logic (mergeCronJobs, mergeEnv) to update files
 * safely.
 */
export function filesForFreshInstall(
  deployDir: string,
  files: readonly FileEntry[],
): readonly FileEntry[] {
  const resolvedDir = resolve(deployDir);
  return files.filter((f) => {
    if (!PRESERVE_ON_FRESH_INSTALL.has(f.relativePath)) return true;
    return !existsSync(join(resolvedDir, f.relativePath));
  });
}

/**
 * Write multiple files atomically to a deploy directory.
 *
 * Each file is written individually using the atomic pattern. If any file
 * fails, previously written files remain (they were each atomically complete).
 *
 * `.env` files merge with existing values (see mergeEnv). All other files
 * are written verbatim — if a caller needs to preserve existing files, it
 * must filter the bundle before calling (see `filesForFreshInstall`).
 *
 * @param deployDir — Root deployment directory (e.g. ~/.clawhq)
 * @param files — Files to write, with paths relative to deployDir
 * @returns WriteResult with list of written absolute paths
 */
export function writeBundle(
  deployDir: string,
  files: readonly FileEntry[],
): WriteResult {
  const resolvedDir = resolve(deployDir);
  const written: string[] = [];

  for (const file of files) {
    const absolutePath = join(resolvedDir, file.relativePath);
    const content = file.relativePath.endsWith(".env")
      ? mergeEnv(absolutePath, file.content)
      : file.content;
    writeFileAtomic(absolutePath, content, file.mode);
    written.push(absolutePath);
  }

  return { written, deployDir: resolvedDir };
}
