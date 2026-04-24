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

import { getProvider, getProvidersForDomain } from "../../design/catalog/providers.js";
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
import type { IntegrationEnvKey } from "./types.js";
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
  const { deployDir, name, credentials, skipValidation, onProgress, providerId, slot } = options;

  const def = getIntegrationDef(name);
  if (!def) {
    return { success: false, integrationName: name, validated: false, error: `Unknown integration "${name}"` };
  }

  // Multi-provider domains (email, calendar) must specify a provider id from
  // the catalog. Without it, composition.providers gets `providers.email =
  // "email"` which isn't a valid provider id, `getProvider` returns undefined,
  // and the downstream compile emits an empty himalaya config. Accepting a
  // generic add for single-provider integrations (telegram, tavily, etc.)
  // stays unchanged.
  if (isMultiProviderDomain(name) && !providerId) {
    return {
      success: false,
      integrationName: name,
      validated: false,
      error:
        `Integration "${name}" has multiple providers in the catalog — specify one ` +
        `with --provider. Available: ${getProvidersForDomain(name).map((p) => p.id).join(", ")}.`,
    };
  }
  if (providerId) {
    const p = getProvider(providerId);
    if (!p) {
      return {
        success: false,
        integrationName: name,
        validated: false,
        error: `Unknown provider "${providerId}". Available for ${name}: ${getProvidersForDomain(name).map((p) => p.id).join(", ")}.`,
      };
    }
    if (p.domain !== name) {
      return {
        success: false,
        integrationName: name,
        validated: false,
        error: `Provider "${providerId}" serves domain "${p.domain}", not "${name}".`,
      };
    }
  }

  const slotNum = slot ?? 1;
  if (slotNum < 1) {
    return { success: false, integrationName: name, validated: false, error: `Slot must be >= 1 (got ${slotNum}).` };
  }
  const domainKey = slotNum === 1 ? name : `${name}-${slotNum}`;
  const envPrefix = slotNum === 1 ? "" : `${name.toUpperCase()}_${slotNum}_`;
  const manifestName = slotNum === 1 ? name : `${name}-${slotNum}`;

  // Check if already installed — slot-scoped so `email` and `email-2` coexist.
  const manifest = loadIntegrationManifest(deployDir);
  const existing = manifest.integrations.find((i) => i.name === manifestName);
  if (existing) {
    return {
      success: false,
      integrationName: manifestName,
      validated: false,
      error: `Integration "${manifestName}" is already configured. Remove it first to reconfigure.`,
    };
  }

  // Create rollback snapshot before making changes
  await createCapabilitySnapshot(deployDir, "integrations", `pre-add: ${manifestName}`);

  // Pick the envKey schema. When a provider is specified, prefer the catalog
  // (it carries provider-specific host defaults — imap.gmail.com vs
  // imap.mail.me.com — that the generic registry doesn't). Otherwise fall
  // back to the registry's schema for single-provider integrations.
  const envKeysSchema = providerId
    ? providerEnvKeysFromCatalog(providerId) ?? def.envKeys
    : def.envKeys;

  // Store credentials in both .env files (root + engine) and credentials.json
  progress(onProgress, "credentials", "running", `Storing credentials for ${def.label}${slotNum > 1 ? ` (slot ${slotNum})` : ""}`);
  const engineEnvPath = join(deployDir, "engine", ".env");
  const rootEnvPath = join(deployDir, ".env");
  const storedKeys: string[] = [];
  const credValues: Record<string, string> = {};

  for (const envKey of envKeysSchema) {
    const value = credentials?.[envKey.key] ?? envKey.defaultValue;
    if (value) {
      const storedKey = `${envPrefix}${envKey.key}`;
      writeEnvValue(engineEnvPath, storedKey, value);
      writeEnvValue(rootEnvPath, storedKey, value);
      storedKeys.push(storedKey);
      if (envKey.secret) {
        credValues[storedKey] = value;
      }
    }
  }

  // Store secret credentials in credentials.json (mode 0600)
  if (Object.keys(credValues).length > 0) {
    storeIntegrationCredentials(deployDir, manifestName, credValues);
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
    name: manifestName,
    envKeys: storedKeys,
    validated,
    addedAt: new Date().toISOString(),
    lastValidatedAt: validated ? new Date().toISOString() : undefined,
  };
  const updated = upsertIntegration(manifest, entry);
  saveIntegrationManifest(deployDir, updated);

  // Update clawhq.yaml — record the provider binding so apply can compile it.
  updateClawhqYaml(deployDir, name, def.category, { providerId, domainKey });

  progress(onProgress, "manifest", "done", "Manifest updated");

  return { success: true, integrationName: manifestName, validated, needsApply: true };
}

// ── Provider Resolution Helpers ────────────────────────────────────────────

/** Whether an integration name maps to a multi-provider domain in the catalog.
 *  Today: email (Gmail/iCloud/Fastmail/Outlook/generic-imap) and calendar
 *  (iCloud/Google/Fastmail/generic-caldav). Single-provider integrations
 *  like telegram/tavily/github fall through to the registry's single schema. */
function isMultiProviderDomain(name: string): boolean {
  return getProvidersForDomain(name).length > 1;
}

/** Pull the envKey schema for a catalog provider in the shape the
 *  integrate-add loop expects. The catalog's envVars and the registry's
 *  envKeys differ in one small way — `default` vs `defaultValue` — so this
 *  normalises. Returns undefined for unknown provider ids; caller falls back
 *  to the registry schema. */
function providerEnvKeysFromCatalog(providerId: string): readonly IntegrationEnvKey[] | undefined {
  const p = getProvider(providerId);
  if (!p) return undefined;
  return p.envVars.map((ev) => ({
    key: ev.key,
    label: ev.label,
    secret: ev.secret ?? false,
    ...(ev.default !== undefined ? { defaultValue: ev.default } : {}),
  }));
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

  // Clean the clawhq.yaml binding so the next apply doesn't re-add firewall
  // rules or regenerate provider-specific config for a removed integration.
  // Without this, `integrate remove email` cleaned .env and the manifest
  // but left `composition.providers.email: icloud` in clawhq.yaml — and a
  // subsequent apply would re-emit the himalaya config (now with empty
  // credentials) and block again on the fail-loud generator.
  removeFromClawhqYaml(deployDir, name);

  return { success: true, integrationName: name, envKeysRemoved };
}

/**
 * Clean an integration's entry from clawhq.yaml. Mirrors the writes done in
 * updateClawhqYaml: channel integrations come out of composition.channels;
 * provider integrations come out of composition.providers. Best-effort — if
 * clawhq.yaml is malformed or missing the key, silently proceed.
 */
function removeFromClawhqYaml(deployDir: string, integrationName: string): void {
  const configPath = join(deployDir, "clawhq.yaml");
  if (!existsSync(configPath)) return;

  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = yamlParse(raw) as Record<string, unknown>;
    if (!config.composition || typeof config.composition !== "object") return;
    const comp = config.composition as Record<string, unknown>;

    let changed = false;

    if (CHANNEL_INTEGRATIONS.has(integrationName)) {
      const channels = comp.channels as Record<string, unknown> | undefined;
      if (channels && integrationName in channels) {
        delete channels[integrationName];
        if (Object.keys(channels).length === 0) delete comp.channels;
        changed = true;
      }
    } else {
      // For provider integrations the manifest name may be slot-suffixed
      // (`email-2`) — that IS the domain key in composition.providers.
      const providers = comp.providers as Record<string, unknown> | undefined;
      if (providers && integrationName in providers) {
        delete providers[integrationName];
        if (Object.keys(providers).length === 0) delete comp.providers;
        changed = true;
      }
    }

    if (!changed) return;

    config.composition = comp;
    writeFileSync(configPath, yamlStringify(config), "utf-8");
  } catch {
    // Best effort — don't fail the integration remove because of yaml update
  }
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
 * For provider integrations, records them under composition.providers.
 * When `opts.providerId` is given, the value written is the catalog provider
 * id (gmail, icloud, etc.) so the downstream compile can resolve it.
 * Without providerId, the integration name is written as a placeholder — a
 * fallback that only works for single-provider integrations whose name
 * happens to also be a valid catalog provider id (e.g. `tavily`).
 */
function updateClawhqYaml(
  deployDir: string,
  integrationName: string,
  category: string,
  opts: { readonly providerId?: string; readonly domainKey?: string } = {},
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
      // Record as a provider in composition.providers. domainKey carries the
      // slot: primary `email` vs secondary `email-2`. providerId is the
      // catalog id (gmail/icloud/etc.), falling back to the integration name
      // for single-provider integrations that double as provider ids.
      const domainKey = opts.domainKey ?? integrationName;
      const providerValue = opts.providerId ?? integrationName;
      const providers = (comp.providers ?? {}) as Record<string, string>;
      if (!providers[domainKey]) {
        providers[domainKey] = providerValue;
        comp.providers = providers;
      }
    }

    config.composition = comp;
    writeFileSync(configPath, yamlStringify(config), "utf-8");
  } catch {
    // Best effort — don't fail the integration add because of yaml update
  }
}
