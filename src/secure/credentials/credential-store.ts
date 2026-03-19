/**
 * credentials.json store — atomic, 0600-permissioned JSON credential store.
 *
 * Integration credentials are stored separately from .env system secrets.
 * Each integration's credentials are keyed by name, enabling independent
 * rotation without touching other integrations.
 *
 * All writes are atomic (temp file + rename) and 0600-permissioned.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { CredentialEntry, CredentialStore } from "./credential-store-types.js";

// ── Constants ───────────────────────────────────────────────────────────────

/** File permission: owner read/write only. */
const MODE_0600 = 0o600;

/** Default file name within the engine directory. */
const CREDENTIALS_FILE = "credentials.json";

// ── Path helpers ────────────────────────────────────────────────────────────

/** Resolve the credentials.json path for a deployment directory. */
export function credentialsPath(deployDir: string): string {
  return join(deployDir, "engine", CREDENTIALS_FILE);
}

// ── Read ────────────────────────────────────────────────────────────────────

/**
 * Read and parse the credential store from disk.
 *
 * Returns an empty store if the file doesn't exist.
 * Throws if the file exists but can't be read or parsed.
 */
export function readCredentialStore(deployDir: string): CredentialStore {
  const path = credentialsPath(deployDir);
  if (!existsSync(path)) {
    return { version: 1, credentials: [] };
  }
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as CredentialStore;
}

// ── Write ───────────────────────────────────────────────────────────────────

/**
 * Write the credential store to disk atomically with 0600 permissions.
 *
 * Uses temp file + rename for atomic writes — no partial files.
 */
export function writeCredentialStore(deployDir: string, store: CredentialStore): void {
  const path = credentialsPath(deployDir);
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(store, null, 2) + "\n";
  const tmpName = `.credentials.tmp.${randomBytes(6).toString("hex")}`;
  const tmpPath = join(dir, tmpName);

  writeFileSync(tmpPath, content, { mode: MODE_0600 });
  chmodSync(tmpPath, MODE_0600);
  renameSync(tmpPath, path);
}

// ── Operations ──────────────────────────────────────────────────────────────

/**
 * Get credentials for an integration.
 *
 * Returns undefined if the integration has no stored credentials.
 */
export function getCredentials(
  store: CredentialStore,
  integration: string,
): CredentialEntry | undefined {
  return store.credentials.find((c) => c.integration === integration);
}

/**
 * Set credentials for an integration.
 *
 * If credentials exist for this integration, they are replaced (rotated).
 * Returns a new CredentialStore — the original is not mutated.
 */
export function setCredentials(
  store: CredentialStore,
  integration: string,
  values: Record<string, string>,
): CredentialStore {
  const existing = store.credentials.find((c) => c.integration === integration);
  const now = new Date().toISOString();

  const entry: CredentialEntry = {
    integration,
    values,
    storedAt: existing?.storedAt ?? now,
    rotatedAt: existing ? now : undefined,
  };

  const filtered = store.credentials.filter((c) => c.integration !== integration);
  return { version: 1, credentials: [...filtered, entry] };
}

/**
 * Remove credentials for an integration.
 *
 * Returns a new CredentialStore — the original is not mutated.
 */
export function removeCredentials(
  store: CredentialStore,
  integration: string,
): CredentialStore {
  return {
    version: 1,
    credentials: store.credentials.filter((c) => c.integration !== integration),
  };
}

/**
 * Verify that credentials.json has 0600 permissions.
 *
 * Returns true if the file exists and has mode 0600, false otherwise.
 */
export function verifyCredentialPermissions(deployDir: string): boolean {
  const path = credentialsPath(deployDir);
  if (!existsSync(path)) return false;
  const stat = statSync(path);
  return (stat.mode & 0o777) === MODE_0600;
}

// ── High-level convenience ──────────────────────────────────────────────────

/**
 * Store integration credentials on disk (atomic, 0600).
 *
 * Convenience wrapper: readCredentialStore + setCredentials + writeCredentialStore.
 */
export function storeIntegrationCredentials(
  deployDir: string,
  integration: string,
  values: Record<string, string>,
): void {
  const store = readCredentialStore(deployDir);
  const updated = setCredentials(store, integration, values);
  writeCredentialStore(deployDir, updated);
}

/**
 * Delete integration credentials from disk (atomic, 0600).
 *
 * Convenience wrapper: readCredentialStore + removeCredentials + writeCredentialStore.
 */
export function deleteIntegrationCredentials(
  deployDir: string,
  integration: string,
): void {
  const store = readCredentialStore(deployDir);
  const updated = removeCredentials(store, integration);
  writeCredentialStore(deployDir, updated);
}
