/**
 * Integration manifest I/O.
 *
 * Stores integration state in ~/.clawhq/ops/integrations/.integration-manifest.json.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DIR_MODE_SECRET, FILE_MODE_SECRET } from "../../config/defaults.js";

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
  let parsed: Record<string, unknown>;
  try {
    const raw = readFileSync(path, "utf-8");
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    return { version: 1, integrations: [] };
  }
  if (parsed.version !== 1) {
    throw new Error(
      `Unsupported integration manifest version ${String(parsed.version)} (expected 1). ` +
      `The manifest at ${path} may have been created by a newer version of ClawHQ.`,
    );
  }
  return parsed as unknown as IntegrationManifest;
}

/** Save the integration manifest atomically. */
export function saveIntegrationManifest(deployDir: string, manifest: IntegrationManifest): void {
  const path = manifestPath(deployDir);
  try {
    mkdirSync(join(deployDir, MANIFEST_DIR), { recursive: true, mode: DIR_MODE_SECRET });
    chmodSync(join(deployDir, MANIFEST_DIR), DIR_MODE_SECRET);
    writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", { mode: FILE_MODE_SECRET });
  } catch (err) {
    throw new Error(`Failed to write integration manifest: ${path}`, { cause: err });
  }
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
