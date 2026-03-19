/**
 * Provider manifest I/O.
 *
 * Stores provider state in ~/.clawhq/ops/providers/.provider-manifest.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as ProviderManifest;
}

/** Save the provider manifest. */
export function saveProviderManifest(deployDir: string, manifest: ProviderManifest): void {
  const dir = join(deployDir, MANIFEST_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(manifestPath(deployDir), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
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
