/**
 * Integration manifest I/O.
 *
 * Stores integration state in ~/.clawhq/ops/integrations/.integration-manifest.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { IntegrationManifest, IntegrationManifestEntry } from "./types.js";

const MANIFEST_DIR = "ops/integrations";
const MANIFEST_FILE = ".integration-manifest.json";

function manifestPath(deployDir: string): string {
  return join(deployDir, MANIFEST_DIR, MANIFEST_FILE);
}

/** Load the integration manifest, returning empty manifest if not found. */
export function loadIntegrationManifest(deployDir: string): IntegrationManifest {
  const path = manifestPath(deployDir);
  if (!existsSync(path)) {
    return { version: 1, integrations: [] };
  }
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as IntegrationManifest;
}

/** Save the integration manifest atomically. */
export function saveIntegrationManifest(deployDir: string, manifest: IntegrationManifest): void {
  const dir = join(deployDir, MANIFEST_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(manifestPath(deployDir), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

/** Add or update an entry in the manifest. Returns new manifest. */
export function upsertIntegration(
  manifest: IntegrationManifest,
  entry: IntegrationManifestEntry,
): IntegrationManifest {
  const filtered = manifest.integrations.filter((i) => i.name !== entry.name);
  return { version: 1, integrations: [...filtered, entry] };
}

/** Remove an entry from the manifest. Returns new manifest. */
export function removeIntegration(
  manifest: IntegrationManifest,
  name: string,
): IntegrationManifest {
  return {
    version: 1,
    integrations: manifest.integrations.filter((i) => i.name !== name),
  };
}
