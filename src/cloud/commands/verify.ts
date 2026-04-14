/**
 * Command signature and freshness verification.
 *
 * Every command from the cloud is signed with Ed25519. The agent verifies
 * against a pinned public key before executing. Tampered commands are rejected.
 * Commands are also validated for freshness — stale commands beyond a
 * configurable max age are rejected to prevent replay attacks.
 */

import { createVerify } from "node:crypto";

import { CLOUD_COMMAND_MAX_AGE_MS } from "../../config/defaults.js";
import type { SignedCommand, VerifyResult } from "../types.js";

// ── Options ─────────────────────────────────────────────────────────────────

/** Options for command verification. */
export interface VerifyCommandOptions {
  /** Maximum command age in milliseconds. Defaults to CLOUD_COMMAND_MAX_AGE_MS (5 min). */
  readonly maxAgeMs?: number;
  /** Current time override for testing. Defaults to Date.now(). */
  readonly now?: number;
}

// ── Signature format ─────────────────────────────────────────────────────────

/**
 * Build the canonical message that was signed.
 *
 * Format: `id + type + createdAt + JSON(payload)`
 * This ensures the signature covers all command fields.
 */
export function buildSignatureMessage(command: SignedCommand): string {
  const payloadStr = command.payload
    ? JSON.stringify(command.payload, Object.keys(command.payload).sort())
    : "";
  return `${command.id}${command.type}${command.createdAt}${payloadStr}`;
}

// ── Verification ─────────────────────────────────────────────────────────────

/**
 * Verify a command's Ed25519 signature and freshness against a pinned public key.
 *
 * Returns { valid: true } if the signature is valid and the command is fresh,
 * or { valid: false, reason } if verification fails.
 *
 * Freshness check: rejects commands whose createdAt timestamp is older than
 * maxAgeMs (default 5 minutes) to prevent replay attacks.
 */
export function verifyCommandSignature(
  command: SignedCommand,
  publicKeyPem: string,
  options?: VerifyCommandOptions,
): VerifyResult {
  if (!command.signature) {
    return { valid: false, reason: "Missing signature" };
  }

  if (!command.id || !command.type || !command.createdAt) {
    return { valid: false, reason: "Incomplete command fields" };
  }

  // ── Freshness check ────────────────────────────────────────────────────
  const maxAgeMs = options?.maxAgeMs ?? CLOUD_COMMAND_MAX_AGE_MS;
  const now = options?.now ?? Date.now();
  const createdAtMs = Date.parse(command.createdAt);

  if (Number.isNaN(createdAtMs)) {
    return { valid: false, reason: "Invalid createdAt timestamp" };
  }

  const ageMs = now - createdAtMs;
  if (ageMs > maxAgeMs) {
    return {
      valid: false,
      reason: `Command expired: age ${Math.round(ageMs / 1_000)}s exceeds max ${Math.round(maxAgeMs / 1_000)}s`,
    };
  }

  if (createdAtMs > now + 30_000) {
    // Allow up to 30s clock skew into the future, reject beyond that
    return {
      valid: false,
      reason: `Command timestamp is in the future (clock skew > 30s)`,
    };
  }

  // ── Signature check ────────────────────────────────────────────────────
  try {
    const message = buildSignatureMessage(command);
    const verify = createVerify("SHA256");
    verify.update(message);
    verify.end();

    const signatureBuffer = Buffer.from(command.signature, "base64");
    const valid = verify.verify(publicKeyPem, signatureBuffer);

    if (!valid) {
      return { valid: false, reason: "Signature verification failed — command may be tampered" };
    }

    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      reason: `Signature verification error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
