/**
 * Secret metadata sidecar file (.env.meta).
 *
 * Tracks created_at, rotated_at, and provider_category for each secret
 * in a JSON file alongside the .env file with 600 permissions.
 */

import { chmod, readFile, stat, writeFile } from "node:fs/promises";

import type { MetadataFile, SecretMetadata } from "./types.js";

/**
 * Infer provider category from a secret key name.
 */
export function inferCategory(key: string): string {
  const upper = key.toUpperCase();

  if (upper.includes("ANTHROPIC")) return "ai";
  if (upper.includes("OPENAI")) return "ai";
  if (upper.includes("OLLAMA")) return "ai";
  if (upper.includes("GOOGLE") && upper.includes("AI")) return "ai";

  if (upper.includes("TELEGRAM")) return "messaging";
  if (upper.includes("WHATSAPP")) return "messaging";
  if (upper.includes("SIGNAL")) return "messaging";
  if (upper.includes("SLACK")) return "messaging";
  if (upper.includes("DISCORD")) return "messaging";

  if (upper.includes("SMTP") || upper.includes("IMAP") || upper.includes("EMAIL")) return "email";

  if (upper.includes("CALDAV") || upper.includes("CALENDAR")) return "calendar";
  if (upper.includes("TODOIST") || upper.includes("TASK")) return "tasks";

  if (upper.includes("GITHUB") || upper.includes("GITLAB")) return "dev";
  if (upper.includes("LINEAR")) return "dev";

  if (upper.includes("AWS") || upper.includes("AZURE") || upper.includes("GCP")) return "cloud";

  if (upper.includes("TAVILY") || upper.includes("SEARCH")) return "search";

  if (
    upper.includes("API") ||
    upper.includes("KEY") ||
    upper.includes("TOKEN") ||
    upper.includes("SECRET")
  ) {
    return "api";
  }

  return "other";
}

/**
 * Read the metadata sidecar file. Returns empty object if not found.
 */
export async function readMetadata(metaPath: string): Promise<MetadataFile> {
  try {
    const content = await readFile(metaPath, "utf-8");
    return JSON.parse(content) as MetadataFile;
  } catch {
    return {};
  }
}

/**
 * Write the metadata sidecar file with 600 permissions.
 */
export async function writeMetadata(
  metaPath: string,
  metadata: MetadataFile,
): Promise<void> {
  await writeFile(metaPath, JSON.stringify(metadata, null, 2) + "\n", "utf-8");
  await chmod(metaPath, 0o600);
}

/**
 * Add or update metadata for a secret key.
 */
export async function setSecretMetadata(
  metaPath: string,
  key: string,
  category?: string,
): Promise<SecretMetadata> {
  const metadata = await readMetadata(metaPath);
  const now = new Date().toISOString();

  if (metadata[key]) {
    // Existing secret — update rotated_at
    metadata[key].rotated_at = now;
    if (category) {
      metadata[key].provider_category = category;
    }
  } else {
    // New secret
    metadata[key] = {
      created_at: now,
      rotated_at: null,
      provider_category: category ?? inferCategory(key),
    };
  }

  await writeMetadata(metaPath, metadata);
  return metadata[key];
}

/**
 * Remove metadata for a secret key.
 */
export async function removeSecretMetadata(
  metaPath: string,
  key: string,
): Promise<boolean> {
  const metadata = await readMetadata(metaPath);
  if (!(key in metadata)) return false;
  const rest: MetadataFile = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (k !== key) rest[k] = v;
  }
  await writeMetadata(metaPath, rest);
  return true;
}

/**
 * Enforce 600 permissions on the metadata file if it exists.
 */
export async function enforceMetaPermissions(metaPath: string): Promise<boolean> {
  try {
    const s = await stat(metaPath);
    const mode = s.mode & 0o777;
    if (mode === 0o600) return false;
    await chmod(metaPath, 0o600);
    return true;
  } catch {
    return false;
  }
}
