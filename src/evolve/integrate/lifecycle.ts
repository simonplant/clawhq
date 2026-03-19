/**
 * Integration lifecycle — add, remove, test.
 *
 * `clawhq integrate add <name>` stores credentials in .env, runs a live
 * validation probe, and updates the integration manifest. Credentials
 * can be supplied via --credentials flag or collected interactively.
 */

import { join } from "node:path";

import {
  deleteIntegrationCredentials,
  storeIntegrationCredentials,
} from "../../secure/credentials/credential-store.js";
import {
  deleteEnvValue,
  readEnv,
  getAllEnvValues,
  writeEnvValue,
} from "../../secure/credentials/env-store.js";
import { createCapabilitySnapshot } from "../rollback/capability-snapshot.js";

import {
  loadIntegrationManifest,
  removeIntegration,
  saveIntegrationManifest,
  upsertIntegration,
} from "./manifest.js";
import { getIntegrationDef } from "./registry.js";
import type {
  IntegrationAddOptions,
  IntegrationAddResult,
  IntegrationListOptions,
  IntegrationListResult,
  IntegrationProgress,
  IntegrationProgressCallback,
  IntegrationRemoveOptions,
  IntegrationRemoveResult,
  IntegrationTestOptions,
  IntegrationTestResult,
} from "./types.js";
import { validateIntegration } from "./validate.js";

/** Emit a progress event (no-op if no callback). */
function progress(
  cb: IntegrationProgressCallback | undefined,
  step: IntegrationProgress["step"],
  status: IntegrationProgress["status"],
  message: string,
): void {
  if (cb) cb({ step, status, message });
}

// ── Add Integration ────────────────────────────────────────────────────────

/**
 * Add an integration.
 *
 * 1. Validate integration exists in registry
 * 2. Store credentials in .env (mode 0600)
 * 3. Run live validation probe
 * 4. Update integration manifest
 */
export async function addIntegration(
  options: IntegrationAddOptions,
): Promise<IntegrationAddResult> {
  const { deployDir, name, credentials, skipValidation, onProgress } = options;

  const def = getIntegrationDef(name);
  if (!def) {
    return { success: false, integrationName: name, validated: false, error: `Unknown integration "${name}"` };
  }

  // Check if already installed
  const manifest = loadIntegrationManifest(deployDir);
  const existing = manifest.integrations.find((i) => i.name === name);
  if (existing) {
    return {
      success: false,
      integrationName: name,
      validated: false,
      error: `Integration "${name}" is already configured. Remove it first to reconfigure.`,
    };
  }

  // Create rollback snapshot before making changes
  await createCapabilitySnapshot(deployDir, "integrations", `pre-add: ${name}`);

  // Store credentials in both .env (for runtime) and credentials.json (for management)
  progress(onProgress, "credentials", "running", `Storing credentials for ${def.label}`);
  const envPath = join(deployDir, "engine", ".env");
  const storedKeys: string[] = [];
  const credValues: Record<string, string> = {};

  for (const envKey of def.envKeys) {
    const value = credentials?.[envKey.key] ?? envKey.defaultValue;
    if (value) {
      writeEnvValue(envPath, envKey.key, value);
      storedKeys.push(envKey.key);
      if (envKey.secret) {
        credValues[envKey.key] = value;
      }
    }
  }

  // Store secret credentials in credentials.json (mode 0600)
  if (Object.keys(credValues).length > 0) {
    storeIntegrationCredentials(deployDir, name, credValues);
  }
  progress(onProgress, "credentials", "done", `${storedKeys.length} credential(s) stored`);

  // Live validation
  let validated = false;
  if (!skipValidation) {
    progress(onProgress, "validate", "running", `Validating ${def.label} connection`);
    const env = getAllEnvValues(readEnv(envPath));
    const result = await validateIntegration(name, env);
    validated = result.ok;

    if (result.ok) {
      progress(onProgress, "validate", "done", result.message);
    } else {
      progress(onProgress, "validate", "failed", result.message);
      // Don't fail — credentials are stored, validation can be retried
    }
  } else {
    progress(onProgress, "validate", "skipped", "Validation skipped");
  }

  // Update manifest
  progress(onProgress, "manifest", "running", "Updating integration manifest");
  const entry = {
    name,
    envKeys: storedKeys,
    validated,
    addedAt: new Date().toISOString(),
    lastValidatedAt: validated ? new Date().toISOString() : undefined,
  };
  const updated = upsertIntegration(manifest, entry);
  saveIntegrationManifest(deployDir, updated);
  progress(onProgress, "manifest", "done", "Manifest updated");

  return { success: true, integrationName: name, validated };
}

// ── Remove Integration ─────────────────────────────────────────────────────

/**
 * Remove an integration.
 *
 * 1. Remove from manifest
 * 2. Delete credentials from .env (unless keepCredentials)
 */
export async function removeIntegrationCmd(
  options: IntegrationRemoveOptions,
): Promise<IntegrationRemoveResult> {
  const { deployDir, name, keepCredentials } = options;
  const manifest = loadIntegrationManifest(deployDir);
  const entry = manifest.integrations.find((i) => i.name === name);

  if (!entry) {
    return {
      success: false,
      integrationName: name,
      envKeysRemoved: [],
      error: `Integration "${name}" is not configured.`,
    };
  }

  // Create rollback snapshot before making changes
  await createCapabilitySnapshot(deployDir, "integrations", `pre-remove: ${name}`);

  // Remove env keys and credentials.json entry
  const envKeysRemoved: string[] = [];
  if (!keepCredentials) {
    const envPath = join(deployDir, "engine", ".env");
    for (const key of entry.envKeys) {
      deleteEnvValue(envPath, key);
      envKeysRemoved.push(key);
    }
    deleteIntegrationCredentials(deployDir, name);
  }

  // Update manifest
  const updated = removeIntegration(manifest, name);
  saveIntegrationManifest(deployDir, updated);

  return { success: true, integrationName: name, envKeysRemoved };
}

// ── Test Integration ───────────────────────────────────────────────────────

/**
 * Test an integration's credentials by running a live validation probe.
 */
export async function testIntegration(
  options: IntegrationTestOptions,
): Promise<IntegrationTestResult> {
  const { deployDir, name } = options;

  const def = getIntegrationDef(name);
  if (!def) {
    return { success: false, integrationName: name, message: "", error: `Unknown integration "${name}"` };
  }

  const manifest = loadIntegrationManifest(deployDir);
  const entry = manifest.integrations.find((i) => i.name === name);
  if (!entry) {
    return {
      success: false,
      integrationName: name,
      message: "",
      error: `Integration "${name}" is not configured. Add it first with: clawhq integrate add ${name}`,
    };
  }

  const envPath = join(deployDir, "engine", ".env");
  const env = getAllEnvValues(readEnv(envPath));
  const result = await validateIntegration(name, env);

  // Update manifest with validation timestamp
  if (result.ok) {
    const updatedEntry = { ...entry, validated: true, lastValidatedAt: new Date().toISOString() };
    const updated = upsertIntegration(manifest, updatedEntry);
    saveIntegrationManifest(deployDir, updated);
  }

  return {
    success: result.ok,
    integrationName: name,
    message: result.message,
    error: result.ok ? undefined : result.message,
  };
}

// ── List Integrations ──────────────────────────────────────────────────────

/**
 * List all configured integrations.
 */
export function listIntegrations(
  options: IntegrationListOptions,
): IntegrationListResult {
  const manifest = loadIntegrationManifest(options.deployDir);
  return {
    integrations: manifest.integrations,
    total: manifest.integrations.length,
  };
}
