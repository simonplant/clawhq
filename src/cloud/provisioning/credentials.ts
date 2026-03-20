/**
 * Cloud provider credential store — ~/.clawhq/cloud/credentials.json (mode 0600).
 *
 * Stores API tokens for cloud providers (DigitalOcean, AWS, GCP).
 * Separate from integration credentials in engine/credentials.json.
 * Atomic writes with 0600 permissions.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { FILE_MODE_SECRET } from "../../config/defaults.js";

import type { CloudCredentials, CloudProvider, ProviderCredential, TokenValidationResult } from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const CREDENTIALS_FILE = "credentials.json";

// ── Path ────────────────────────────────────────────────────────────────────

/** Resolve cloud credentials.json path for a deployment directory. */
export function cloudCredentialsPath(deployDir: string): string {
  return join(deployDir, "cloud", CREDENTIALS_FILE);
}

// ── Read ────────────────────────────────────────────────────────────────────

/** Read cloud credentials. Returns empty store if file doesn't exist. */
export function readCloudCredentials(deployDir: string): CloudCredentials {
  const path = cloudCredentialsPath(deployDir);
  if (!existsSync(path)) {
    return { version: 1, providers: {} };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as CloudCredentials;
  } catch (err) {
    console.warn("[provisioning] Failed to read cloud credentials:", err);
    return { version: 1, providers: {} };
  }
}

// ── Write ───────────────────────────────────────────────────────────────────

/** Write cloud credentials atomically with mode 0600. */
function writeCloudCredentials(deployDir: string, creds: CloudCredentials): void {
  const path = cloudCredentialsPath(deployDir);
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(creds, null, 2) + "\n";
  const tmpName = `.credentials.tmp.${randomBytes(6).toString("hex")}`;
  const tmpPath = join(dir, tmpName);

  try {
    writeFileSync(tmpPath, content, { mode: FILE_MODE_SECRET });
    // Ensure mode is applied even if umask overrides
    chmodSync(tmpPath, FILE_MODE_SECRET);
    renameSync(tmpPath, path);
  } catch (err) {
    throw new Error(
      `[provisioning] Failed to write cloud credentials: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

// ── Operations ──────────────────────────────────────────────────────────────

/** Get the credential for a provider. Returns undefined if not set. */
export function getProviderCredential(
  deployDir: string,
  provider: CloudProvider,
): ProviderCredential | undefined {
  const creds = readCloudCredentials(deployDir);
  return creds.providers[provider];
}

/** Store a credential for a provider. */
export function setProviderCredential(
  deployDir: string,
  provider: CloudProvider,
  token: string,
): void {
  const creds = readCloudCredentials(deployDir);
  const updated: CloudCredentials = {
    version: 1,
    providers: {
      ...creds.providers,
      [provider]: {
        token,
        storedAt: new Date().toISOString(),
      },
    },
  };
  writeCloudCredentials(deployDir, updated);
}

/**
 * Validate a provider token before storing it.
 * Resolves the adapter and calls validateToken() against the provider API.
 */
export async function validateProviderToken(
  provider: CloudProvider,
  token: string,
  signal?: AbortSignal,
): Promise<TokenValidationResult> {
  // Lazy import to avoid circular dependency
  const { createDigitalOceanAdapter } = await import("./providers/digitalocean.js");

  switch (provider) {
    case "digitalocean": {
      const adapter = createDigitalOceanAdapter(token);
      return adapter.validateToken(signal);
    }
    case "aws":
      return { valid: false, error: "AWS provider is not yet implemented." };
    case "gcp":
      return { valid: false, error: "GCP provider is not yet implemented." };
    default:
      return { valid: false, error: `Unknown provider: ${provider}` };
  }
}

/**
 * Validate and store a provider credential.
 * Validates the token against the provider API first, then stores it.
 */
export async function setProviderCredentialWithValidation(
  deployDir: string,
  provider: CloudProvider,
  token: string,
  signal?: AbortSignal,
): Promise<TokenValidationResult> {
  const validation = await validateProviderToken(provider, token, signal);
  if (!validation.valid) {
    return validation;
  }
  setProviderCredential(deployDir, provider, token);
  return validation;
}

/** Remove a credential for a provider. Returns true if it existed. */
export function removeProviderCredential(
  deployDir: string,
  provider: CloudProvider,
): boolean {
  const creds = readCloudCredentials(deployDir);
  if (!creds.providers[provider]) {
    return false;
  }
  const providers: Partial<Record<CloudProvider, ProviderCredential>> = {};
  for (const [key, val] of Object.entries(creds.providers)) {
    if (key !== provider) {
      providers[key as CloudProvider] = val;
    }
  }
  writeCloudCredentials(deployDir, { version: 1, providers });
  return true;
}
