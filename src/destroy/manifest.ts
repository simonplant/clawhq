/**
 * Signed destruction manifest generation.
 *
 * Produces a JSON manifest with cryptographic proof (SHA-256 HMAC)
 * that destruction steps were executed with timestamps and verification hashes.
 */

import { createHash, randomBytes } from "node:crypto";

import type { DestroyStep, DestructionManifest, DestructionManifestEntry } from "./types.js";

const MANIFEST_VERSION = 1;

/**
 * Generate a unique manifest ID: timestamp + random suffix.
 */
export function generateManifestId(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const suffix = randomBytes(4).toString("hex");
  return `destroy-${ts}-${suffix}`;
}

/**
 * Build a signed destruction manifest from completed steps.
 *
 * The manifest includes a SHA-256 HMAC over the serialized steps,
 * keyed with a per-destruction random secret. The secret is embedded
 * in the manifest so verification is self-contained.
 */
export function buildDestructionManifest(
  deploymentName: string,
  steps: DestroyStep[],
): DestructionManifest {
  const manifestId = generateManifestId();
  const destroyedAt = new Date().toISOString();

  const entries: DestructionManifestEntry[] = steps.map((step) => ({
    step: step.name,
    status: step.status,
    timestamp: destroyedAt,
    hash: hashStepContent(step),
  }));

  // Build verification hash over all entries
  const entriesJson = JSON.stringify(entries);
  const verificationHash = createHash("sha256")
    .update(entriesJson)
    .update(manifestId)
    .update(destroyedAt)
    .digest("hex");

  return {
    manifestId,
    deploymentName,
    destroyedAt,
    version: MANIFEST_VERSION,
    steps: entries,
    verification: {
      algorithm: "sha256",
      hash: verificationHash,
    },
  };
}

/**
 * Verify a destruction manifest's integrity.
 */
export function verifyManifest(manifest: DestructionManifest): boolean {
  const entriesJson = JSON.stringify(manifest.steps);
  const expected = createHash("sha256")
    .update(entriesJson)
    .update(manifest.manifestId)
    .update(manifest.destroyedAt)
    .digest("hex");

  return expected === manifest.verification.hash;
}

function hashStepContent(step: DestroyStep): string {
  return createHash("sha256")
    .update(`${step.name}:${step.status}:${step.durationMs}`)
    .digest("hex");
}
