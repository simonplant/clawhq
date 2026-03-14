/**
 * SecretStore interface — abstracts secret storage backends.
 *
 * Plaintext .env and encrypted .env.enc backends are interchangeable
 * through this interface. Supports get/set/delete/list plus
 * export/import for portable encrypted archives.
 */

import type { SecretEntry } from "./types.js";

/** Portable encrypted archive format. */
export interface SecretArchive {
  /** Format version */
  version: 1;
  /** Archive creation timestamp (ISO 8601) */
  createdAt: string;
  /** Encrypted payload (base64) */
  ciphertext: string;
  /** AES-256-GCM initialization vector (base64) */
  iv: string;
  /** AES-256-GCM auth tag (base64) */
  authTag: string;
  /** scrypt salt for key derivation (base64) */
  salt: string;
  /** HMAC-SHA256 of plaintext payload for integrity verification (hex) */
  integrityHmac: string;
  /** Number of secrets in the archive */
  secretCount: number;
}

/** Data included in an exported archive (plaintext, before encryption). */
export interface ArchivePayload {
  /** All secret key-value pairs */
  secrets: Record<string, string>;
  /** Metadata per secret */
  metadata: Record<string, { created_at: string; rotated_at: string | null; provider_category: string }>;
  /** Audit trail events */
  auditTrail: unknown[];
  /** Export timestamp */
  exportedAt: string;
}

/**
 * SecretStore interface — storage-agnostic secret management.
 *
 * Both PlaintextEnvStore and EncryptedStore implement this interface,
 * making them interchangeable backends for the secrets CLI.
 */
export interface SecretStore {
  /** Get a secret value by name. Returns undefined if not found. */
  get(name: string): Promise<string | undefined>;
  /** Set a secret value (creates or updates). */
  set(name: string, value: string): Promise<void>;
  /** Delete a secret by name. Returns true if it existed. */
  delete(name: string): Promise<boolean>;
  /** List all secrets (never includes values). */
  list(): Promise<SecretEntry[]>;
  /** Export all secrets to an encrypted archive. */
  exportArchive(passphrase: string): Promise<SecretArchive>;
  /** Import secrets from an encrypted archive. Returns imported key names. */
  importArchive(archive: SecretArchive, passphrase: string): Promise<string[]>;
}
