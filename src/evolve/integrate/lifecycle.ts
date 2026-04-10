/**
 * Integration lifecycle — add, remove, test.
 *
 * `clawhq integrate add <name>` stores credentials in .env, runs a live
 * validation probe, and updates the integration manifest. Credentials
 * can be supplied via --credentials flag or collected interactively.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parse as yamlParse, stringify as yamlStringify } from "yaml";

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

  // Store credentials in both .env files (root + engine) and credentials.json
  progress(onProgress, "credentials", "running", `Storing credentials for ${def.label}`);
  const engineEnvPath = join(deployDir, "engine", ".env");
  const rootEnvPath = join(deployDir, ".env");
  const storedKeys: string[] = [];
  const credValues: Record<string, string> = {};

  for (const envKey of def.envKeys) {
    const value = credentials?.[envKey.key] ?? envKey.defaultValue;
    if (value) {
      writeEnvValue(engineEnvPath, envKey.key, value);
      writeEnvValue(rootEnvPath, envKey.key, value);
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
    const env = getAllEnvValues(readEnv(engineEnvPath));
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

  // Update clawhq.yaml — record channel integrations so apply can enable them
  updateClawhqYaml(deployDir, name, def.category);

  progress(onProgress, "manifest", "done", "Manifest updated");

  return { success: true, integrationName: name, validated, needsApply: true };
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

// ── clawhq.yaml Update ───────────────────────────────────────────────────

/** Channel integration names that map to openclaw.json channels. */
const CHANNEL_INTEGRATIONS = new Set(["telegram", "whatsapp", "discord", "signal"]);

/**
 * Update clawhq.yaml to record an integration.
 *
 * For channel integrations (telegram, whatsapp), records them under
 * composition.channels so that `clawhq apply` enables the channel
 * in openclaw.json.
 *
 * For provider integrations, records them under composition.providers
 * so that proxy routes and allowlists include them.
 */
function updateClawhqYaml(
  deployDir: string,
  integrationName: string,
  category: string,
): void {
  const configPath = join(deployDir, "clawhq.yaml");
  if (!existsSync(configPath)) return;

  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = yamlParse(raw) as Record<string, unknown>;

    if (!config.composition || typeof config.composition !== "object") return;
    const comp = config.composition as Record<string, unknown>;

    if (CHANNEL_INTEGRATIONS.has(integrationName)) {
      // Record channel in composition.channels
      const channels = (comp.channels ?? {}) as Record<string, Record<string, string>>;
      if (!channels[integrationName]) {
        channels[integrationName] = {};
        comp.channels = channels;
      }
    } else if (category === "productivity" || category === "data" || category === "communication") {
      // Record as a provider in composition.providers
      const providers = (comp.providers ?? {}) as Record<string, string>;
      if (!providers[integrationName]) {
        providers[integrationName] = integrationName;
        comp.providers = providers;
      }
    }

    config.composition = comp;
    writeFileSync(configPath, yamlStringify(config), "utf-8");
  } catch {
    // Best effort — don't fail the integration add because of yaml update
  }
}
