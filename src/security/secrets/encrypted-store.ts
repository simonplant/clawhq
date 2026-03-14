/**
 * EncryptedStore — SecretStore backed by an encrypted .env.enc file.
 *
 * Secrets are encrypted with AES-256-GCM. The master key is derived
 * from a user passphrase via scrypt. Plaintext is never written to
 * persistent disk — decrypted data lives only in memory.
 */

import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { readAuditEvents } from "./audit.js";
import { deriveKey, encryptAes256Gcm, decryptAes256Gcm, hmacSha256, generateSalt } from "./crypto.js";
import { inferCategory, readMetadata } from "./metadata.js";
import type { ArchivePayload, SecretArchive, SecretStore } from "./store.js";
import type { SecretEntry } from "./types.js";

/** On-disk format for the encrypted store (.env.enc). */
export interface EncryptedEnvFile {
  /** Format version */
  version: 1;
  /** AES-256-GCM ciphertext (base64) */
  ciphertext: string;
  /** GCM initialization vector (base64) */
  iv: string;
  /** GCM auth tag (base64) */
  authTag: string;
  /** scrypt salt (base64) */
  salt: string;
}

/**
 * EncryptedStore — all secrets encrypted at rest with AES-256-GCM.
 *
 * The passphrase must be provided at construction time (or set later
 * via setPassphrase) before any operations can be performed.
 */
export class EncryptedStore implements SecretStore {
  private passphrase: string;

  constructor(
    private readonly encPath: string,
    passphrase: string,
    private readonly metaPath: string = encPath.replace(/\.enc$/, ".meta"),
    /** Path to the .env file for reading audit trail */
    private readonly envPath: string = encPath.replace(/\.enc$/, ""),
  ) {
    this.passphrase = passphrase;
  }

  async get(name: string): Promise<string | undefined> {
    const secrets = await this.readSecrets();
    return secrets[name];
  }

  async set(name: string, value: string): Promise<void> {
    const secrets = await this.readSecrets();
    secrets[name] = value;
    await this.writeSecrets(secrets);
  }

  async delete(name: string): Promise<boolean> {
    const secrets = await this.readSecrets();
    if (!(name in secrets)) return false;
    const remaining: Record<string, string> = {};
    for (const [k, v] of Object.entries(secrets)) {
      if (k !== name) remaining[k] = v;
    }
    await this.writeSecrets(remaining);
    return true;
  }

  async list(): Promise<SecretEntry[]> {
    const secrets = await this.readSecrets();
    const metadata = await readMetadata(this.metaPath);

    return Object.keys(secrets).map((key) => {
      const meta = metadata[key];
      return {
        name: key,
        provider_category: meta?.provider_category ?? inferCategory(key),
        health_status: "unknown" as const,
        created_at: meta?.created_at ?? "",
        rotated_at: meta?.rotated_at ?? null,
      };
    });
  }

  async exportArchive(passphrase: string): Promise<SecretArchive> {
    const secrets = await this.readSecrets();
    const metadata = await readMetadata(this.metaPath);
    const auditTrail = await readAuditEvents(this.envPath);

    const payload: ArchivePayload = {
      secrets,
      metadata,
      auditTrail,
      exportedAt: new Date().toISOString(),
    };

    const plaintext = Buffer.from(JSON.stringify(payload), "utf-8");
    const salt = generateSalt();
    const key = deriveKey(passphrase, salt);
    const { ciphertext, iv, authTag } = encryptAes256Gcm(plaintext, key);
    const integrityHmac = hmacSha256(key, plaintext);

    return {
      version: 1,
      createdAt: new Date().toISOString(),
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      salt: salt.toString("base64"),
      integrityHmac,
      secretCount: Object.keys(secrets).length,
    };
  }

  async importArchive(archive: SecretArchive, passphrase: string): Promise<string[]> {
    // Decrypt the archive with the archive passphrase
    const payload = decryptArchivePayload(archive, passphrase);

    // Merge into current store
    const secrets = await this.readSecrets();
    const importedKeys: string[] = [];

    for (const [key, value] of Object.entries(payload.secrets)) {
      secrets[key] = value;
      importedKeys.push(key);
    }

    await this.writeSecrets(secrets);
    return importedKeys;
  }

  /**
   * Decrypt all secrets from .env.enc into a plain object (in memory only).
   */
  async readSecrets(): Promise<Record<string, string>> {
    let content: string;
    try {
      content = await readFile(this.encPath, "utf-8");
    } catch {
      return {};
    }

    const enc = JSON.parse(content) as EncryptedEnvFile;
    if (enc.version !== 1) {
      throw new Error(`Unsupported encrypted store version: ${enc.version}`);
    }

    const salt = Buffer.from(enc.salt, "base64");
    const key = deriveKey(this.passphrase, salt);
    const ciphertext = Buffer.from(enc.ciphertext, "base64");
    const iv = Buffer.from(enc.iv, "base64");
    const authTag = Buffer.from(enc.authTag, "base64");

    const plaintext = decryptAes256Gcm(ciphertext, key, iv, authTag);
    return JSON.parse(plaintext.toString("utf-8")) as Record<string, string>;
  }

  /**
   * Encrypt and write secrets to .env.enc with 600 permissions.
   */
  private async writeSecrets(secrets: Record<string, string>): Promise<void> {
    const plaintext = Buffer.from(JSON.stringify(secrets), "utf-8");
    const salt = generateSalt();
    const key = deriveKey(this.passphrase, salt);
    const { ciphertext, iv, authTag } = encryptAes256Gcm(plaintext, key);

    const enc: EncryptedEnvFile = {
      version: 1,
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      salt: salt.toString("base64"),
    };

    // Atomic write: tmp file -> rename
    const tmpPath = join(dirname(this.encPath), ".env.enc.tmp");
    await writeFile(tmpPath, JSON.stringify(enc, null, 2) + "\n", {
      encoding: "utf-8",
      mode: 0o600,
    });
    await chmod(tmpPath, 0o600);
    await rename(tmpPath, this.encPath);
  }
}

/**
 * Decrypt and verify a SecretArchive payload.
 */
function decryptArchivePayload(archive: SecretArchive, passphrase: string): ArchivePayload {
  if (archive.version !== 1) {
    throw new Error(`Unsupported archive version: ${archive.version}`);
  }

  const salt = Buffer.from(archive.salt, "base64");
  const key = deriveKey(passphrase, salt);
  const ciphertext = Buffer.from(archive.ciphertext, "base64");
  const iv = Buffer.from(archive.iv, "base64");
  const authTag = Buffer.from(archive.authTag, "base64");

  const plaintext = decryptAes256Gcm(ciphertext, key, iv, authTag);

  const computedHmac = hmacSha256(key, plaintext);
  if (computedHmac !== archive.integrityHmac) {
    throw new Error("Archive integrity check failed — data may be corrupted");
  }

  return JSON.parse(plaintext.toString("utf-8")) as ArchivePayload;
}

/**
 * Migrate from plaintext .env to encrypted .env.enc.
 *
 * 1. Reads all secrets from .env
 * 2. Encrypts and writes to .env.enc
 * 3. Securely wipes the plaintext .env (overwrite with random bytes, then delete)
 */
export async function migrateToEncrypted(
  envPath: string,
  encPath: string,
  passphrase: string,
): Promise<{ migratedCount: number }> {
  const { readEnvFile, envToObject } = await import("./env.js");

  const env = await readEnvFile(envPath);
  const secrets = envToObject(env);
  const count = Object.keys(secrets).length;

  if (count === 0) {
    throw new Error("No secrets found in .env to migrate");
  }

  // Write encrypted store
  const store = new EncryptedStore(encPath, passphrase, envPath + ".meta", envPath);
  for (const [key, value] of Object.entries(secrets)) {
    await store.set(key, value);
  }

  // Securely wipe the plaintext .env: overwrite with random data, then unlink
  const { stat, unlink } = await import("node:fs/promises");
  const { randomBytes } = await import("node:crypto");

  const s = await stat(envPath);
  const wipeData = randomBytes(Math.max(s.size, 256));
  await writeFile(envPath, wipeData);
  await writeFile(envPath, Buffer.alloc(s.size, 0)); // Zero pass
  await unlink(envPath);

  return { migratedCount: count };
}

/**
 * Decrypt secrets from .env.enc to a temporary plaintext .env for deploy.
 * The caller is responsible for cleaning up the output path (e.g., tmpfs mount).
 */
export async function decryptForDeploy(
  encPath: string,
  outputPath: string,
  passphrase: string,
): Promise<void> {
  const store = new EncryptedStore(encPath, passphrase);
  const secrets = await store.readSecrets();

  // Write as plain .env format
  const lines = Object.entries(secrets).map(([k, v]) => `${k}=${v}`);
  await writeFile(outputPath, lines.join("\n") + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
  await chmod(outputPath, 0o600);
}
