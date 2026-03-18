/**
 * Cryptographic utilities for secret storage and export/import.
 *
 * Uses Node.js crypto with:
 * - AES-256-GCM for authenticated encryption
 * - scrypt for passphrase-based key derivation
 * - HMAC-SHA256 for integrity verification
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from "node:crypto";

/** scrypt parameters — N=2^14, r=8, p=1 per OWASP recommendations. */
const SCRYPT_KEYLEN = 32;
const SCRYPT_COST = 16384; // 2^14
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;

/** Derive a 256-bit key from a passphrase and salt using scrypt. */
export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, SCRYPT_KEYLEN, {
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELIZATION,
  }) as Buffer;
}

/** Encrypt plaintext with AES-256-GCM. Returns { ciphertext, iv, authTag } as Buffers. */
export function encryptAes256Gcm(
  plaintext: Buffer,
  key: Buffer,
): { ciphertext: Buffer; iv: Buffer; authTag: Buffer } {
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext: encrypted, iv, authTag };
}

/** Decrypt ciphertext with AES-256-GCM. Throws on auth failure. */
export function decryptAes256Gcm(
  ciphertext: Buffer,
  key: Buffer,
  iv: Buffer,
  authTag: Buffer,
): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Compute HMAC-SHA256 of data with a key. Returns hex string. */
export function hmacSha256(key: Buffer, data: Buffer): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

/** Generate a random salt for scrypt. */
export function generateSalt(): Buffer {
  return randomBytes(32);
}
