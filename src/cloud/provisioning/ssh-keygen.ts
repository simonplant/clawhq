/**
 * SSH keypair generation for provisioned instances.
 *
 * Generates Ed25519 keypairs using node:crypto, stores the private key at
 * ~/.clawhq/keys/<agent-id>.pem (mode 0600), and returns the public key
 * in OpenSSH format for cloud-init injection into authorized_keys.
 */

import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { FILE_MODE_SECRET } from "../../config/defaults.js";

// ── Constants ────────────────────────────────────────────────────────────────

const KEYS_DIR = "keys";

// ── Public API ───────────────────────────────────────────────────────────────

export interface GeneratedKeypair {
  /** Absolute path to the private key file (mode 0600). */
  readonly privateKeyPath: string;
  /** Public key in OpenSSH format (e.g. "ssh-ed25519 AAAA..."). */
  readonly publicKey: string;
}

/**
 * Generate an Ed25519 SSH keypair for a provisioned instance.
 *
 * - Private key written to `<deployDir>/keys/<instanceId>.pem` with mode 0600.
 * - Public key returned in OpenSSH format for cloud-init authorized_keys injection.
 */
export function generateSshKeypair(deployDir: string, instanceId: string): GeneratedKeypair {
  const keysDir = join(deployDir, KEYS_DIR);
  if (!existsSync(keysDir)) {
    mkdirSync(keysDir, { recursive: true });
  }

  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  // Write private key with mode 0600
  const privateKeyPath = join(keysDir, `${instanceId}.pem`);
  writeFileSync(privateKeyPath, privateKey, { mode: FILE_MODE_SECRET });
  chmodSync(privateKeyPath, FILE_MODE_SECRET);

  // Convert PEM public key to OpenSSH format
  const opensshPublicKey = pemToOpenSsh(publicKey);

  return { privateKeyPath, publicKey: opensshPublicKey };
}

/**
 * Resolve the expected private key path for an instance (without generating).
 */
export function sshKeyPath(deployDir: string, instanceId: string): string {
  return join(deployDir, KEYS_DIR, `${instanceId}.pem`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a PEM-encoded Ed25519 public key to OpenSSH format.
 *
 * Ed25519 SPKI structure: 12-byte header (algorithm OID) + 32-byte key.
 * OpenSSH format: "ssh-ed25519" + base64(length-prefixed type + length-prefixed key).
 */
function pemToOpenSsh(pem: string): string {
  // Strip PEM headers and decode base64
  const base64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s/g, "");
  const der = Buffer.from(base64, "base64");

  // Ed25519 SPKI is 44 bytes: 12-byte header + 32-byte raw key
  const rawKey = der.subarray(12, 44);

  // Build OpenSSH wire format: uint32 len + "ssh-ed25519" + uint32 len + raw key
  const typeStr = "ssh-ed25519";
  const typeBytes = Buffer.from(typeStr);
  const buf = Buffer.alloc(4 + typeBytes.length + 4 + rawKey.length);
  buf.writeUInt32BE(typeBytes.length, 0);
  typeBytes.copy(buf, 4);
  buf.writeUInt32BE(rawKey.length, 4 + typeBytes.length);
  rawKey.copy(buf, 4 + typeBytes.length + 4);

  return `ssh-ed25519 ${buf.toString("base64")}`;
}
