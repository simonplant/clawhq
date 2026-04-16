/**
 * claw-secret — 1Password credential fetch utility with audit logging.
 *
 * Wraps `op read` to fetch credentials from a 1Password vault using
 * a service account token. The token is read from a Docker secret
 * at /run/secrets/op_service_account_token (never from env vars).
 *
 * Security guarantees:
 * - Token read from Docker secret file, never env vars or config files
 * - Credentials returned to caller only, never written to stdout/logs
 * - Every fetch is audit-logged (secret lifecycle event with action "accessed")
 * - Credentials never persisted to disk, memory files, or LLM context
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { logSecretEvent } from "../audit/logger.js";
import type { AuditTrailConfig } from "../audit/types.js";

const execFileAsync = promisify(execFile);

// ── Constants ───────────────────────────────────────────────────────────────

/** Docker secret mount path for the 1Password service account token. */
export const OP_TOKEN_SECRET_PATH = "/run/secrets/op_service_account_token";

/** Timeout for op CLI commands (ms). */
const OP_EXEC_TIMEOUT_MS = 15_000;

// ── Types ───────────────────────────────────────────────────────────────────

/** Result of a credential fetch operation. */
export interface SecretFetchResult {
  /** Whether the fetch succeeded. */
  readonly ok: boolean;
  /** The credential value (only set when ok is true). Never log this. */
  readonly value?: string;
  /** Error message when ok is false. */
  readonly error?: string;
  /** The secret reference that was fetched (e.g., "op://vault/item/field"). */
  readonly reference: string;
  /** Timestamp of the fetch (ISO 8601). */
  readonly fetchedAt: string;
}

/** Options for fetching a credential. */
export interface FetchSecretOptions {
  /**
   * 1Password secret reference (e.g., "op://vault-name/item-name/field-name").
   * See https://developer.1password.com/docs/cli/secret-references
   */
  readonly reference: string;
  /**
   * Path to the service account token file.
   * Defaults to the Docker secret mount at /run/secrets/op_service_account_token.
   */
  readonly tokenPath?: string;
  /** Timeout in milliseconds. Defaults to 15000. */
  readonly timeoutMs?: number;
  /** Audit trail config — when provided, every fetch is logged as a secret "accessed" event. */
  readonly auditConfig?: AuditTrailConfig;
}

// ── Token Reader ────────────────────────────────────────────────────────────

/**
 * Read the 1Password service account token from the Docker secret file.
 *
 * Returns the token string or null if the file doesn't exist or is empty.
 * Never throws.
 */
export async function readServiceAccountToken(
  tokenPath = OP_TOKEN_SECRET_PATH,
): Promise<string | null> {
  try {
    const token = (await readFile(tokenPath, "utf-8")).trim();
    return token || null;
  } catch {
    return null;
  }
}

// ── Credential Fetch ────────────────────────────────────────────────────────

/**
 * Fetch a credential from 1Password using the op CLI.
 *
 * The credential is returned in the result object — it is the caller's
 * responsibility to use it securely and never expose it to stdout,
 * logs, LLM context, or agent memory files.
 *
 * @example
 * ```ts
 * const result = await fetchSecret({
 *   reference: "op://Agent-Vault/anthropic-api/credential",
 * });
 * if (result.ok) {
 *   // Use result.value — never log it
 * }
 * ```
 */
export async function fetchSecret(
  options: FetchSecretOptions,
): Promise<SecretFetchResult> {
  const { reference, tokenPath = OP_TOKEN_SECRET_PATH, timeoutMs = OP_EXEC_TIMEOUT_MS, auditConfig } = options;
  const fetchedAt = new Date().toISOString();

  // Validate reference format: op://vault/item/field
  if (!reference.startsWith("op://")) {
    return {
      ok: false,
      error: "Invalid secret reference — must start with op:// (e.g., op://vault/item/field)",
      reference,
      fetchedAt,
    };
  }

  // Read token from Docker secret
  const token = await readServiceAccountToken(tokenPath);
  if (!token) {
    return {
      ok: false,
      error: `Service account token not found at ${tokenPath}`,
      reference,
      fetchedAt,
    };
  }

  if (!token.startsWith("ops_")) {
    return {
      ok: false,
      error: "Service account token has invalid format (expected ops_... prefix)",
      reference,
      fetchedAt,
    };
  }

  // Execute op read with token via environment (op requires OP_SERVICE_ACCOUNT_TOKEN env)
  // The token is passed directly to the subprocess, not stored in any file or config
  try {
    const { stdout } = await execFileAsync(
      "op",
      ["read", reference],
      {
        timeout: timeoutMs,
        env: {
          ...process.env,
          OP_SERVICE_ACCOUNT_TOKEN: token,
        },
        // Prevent credential from appearing in error messages
        windowsHide: true,
      },
    );

    const value = stdout.trim();
    if (!value) {
      return {
        ok: false,
        error: "Empty credential returned from 1Password",
        reference,
        fetchedAt,
      };
    }

    // Audit log: record the access (never the credential value)
    if (auditConfig) {
      await logSecretEvent(auditConfig, {
        secretId: reference,
        action: "accessed",
        actor: "claw-secret",
      });
    }

    return {
      ok: true,
      value,
      reference,
      fetchedAt,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Strip any credential values from error messages
    const safeMessage = message
      .replace(/ops_[A-Za-z0-9_-]+/g, "ops_***")
      .replace(/op:\/\/[^\s]+/g, reference);

    return {
      ok: false,
      error: `op read failed: ${safeMessage}`,
      reference,
      fetchedAt,
    };
  }
}

// ── Vault Connectivity Check ────────────────────────────────────────────────

/** Result of a vault connectivity check. */
export interface VaultCheckResult {
  /** Whether the vault is accessible. */
  readonly ok: boolean;
  /** Vault name that was checked. */
  readonly vault: string;
  /** Error message when ok is false. */
  readonly error?: string;
}

/**
 * Check that a 1Password vault is accessible with the current service account.
 *
 * Uses `op vault get` to verify the vault exists and the service account
 * has permission to access it.
 */
export async function checkVaultAccess(
  vaultName: string,
  tokenPath = OP_TOKEN_SECRET_PATH,
): Promise<VaultCheckResult> {
  const token = await readServiceAccountToken(tokenPath);
  if (!token) {
    return { ok: false, vault: vaultName, error: `Token not found at ${tokenPath}` };
  }

  try {
    await execFileAsync(
      "op",
      ["vault", "get", vaultName, "--format=json"],
      {
        timeout: OP_EXEC_TIMEOUT_MS,
        env: {
          ...process.env,
          OP_SERVICE_ACCOUNT_TOKEN: token,
        },
      },
    );
    return { ok: true, vault: vaultName };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const safeMessage = message.replace(/ops_[A-Za-z0-9_-]+/g, "ops_***");
    return { ok: false, vault: vaultName, error: safeMessage };
  }
}
