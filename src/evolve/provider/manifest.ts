/**
 * Provider manifest I/O.
 *
 * Stores provider state in ~/.clawhq/ops/providers/.provider-manifest.json.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DIR_MODE_SECRET, FILE_MODE_SECRET } from "../../config/defaults.js";

import type { ProviderManifest, ProviderManifestEntry } from "./types.js";

const MANIFEST_DIR = "ops/providers";
const MANIFEST_FILE = ".provider-manifest.json";

function manifestPath(deployDir: string): string {
  return join(deployDir, MANIFEST_DIR, MANIFEST_FILE);
}

/** Load the provider manifest, returning empty manifest if not found. */
export function loadProviderManifest(deployDir: string): ProviderManifest {
  const path = manifestPath(deployDir);
  if (!existsSync(path)) {
    return { version: 1, providers: [] };
  }
  // Parse errors throw loudly — silent empty-fallback would drop every
  // configured provider on a single corrupted write.
  let parsed: Record<string, unknown>;
  try {
    const raw = readFileSync(path, "utf-8");
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `provider manifest at ${path} is corrupt: ${msg}. ` +
      `Inspect the file manually; do not run \`clawhq provider\` commands until this is resolved.`,
      { cause: err },
    );
  }
  if (parsed.version !== 1) {
    throw new Error(
      `Unsupported provider manifest version ${String(parsed.version)} (expected 1). ` +
      `The manifest at ${path} may have been created by a newer version of ClawHQ.`,
    );
  }
  if (!Array.isArray(parsed.providers)) {
    throw new Error(`provider manifest at ${path} is missing the \`providers\` array`);
  }
  return parsed as unknown as ProviderManifest;
}

/** Save the provider manifest. */
export function saveProviderManifest(deployDir: string, manifest: ProviderManifest): void {
  const path = manifestPath(deployDir);
  try {
    mkdirSync(join(deployDir, MANIFEST_DIR), { recursive: true, mode: DIR_MODE_SECRET });
    chmodSync(join(deployDir, MANIFEST_DIR), DIR_MODE_SECRET);
    writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", { mode: FILE_MODE_SECRET });
  } catch (err) {
    throw new Error(`Failed to write provider manifest: ${path}`, { cause: err });
  }
}

/** Add or update a provider entry. Returns new manifest. */
export function upsertProvider(
  manifest: ProviderManifest,
  entry: ProviderManifestEntry,
): ProviderManifest {
  const filtered = manifest.providers.filter((p) => p.name !== entry.name);
  return { version: 1, providers: [...filtered, entry] };
}

/** Remove a provider entry. Returns new manifest. */
export function removeProvider(
  manifest: ProviderManifest,
  name: string,
): ProviderManifest {
  return {
    version: 1,
    providers: manifest.providers.filter((p) => p.name !== name),
  };
}
