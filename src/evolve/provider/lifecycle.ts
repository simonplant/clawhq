/**
 * Provider lifecycle — add, remove, list.
 *
 * `clawhq provider add <name>` stores the API key, validates the
 * connection, and configures model routing.
 */

import { join } from "node:path";

import { ANTHROPIC_API_VERSION } from "../../config/defaults.js";
import {
  deleteEnvValue,
  getAllEnvValues,
  readEnv,
  writeEnvValue,
} from "../../secure/credentials/env-store.js";
import { createCapabilitySnapshot } from "../rollback/capability-snapshot.js";

import {
  loadProviderManifest,
  removeProvider,
  saveProviderManifest,
  upsertProvider,
} from "./manifest.js";
import { getProviderDef } from "./registry.js";
import type {
  ProviderAddOptions,
  ProviderAddResult,
  ProviderListOptions,
  ProviderListResult,
  ProviderProgress,
  ProviderProgressCallback,
  ProviderRemoveOptions,
  ProviderRemoveResult,
} from "./types.js";

/** Emit a progress event. */
function progress(
  cb: ProviderProgressCallback | undefined,
  step: ProviderProgress["step"],
  status: ProviderProgress["status"],
  message: string,
): void {
  if (cb) cb({ step, status, message });
}

/**
 * Lightweight fetch with timeout. Never throws.
 */
async function probeFetch(
  url: string,
  init: RequestInit,
  timeoutMs = 10_000,
): Promise<{ response: Response } | { error: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    return { response };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { error: "Request timed out" };
    }
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Validation ─────────────────────────────────────────────────────────────

async function validateProvider(
  name: string,
  env: Record<string, string>,
): Promise<{ ok: boolean; message: string }> {
  const def = getProviderDef(name);
  if (!def) return { ok: false, message: `Unknown provider "${name}"` };

  if (name === "ollama") {
    const host = env["OLLAMA_HOST"] ?? def.baseUrl;
    const result = await probeFetch(`${host}/api/tags`, { method: "GET" }, 5_000);
    if ("error" in result) return { ok: false, message: `Ollama unreachable at ${host}` };
    if (result.response.status === 200) return { ok: true, message: `Connected to Ollama at ${host}` };
    return { ok: false, message: `Ollama status ${result.response.status}` };
  }

  if (name === "anthropic") {
    const key = env["ANTHROPIC_API_KEY"];
    if (!key) return { ok: false, message: "ANTHROPIC_API_KEY not set" };
    const result = await probeFetch(`${def.baseUrl}/v1/models`, {
      method: "GET",
      headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_API_VERSION },
    });
    if ("error" in result) return { ok: false, message: `API unreachable: ${result.error}` };
    if (result.response.status === 200) return { ok: true, message: "Connected to Anthropic" };
    if (result.response.status === 401) return { ok: false, message: "API key rejected (401)" };
    return { ok: false, message: `Status ${result.response.status}` };
  }

  if (name === "openai") {
    const key = env["OPENAI_API_KEY"];
    if (!key) return { ok: false, message: "OPENAI_API_KEY not set" };
    const result = await probeFetch(`${def.baseUrl}/v1/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
    });
    if ("error" in result) return { ok: false, message: `API unreachable: ${result.error}` };
    if (result.response.status === 200) return { ok: true, message: "Connected to OpenAI" };
    if (result.response.status === 401) return { ok: false, message: "API key rejected (401)" };
    return { ok: false, message: `Status ${result.response.status}` };
  }

  return { ok: true, message: "Provider configured" };
}

// ── Add Provider ───────────────────────────────────────────────────────────

export async function addProvider(
  options: ProviderAddOptions,
): Promise<ProviderAddResult> {
  const { deployDir, name, apiKey, model, routeCategories, skipValidation, onProgress } = options;

  const def = getProviderDef(name);
  if (!def) {
    return { success: false, providerName: name, validated: false, error: `Unknown provider "${name}"` };
  }

  const manifest = loadProviderManifest(deployDir);
  const existing = manifest.providers.find((p) => p.name === name);
  if (existing) {
    return {
      success: false,
      providerName: name,
      validated: false,
      error: `Provider "${name}" is already configured. Remove it first to reconfigure.`,
    };
  }

  // Create rollback snapshot before making changes
  await createCapabilitySnapshot(deployDir, "providers", `pre-add: ${name}`);

  // Store API key
  if (def.requiresApiKey && def.envKey) {
    if (!apiKey) {
      return { success: false, providerName: name, validated: false, error: `API key required for ${def.label}` };
    }
    progress(onProgress, "credentials", "running", `Storing API key for ${def.label}`);
    const envPath = join(deployDir, "engine", ".env");
    writeEnvValue(envPath, def.envKey, apiKey);
    progress(onProgress, "credentials", "done", "API key stored");
  } else {
    progress(onProgress, "credentials", "skipped", `${def.label} does not require an API key`);
  }

  // Validate
  let validated = false;
  if (!skipValidation) {
    progress(onProgress, "validate", "running", `Validating ${def.label} connection`);
    const envPath = join(deployDir, "engine", ".env");
    const env = getAllEnvValues(readEnv(envPath));
    const result = await validateProvider(name, env);
    validated = result.ok;
    if (result.ok) {
      progress(onProgress, "validate", "done", result.message);
    } else {
      progress(onProgress, "validate", "failed", result.message);
    }
  } else {
    progress(onProgress, "validate", "skipped", "Validation skipped");
  }

  // Update manifest
  progress(onProgress, "manifest", "running", "Updating provider manifest");
  const entry = {
    name,
    validated,
    routeCategories: routeCategories ? [...routeCategories] : [],
    addedAt: new Date().toISOString(),
    lastValidatedAt: validated ? new Date().toISOString() : undefined,
    model: model ?? def.defaultModel,
  };
  const updated = upsertProvider(manifest, entry);
  saveProviderManifest(deployDir, updated);
  progress(onProgress, "manifest", "done", "Manifest updated");

  return { success: true, providerName: name, validated };
}

// ── Remove Provider ────────────────────────────────────────────────────────

export async function removeProviderCmd(
  options: ProviderRemoveOptions,
): Promise<ProviderRemoveResult> {
  const { deployDir, name, keepCredentials } = options;
  const manifest = loadProviderManifest(deployDir);
  const entry = manifest.providers.find((p) => p.name === name);

  if (!entry) {
    return { success: false, providerName: name, error: `Provider "${name}" is not configured.` };
  }

  // Create rollback snapshot before making changes
  await createCapabilitySnapshot(deployDir, "providers", `pre-remove: ${name}`);

  // Remove env key
  if (!keepCredentials) {
    const def = getProviderDef(name);
    if (def?.envKey) {
      const envPath = join(deployDir, "engine", ".env");
      deleteEnvValue(envPath, def.envKey);
    }
  }

  const updated = removeProvider(manifest, name);
  saveProviderManifest(deployDir, updated);

  return { success: true, providerName: name };
}

// ── List Providers ─────────────────────────────────────────────────────────

export function listProviders(
  options: ProviderListOptions,
): ProviderListResult {
  const manifest = loadProviderManifest(options.deployDir);
  return {
    providers: manifest.providers,
    total: manifest.providers.length,
  };
}
