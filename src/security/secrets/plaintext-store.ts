/**
 * PlaintextEnvStore — SecretStore backed by a plaintext .env file.
 *
 * Wraps the existing env.ts parseEnv/serializeEnv functions.
 * This is the default backend.
 */

import { readAuditEvents } from "./audit.js";
import { deriveKey, encryptAes256Gcm, decryptAes256Gcm, hmacSha256, generateSalt } from "./crypto.js";
import {
  atomicWriteEnvFile,
  envToObject,
  getEnvValue,
  readEnvFile,
  removeEnvValue,
  setEnvValue,
} from "./env.js";
import type { EnvFile } from "./env.js";
import { inferCategory, readMetadata } from "./metadata.js";
import type { ArchivePayload, SecretArchive, SecretStore } from "./store.js";
import type { SecretEntry } from "./types.js";

export class PlaintextEnvStore implements SecretStore {
  constructor(
    private readonly envPath: string,
    private readonly metaPath: string = envPath + ".meta",
  ) {}

  async get(name: string): Promise<string | undefined> {
    const env = await this.readOrCreate();
    return getEnvValue(env, name);
  }

  async set(name: string, value: string): Promise<void> {
    const env = await this.readOrCreate();
    setEnvValue(env, name, value);
    await atomicWriteEnvFile(this.envPath, env);
  }

  async delete(name: string): Promise<boolean> {
    const env = await this.readOrCreate();
    const removed = removeEnvValue(env, name);
    if (removed) {
      await atomicWriteEnvFile(this.envPath, env);
    }
    return removed;
  }

  async list(): Promise<SecretEntry[]> {
    const env = await this.readOrCreate();
    const metadata = await readMetadata(this.metaPath);

    const entries: SecretEntry[] = [];
    for (const entry of env.entries) {
      if (entry.type !== "pair" || !entry.key) continue;
      const meta = metadata[entry.key];
      entries.push({
        name: entry.key,
        provider_category: meta?.provider_category ?? inferCategory(entry.key),
        health_status: "unknown",
        created_at: meta?.created_at ?? "",
        rotated_at: meta?.rotated_at ?? null,
      });
    }
    return entries;
  }

  async exportArchive(passphrase: string): Promise<SecretArchive> {
    const env = await this.readOrCreate();
    const secrets = envToObject(env);
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
    const payload = decryptArchive(archive, passphrase);
    const env = await this.readOrCreate();

    const importedKeys: string[] = [];
    for (const [key, value] of Object.entries(payload.secrets)) {
      setEnvValue(env, key, value);
      importedKeys.push(key);
    }

    await atomicWriteEnvFile(this.envPath, env);
    return importedKeys;
  }

  private async readOrCreate(): Promise<EnvFile> {
    try {
      return await readEnvFile(this.envPath);
    } catch {
      return { entries: [] };
    }
  }
}

/**
 * Decrypt and verify a SecretArchive. Throws on bad passphrase or tampered data.
 */
export function decryptArchive(archive: SecretArchive, passphrase: string): ArchivePayload {
  if (archive.version !== 1) {
    throw new Error(`Unsupported archive version: ${archive.version}`);
  }

  const salt = Buffer.from(archive.salt, "base64");
  const key = deriveKey(passphrase, salt);
  const ciphertext = Buffer.from(archive.ciphertext, "base64");
  const iv = Buffer.from(archive.iv, "base64");
  const authTag = Buffer.from(archive.authTag, "base64");

  const plaintext = decryptAes256Gcm(ciphertext, key, iv, authTag);

  // Verify integrity HMAC
  const computedHmac = hmacSha256(key, plaintext);
  if (computedHmac !== archive.integrityHmac) {
    throw new Error("Archive integrity check failed — data may be corrupted");
  }

  return JSON.parse(plaintext.toString("utf-8")) as ArchivePayload;
}
