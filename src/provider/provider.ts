/**
 * Core provider operations.
 *
 * Manages API provider lifecycle: add, list, remove, test.
 * Credentials are stored in .env via the secrets module.
 * Firewall allowlists are updated via the firewall module.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CredStatus } from "../security/credentials/types.js";
import {
  getEnvValue,
  readEnvFile,
  removeEnvValue,
  setEnvValue,
  writeEnvFile,
} from "../security/secrets/env.js";
import type { EnvFile } from "../security/secrets/env.js";
import { enforceEnvPermissions } from "../security/secrets/permissions.js";

import { findProvider, KNOWN_PROVIDERS } from "./registry.js";
import type {
  AddProviderResult,
  ProviderConfig,
  ProviderRegistry,
  ProviderStatus,
  RemoveProviderResult,
  TestProviderResult,
} from "./types.js";
import { ProviderError } from "./types.js";

const REGISTRY_FILENAME = "providers.json";
const TIMEOUT_MS = 10_000;

// --- Registry persistence ---

/**
 * Read the provider registry from disk.
 * Returns an empty registry if the file doesn't exist.
 */
export async function loadRegistry(homeDir: string): Promise<ProviderRegistry> {
  const registryPath = join(homeDir, REGISTRY_FILENAME);
  try {
    const content = await readFile(registryPath, "utf-8");
    return JSON.parse(content) as ProviderRegistry;
  } catch {
    return { providers: [] };
  }
}

/**
 * Write the provider registry to disk.
 */
export async function saveRegistry(
  homeDir: string,
  registry: ProviderRegistry,
): Promise<void> {
  const registryPath = join(homeDir, REGISTRY_FILENAME);
  await writeFile(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf-8");
}

// --- Credential validation ---

/**
 * Validate an API key format against the provider's expected pattern.
 * Returns null if valid, or an error message if invalid.
 */
export function validateKeyFormat(
  providerId: string,
  apiKey: string,
): string | null {
  const def = findProvider(providerId);
  if (!def) return null; // unknown provider, skip format check
  if (!def.keyPattern) return null; // no pattern defined

  const re = new RegExp(def.keyPattern);
  if (!re.test(apiKey)) {
    return `API key does not match expected format for ${def.label} (expected pattern: ${def.keyPattern})`;
  }
  return null;
}

// --- Core operations ---

/**
 * Add a provider: validate key format, store credential in .env,
 * register the provider, and return domains to add to firewall.
 */
export async function addProvider(
  homeDir: string,
  providerId: string,
  apiKey: string,
): Promise<AddProviderResult> {
  const def = findProvider(providerId);
  if (!def) {
    throw new ProviderError(
      `Unknown provider "${providerId}". Known providers: ${KNOWN_PROVIDERS.map((p) => p.id).join(", ")}`,
    );
  }

  // Validate key format
  const formatError = validateKeyFormat(providerId, apiKey);
  if (formatError) {
    throw new ProviderError(formatError);
  }

  // Load or create .env
  const envPath = join(homeDir, ".env");
  let env: EnvFile;
  try {
    env = await readEnvFile(envPath);
  } catch {
    env = { entries: [] };
  }

  // Store credential
  setEnvValue(env, def.envVar, apiKey);
  await writeEnvFile(envPath, env);
  await enforceEnvPermissions(envPath);

  // Register provider
  const registry = await loadRegistry(homeDir);
  const existing = registry.providers.findIndex((p) => p.id === providerId);

  const config: ProviderConfig = {
    id: def.id,
    label: def.label,
    category: def.category,
    envVar: def.envVar,
    domains: def.domains,
    status: "active",
    addedAt: new Date().toISOString(),
  };

  if (existing >= 0) {
    // Update existing entry, preserve addedAt
    config.addedAt = registry.providers[existing].addedAt;
    registry.providers[existing] = config;
  } else {
    registry.providers.push(config);
  }

  await saveRegistry(homeDir, registry);

  return {
    provider: config,
    credentialStored: true,
    domainsAdded: def.domains,
  };
}

/**
 * List all configured providers with their current status.
 */
export async function listProviders(
  homeDir: string,
): Promise<ProviderConfig[]> {
  const registry = await loadRegistry(homeDir);

  // Check credential presence for status
  const envPath = join(homeDir, ".env");
  let env: EnvFile;
  try {
    env = await readEnvFile(envPath);
  } catch {
    // No .env file — all providers are missing credentials
    return registry.providers.map((p) => ({
      ...p,
      status: "no-credential" as ProviderStatus,
    }));
  }

  return registry.providers.map((p) => {
    const value = getEnvValue(env, p.envVar);
    const status: ProviderStatus = value ? "active" : "no-credential";
    return { ...p, status };
  });
}

/**
 * Remove a provider: remove credential from .env, remove from registry,
 * and return domains to remove from firewall allowlist.
 */
export async function removeProvider(
  homeDir: string,
  providerId: string,
): Promise<RemoveProviderResult> {
  const registry = await loadRegistry(homeDir);
  const idx = registry.providers.findIndex((p) => p.id === providerId);

  if (idx < 0) {
    throw new ProviderError(
      `Provider "${providerId}" is not configured. Use "clawhq provider list" to see configured providers.`,
    );
  }

  const provider = registry.providers[idx];

  // Remove credential from .env
  const envPath = join(homeDir, ".env");
  let credentialRemoved = false;
  try {
    const env = await readEnvFile(envPath);
    credentialRemoved = removeEnvValue(env, provider.envVar);
    if (credentialRemoved) {
      await writeEnvFile(envPath, env);
    }
  } catch {
    // .env doesn't exist — nothing to remove
  }

  // Remove from registry
  registry.providers.splice(idx, 1);
  await saveRegistry(homeDir, registry);

  return {
    id: providerId,
    credentialRemoved,
    domainsRemoved: provider.domains,
  };
}

/**
 * Test a provider's API connectivity end-to-end.
 *
 * Sends a lightweight request to the provider's test endpoint
 * to verify credentials and network connectivity.
 */
export async function testProvider(
  homeDir: string,
  providerId: string,
): Promise<TestProviderResult> {
  const def = findProvider(providerId);
  if (!def) {
    throw new ProviderError(
      `Unknown provider "${providerId}". Known providers: ${KNOWN_PROVIDERS.map((p) => p.id).join(", ")}`,
    );
  }

  if (!def.testUrl) {
    return {
      id: def.id,
      label: def.label,
      status: "error",
      message: "No test endpoint defined for this provider",
      latencyMs: 0,
    };
  }

  // Read credential
  const envPath = join(homeDir, ".env");
  let apiKey: string | undefined;
  try {
    const env = await readEnvFile(envPath);
    apiKey = getEnvValue(env, def.envVar);
  } catch {
    // .env doesn't exist
  }

  if (!apiKey && def.category !== "local") {
    return {
      id: def.id,
      label: def.label,
      status: "missing",
      message: `${def.envVar} not configured`,
      latencyMs: 0,
    };
  }

  const start = Date.now();
  try {
    const result = await runProviderTest(def, apiKey);
    return {
      ...result,
      latencyMs: Date.now() - start,
    };
  } catch (err: unknown) {
    return {
      id: def.id,
      label: def.label,
      status: "error",
      message: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Run the actual HTTP test for a provider.
 */
async function runProviderTest(
  def: import("./types.js").ProviderDefinition,
  apiKey: string | undefined,
): Promise<Omit<TestProviderResult, "latencyMs">> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      ...(def.testHeaders ?? {}),
    };

    // Set auth header based on provider
    if (apiKey) {
      if (def.id === "anthropic") {
        headers["x-api-key"] = apiKey;
      } else if (def.id === "google") {
        // Google uses query param, handled in URL
      } else {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
    }

    let url = def.testUrl ?? "";
    if (def.id === "google" && apiKey) {
      url += `?key=${apiKey}`;
    }

    // Build request body for POST endpoints
    let body: string | undefined;
    if (def.testMethod === "POST") {
      if (def.id === "anthropic") {
        body = JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        });
      } else if (def.id === "tavily") {
        body = JSON.stringify({
          api_key: apiKey,
          query: "test",
          max_results: 1,
        });
      }
    }

    const response = await fetch(url, {
      method: def.testMethod ?? "GET",
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);

    return interpretResponse(def, response.status);
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      return {
        id: def.id,
        label: def.label,
        status: "error",
        message: "Request timed out after 10s",
      };
    }
    return {
      id: def.id,
      label: def.label,
      status: "error",
      message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Interpret HTTP response status into a CredStatus.
 */
function interpretResponse(
  def: import("./types.js").ProviderDefinition,
  status: number,
): Omit<TestProviderResult, "latencyMs"> {
  // 200 or 400 (auth passed, bad request body) = valid key
  if (status === 200 || status === 400) {
    return {
      id: def.id,
      label: def.label,
      status: "valid",
      message: "API key is valid — connectivity OK",
    };
  }

  if (status === 401) {
    return {
      id: def.id,
      label: def.label,
      status: "failing",
      message: "API key is invalid or revoked",
    };
  }

  if (status === 403) {
    return {
      id: def.id,
      label: def.label,
      status: "expired",
      message: "API key lacks permissions or account is suspended",
    };
  }

  // 429 means the key is valid but rate limited
  if (status === 429) {
    return {
      id: def.id,
      label: def.label,
      status: "valid",
      message: "API key is valid (rate limited)",
    };
  }

  return {
    id: def.id,
    label: def.label,
    status: "error",
    message: `Unexpected HTTP status: ${status}`,
  };
}

// --- Formatting ---

/**
 * Format a provider list as a human-readable table.
 */
export function formatProviderTable(providers: ProviderConfig[]): string {
  if (providers.length === 0) {
    return "No providers configured. Use \"clawhq provider add <id>\" to add one.";
  }

  const idWidth = Math.max(2, ...providers.map((p) => p.id.length));
  const labelWidth = Math.max(5, ...providers.map((p) => p.label.length));
  const catWidth = Math.max(8, ...providers.map((p) => p.category.length));
  const statusWidth = 13;

  const lines: string[] = [];

  lines.push(
    `${"ID".padEnd(idWidth)}  ${"LABEL".padEnd(labelWidth)}  ${"CATEGORY".padEnd(catWidth)}  ${"STATUS".padEnd(statusWidth)}  DOMAINS`,
  );
  lines.push("-".repeat(idWidth + labelWidth + catWidth + statusWidth + 20));

  const STATUS_LABELS: Record<ProviderStatus, string> = {
    active: "ACTIVE",
    "no-credential": "NO CREDENTIAL",
    failing: "FAILING",
    unknown: "UNKNOWN",
  };

  for (const p of providers) {
    const label = STATUS_LABELS[p.status] ?? "UNKNOWN";
    const domains = p.domains.length > 0 ? p.domains.join(", ") : "(local)";
    lines.push(
      `${p.id.padEnd(idWidth)}  ${p.label.padEnd(labelWidth)}  ${p.category.padEnd(catWidth)}  ${label.padEnd(statusWidth)}  ${domains}`,
    );
  }

  lines.push("");
  lines.push(`${providers.length} provider${providers.length === 1 ? "" : "s"} configured`);

  return lines.join("\n");
}

/**
 * Format a test result as a human-readable line.
 */
export function formatTestResult(result: TestProviderResult): string {
  const STATUS_LABELS: Record<CredStatus, string> = {
    valid: "PASS",
    expired: "EXPRD",
    failing: "FAIL",
    error: "ERROR",
    missing: "SKIP",
  };

  const label = STATUS_LABELS[result.status] ?? "?";
  const latency = result.latencyMs > 0 ? ` (${result.latencyMs}ms)` : "";
  return `${label}  ${result.label}: ${result.message}${latency}`;
}

/**
 * Get all domains from currently configured providers.
 * Useful for firewall allowlist derivation.
 */
export async function getConfiguredDomains(
  homeDir: string,
): Promise<string[]> {
  const registry = await loadRegistry(homeDir);
  const domains = new Set<string>();
  for (const p of registry.providers) {
    for (const d of p.domains) {
      domains.add(d);
    }
  }
  return [...domains];
}
