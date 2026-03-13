/**
 * .env file reader/writer that preserves comments and ordering.
 *
 * Parses .env files into structured entries (key-value pairs, comments, blank lines)
 * and writes them back without losing formatting.
 */

import { readFile, writeFile } from "node:fs/promises";

export interface EnvEntry {
  type: "pair" | "comment" | "blank";
  /** Raw line text (for comments and blanks) */
  raw?: string;
  /** Variable name (for pairs) */
  key?: string;
  /** Variable value (for pairs) */
  value?: string;
}

export interface EnvFile {
  entries: EnvEntry[];
}

/**
 * Parse a .env file string into structured entries.
 * Preserves comments, blank lines, and ordering.
 */
export function parseEnv(content: string): EnvFile {
  const lines = content.split("\n");
  const entries: EnvEntry[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "") {
      entries.push({ type: "blank", raw: line });
      continue;
    }

    if (trimmed.startsWith("#")) {
      entries.push({ type: "comment", raw: line });
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      // Malformed line — preserve as comment
      entries.push({ type: "comment", raw: line });
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries.push({ type: "pair", key, value });
  }

  return { entries };
}

/**
 * Serialize an EnvFile back to string, preserving comments and ordering.
 */
export function serializeEnv(env: EnvFile): string {
  return env.entries
    .map((entry) => {
      if (entry.type === "blank") return entry.raw ?? "";
      if (entry.type === "comment") return entry.raw ?? "";
      return `${entry.key}=${entry.value}`;
    })
    .join("\n");
}

/**
 * Read and parse a .env file from disk.
 */
export async function readEnvFile(path: string): Promise<EnvFile> {
  const content = await readFile(path, "utf-8");
  return parseEnv(content);
}

/**
 * Write an EnvFile to disk.
 */
export async function writeEnvFile(path: string, env: EnvFile): Promise<void> {
  await writeFile(path, serializeEnv(env), "utf-8");
}

/**
 * Get a value from the env file by key.
 */
export function getEnvValue(env: EnvFile, key: string): string | undefined {
  const entry = env.entries.find((e) => e.type === "pair" && e.key === key);
  return entry?.value;
}

/**
 * Set a value in the env file. Updates existing key or appends new entry.
 */
export function setEnvValue(env: EnvFile, key: string, value: string): void {
  const existing = env.entries.find((e) => e.type === "pair" && e.key === key);
  if (existing) {
    existing.value = value;
  } else {
    env.entries.push({ type: "pair", key, value });
  }
}

/**
 * Remove a key from the env file.
 * Returns true if the key was found and removed.
 */
export function removeEnvValue(env: EnvFile, key: string): boolean {
  const index = env.entries.findIndex(
    (e) => e.type === "pair" && e.key === key,
  );
  if (index === -1) return false;
  env.entries.splice(index, 1);
  return true;
}

/**
 * Get all key-value pairs as a plain object.
 */
export function envToObject(env: EnvFile): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const entry of env.entries) {
    if (entry.type === "pair" && entry.key) {
      obj[entry.key] = entry.value ?? "";
    }
  }
  return obj;
}
