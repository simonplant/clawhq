/**
 * Command signature verification.
 *
 * Every command from the cloud is signed with Ed25519. The agent verifies
 * against a pinned public key before executing. Tampered commands are rejected.
 */

import { createVerify } from "node:crypto";

import type { SignedCommand, VerifyResult } from "../types.js";

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
 * Verify a command's Ed25519 signature against a pinned public key.
 *
 * Returns { valid: true } if the signature is valid, or { valid: false, reason }
 * if verification fails.
 */
export function verifyCommandSignature(
  command: SignedCommand,
  publicKeyPem: string,
): VerifyResult {
  if (!command.signature) {
    return { valid: false, reason: "Missing signature" };
  }

  if (!command.id || !command.type || !command.createdAt) {
    return { valid: false, reason: "Incomplete command fields" };
  }

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
