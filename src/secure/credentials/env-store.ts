/**
 * .env secrets store — atomic, 0600-permissioned, format-preserving.
 *
 * Every credential written to disk is atomic (temp file + rename), 0600-permissioned,
 * and survives process interruption. No partial writes, no world-readable secrets.
 *
 * This is the lowest layer of the credentials stack — everything above depends
 * on reliable .env reads and safe writes.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { DIR_MODE_SECRET, FILE_MODE_SECRET } from "../../config/defaults.js";

import type { EnvFile, EnvLine } from "./types.js";

// ── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse a .env file string into structured lines.
 *
 * Preserves comments (lines starting with #), blank lines, and entry ordering.
 * Supports unquoted, single-quoted, and double-quoted values.
 * Lines that don't match KEY=VALUE format are treated as comments.
 */
export function parseEnv(content: string): EnvFile {
  const rawLines = content.split("\n");

  // Preserve trailing newline by dropping the empty string after final \n.
  // If the file ends with \n, split produces an extra empty element.
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }

  const lines: EnvLine[] = rawLines.map((raw) => {
    // Blank lines
    if (raw.trim() === "") {
      return { kind: "blank", raw };
    }

    // Comment lines (leading whitespace allowed)
    if (raw.trimStart().startsWith("#")) {
      return { kind: "comment", raw };
    }

    // Try to parse as KEY=VALUE
    const match = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)/);
    if (!match) {
      // Unparseable — treat as comment to preserve it
      return { kind: "comment", raw };
    }

    const key = match[1];
    const rawValue = match[2];
    const value = unquote(rawValue);

    return { kind: "entry", key, value, raw };
  });

  return { lines };
}

/**
 * Read and parse a .env file from disk.
 *
 * Returns an empty EnvFile if the file doesn't exist.
 * Throws if the file exists but can't be read.
 */
export function readEnv(filePath: string): EnvFile {
  if (!existsSync(filePath)) {
    return { lines: [] };
  }

  const content = readFileSync(filePath, "utf-8");
  return parseEnv(content);
}

// ── Serializer ──────────────────────────────────────────────────────────────

/**
 * Serialize an EnvFile back to string content.
 *
 * Uses the raw line for comments and blanks. For entries, regenerates
 * KEY=VALUE format (quoting values that need it) to ensure consistency
 * after set operations.
 */
export function serializeEnv(envFile: EnvFile): string {
  if (envFile.lines.length === 0) return "";

  const parts = envFile.lines.map((line) => {
    if (line.kind === "comment" || line.kind === "blank") {
      return line.raw;
    }
    return `${line.key}=${quote(line.value)}`;
  });

  return parts.join("\n") + "\n";
}

// ── Writer ──────────────────────────────────────────────────────────────────

/**
 * Write an EnvFile to disk atomically with 0600 permissions.
 *
 * Writes to a temp file in the same directory, sets 0600, then renames.
 * rename(2) is atomic on POSIX — if the process is killed mid-write,
 * the original file is untouched. The temp file may be left behind,
 * but no partial .env is ever visible at the target path.
 */
export function writeEnvAtomic(filePath: string, envFile: EnvFile): void {
  const dir = dirname(filePath);

  // Ensure parent directory exists
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE_SECRET });
  }

  const content = serializeEnv(envFile);
  const tmpName = `.env.tmp.${randomBytes(6).toString("hex")}`;
  const tmpPath = join(dir, tmpName);

  // Write to temp file with restricted permissions
  writeFileSync(tmpPath, content, { mode: FILE_MODE_SECRET });

  // Ensure permissions are set (writeFileSync mode can be affected by umask)
  chmodSync(tmpPath, FILE_MODE_SECRET);

  // Atomic rename
  renameSync(tmpPath, filePath);
}

// ── Operations ──────────────────────────────────────────────────────────────

/**
 * Get the value of a key from an EnvFile.
 *
 * Returns undefined if the key is not found.
 */
export function getEnvValue(envFile: EnvFile, key: string): string | undefined {
  for (const line of envFile.lines) {
    if (line.kind === "entry" && line.key === key) {
      return line.value;
    }
  }
  return undefined;
}

/**
 * Set a key=value in an EnvFile, preserving format.
 *
 * If the key exists, its value is updated in place (preserving position).
 * If the key doesn't exist, a new entry is appended at the end.
 * Returns a new EnvFile — the original is not mutated.
 */
export function setEnvValue(envFile: EnvFile, key: string, value: string): EnvFile {
  let found = false;
  const lines: EnvLine[] = envFile.lines.map((line) => {
    if (line.kind === "entry" && line.key === key) {
      found = true;
      return { kind: "entry", key, value, raw: `${key}=${quote(value)}` };
    }
    return line;
  });

  if (!found) {
    lines.push({ kind: "entry", key, value, raw: `${key}=${quote(value)}` });
  }

  return { lines };
}

/**
 * Remove a key from an EnvFile, preserving all other lines.
 *
 * Returns a new EnvFile — the original is not mutated.
 * If the key doesn't exist, returns the original unchanged.
 */
export function removeEnvValue(envFile: EnvFile, key: string): EnvFile {
  const lines = envFile.lines.filter(
    (line) => !(line.kind === "entry" && line.key === key),
  );
  return { lines };
}

/**
 * Get all key-value pairs from an EnvFile as a plain object.
 */
export function getAllEnvValues(envFile: EnvFile): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of envFile.lines) {
    if (line.kind === "entry") {
      result[line.key] = line.value;
    }
  }
  return result;
}

// ── High-level convenience ──────────────────────────────────────────────────

/**
 * Read a value from a .env file on disk.
 *
 * Convenience wrapper: readEnv + getEnvValue.
 */
export function readEnvValue(filePath: string, key: string): string | undefined {
  const envFile = readEnv(filePath);
  return getEnvValue(envFile, key);
}

/**
 * Set a value in a .env file on disk (atomic, 0600).
 *
 * Convenience wrapper: readEnv + setEnvValue + writeEnvAtomic.
 */
export function writeEnvValue(filePath: string, key: string, value: string): void {
  const envFile = readEnv(filePath);
  const updated = setEnvValue(envFile, key, value);
  writeEnvAtomic(filePath, updated);
}

/**
 * Remove a value from a .env file on disk (atomic, 0600).
 *
 * Convenience wrapper: readEnv + removeEnvValue + writeEnvAtomic.
 */
export function deleteEnvValue(filePath: string, key: string): void {
  const envFile = readEnv(filePath);
  // Short-circuit when the key is already absent — no-op instead of a full
  // atomic rewrite of the whole file. Idempotent `unset X` on a clean .env
  // used to cost an unnecessary temp+fsync+rename cycle on every call.
  const hasKey = envFile.lines.some(
    (line) => line.kind === "entry" && line.key === key,
  );
  if (!hasKey) return;
  const updated = removeEnvValue(envFile, key);
  writeEnvAtomic(filePath, updated);
}

/**
 * Verify that a .env file has 0600 permissions.
 *
 * Returns true if the file exists and has mode 0600, false otherwise.
 */
export function verifyEnvPermissions(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  const stat = statSync(filePath);
  // Mask to get the permission bits only (ignore file type bits)
  return (stat.mode & 0o777) === FILE_MODE_SECRET;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Remove surrounding quotes from a value. */
function unquote(raw: string): string {
  const trimmed = raw.trim();

  // Double-quoted: process escape sequences (single pass to handle \\ correctly)
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/\\([nrt"\\])/g, (_, ch: string) => {
      switch (ch) {
        case "n": return "\n";
        case "r": return "\r";
        case "t": return "\t";
        case '"': return '"';
        case "\\": return "\\";
        default: return ch;
      }
    });
  }

  // Single-quoted: literal value, no escape processing
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }

  // Unquoted: trim inline comments (# after whitespace)
  const commentIdx = trimmed.search(/\s+#/);
  if (commentIdx !== -1) {
    return trimmed.slice(0, commentIdx);
  }

  return trimmed;
}

/** Quote a value if it contains characters that need quoting. */
function quote(value: string): string {
  // Values with newlines, tabs, or special chars need double quotes
  if (/[\n\r\t"\\]/.test(value)) {
    const escaped = value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
    return `"${escaped}"`;
  }

  // Values with spaces, #, or shell metacharacters need double quotes
  if (/[\s#$`!]/.test(value) || value === "") {
    return `"${value}"`;
  }

  // Simple values: no quoting needed
  return value;
}
