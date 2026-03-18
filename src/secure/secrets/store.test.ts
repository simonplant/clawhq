/**
 * Tests for SecretStore implementations, crypto, export/import, and backend switching.
 */

import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deriveKey, encryptAes256Gcm, decryptAes256Gcm, hmacSha256, generateSalt } from "./crypto.js";
import { EncryptedStore, migrateToEncrypted, decryptForDeploy } from "./encrypted-store.js";
import { atomicWriteEnvFile, setEnvValue } from "./env.js";
import type { EnvFile } from "./env.js";
import { PlaintextEnvStore, decryptArchive } from "./plaintext-store.js";
import type { SecretArchive } from "./store.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "secrets-store-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Crypto utilities
// ---------------------------------------------------------------------------

describe("crypto utilities", () => {
  it("derives consistent keys from same passphrase and salt", () => {
    const salt = generateSalt();
    const key1 = deriveKey("test-passphrase", salt);
    const key2 = deriveKey("test-passphrase", salt);
    expect(key1.equals(key2)).toBe(true);
  });

  it("derives different keys for different passphrases", () => {
    const salt = generateSalt();
    const key1 = deriveKey("passphrase-a", salt);
    const key2 = deriveKey("passphrase-b", salt);
    expect(key1.equals(key2)).toBe(false);
  });

  it("derives different keys for different salts", () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    const key1 = deriveKey("same-passphrase", salt1);
    const key2 = deriveKey("same-passphrase", salt2);
    expect(key1.equals(key2)).toBe(false);
  });

  it("encrypts and decrypts round-trip", () => {
    const plaintext = Buffer.from("hello secrets", "utf-8");
    const key = deriveKey("test", generateSalt());
    const { ciphertext, iv, authTag } = encryptAes256Gcm(plaintext, key);
    const decrypted = decryptAes256Gcm(ciphertext, key, iv, authTag);
    expect(decrypted.toString("utf-8")).toBe("hello secrets");
  });

  it("fails to decrypt with wrong key", () => {
    const plaintext = Buffer.from("secret data", "utf-8");
    const salt = generateSalt();
    const key1 = deriveKey("correct", salt);
    const key2 = deriveKey("wrong", generateSalt());
    const { ciphertext, iv, authTag } = encryptAes256Gcm(plaintext, key1);
    expect(() => decryptAes256Gcm(ciphertext, key2, iv, authTag)).toThrow();
  });

  it("computes consistent HMAC", () => {
    const key = Buffer.from("hmac-key");
    const data = Buffer.from("test data");
    const h1 = hmacSha256(key, data);
    const h2 = hmacSha256(key, data);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // SHA-256 hex
  });
});

// ---------------------------------------------------------------------------
// PlaintextEnvStore
// ---------------------------------------------------------------------------

describe("PlaintextEnvStore", () => {
  let envPath: string;
  let metaPath: string;
  let store: PlaintextEnvStore;

  beforeEach(() => {
    envPath = join(tmpDir, ".env");
    metaPath = envPath + ".meta";
    store = new PlaintextEnvStore(envPath, metaPath);
  });

  it("get returns undefined for missing secret", async () => {
    expect(await store.get("NONEXISTENT")).toBeUndefined();
  });

  it("set creates a new secret and get retrieves it", async () => {
    await store.set("MY_KEY", "my-value");
    expect(await store.get("MY_KEY")).toBe("my-value");
  });

  it("set updates an existing secret", async () => {
    await store.set("MY_KEY", "old");
    await store.set("MY_KEY", "new");
    expect(await store.get("MY_KEY")).toBe("new");
  });

  it("delete removes a secret", async () => {
    await store.set("TO_DELETE", "value");
    const deleted = await store.delete("TO_DELETE");
    expect(deleted).toBe(true);
    expect(await store.get("TO_DELETE")).toBeUndefined();
  });

  it("delete returns false for missing secret", async () => {
    expect(await store.delete("NONEXISTENT")).toBe(false);
  });

  it("list returns all secrets without values", async () => {
    await store.set("KEY_A", "val-a");
    await store.set("KEY_B", "val-b");
    const entries = await store.list();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.name).sort()).toEqual(["KEY_A", "KEY_B"]);
    // Never includes values
    for (const entry of entries) {
      expect(entry).not.toHaveProperty("value");
    }
  });

  it("writes .env with 600 permissions", async () => {
    await store.set("SECRET", "value");
    const s = await stat(envPath);
    expect(s.mode & 0o777).toBe(0o600);
  });
});

// ---------------------------------------------------------------------------
// EncryptedStore
// ---------------------------------------------------------------------------

describe("EncryptedStore", () => {
  let encPath: string;
  let store: EncryptedStore;
  const passphrase = "test-passphrase-123";

  beforeEach(() => {
    encPath = join(tmpDir, ".env.enc");
    store = new EncryptedStore(encPath, passphrase);
  });

  it("get returns undefined for missing secret", async () => {
    expect(await store.get("NONEXISTENT")).toBeUndefined();
  });

  it("set and get round-trip", async () => {
    await store.set("API_KEY", "sk-test-123");
    expect(await store.get("API_KEY")).toBe("sk-test-123");
  });

  it("set updates existing secret", async () => {
    await store.set("API_KEY", "old-value");
    await store.set("API_KEY", "new-value");
    expect(await store.get("API_KEY")).toBe("new-value");
  });

  it("delete removes a secret", async () => {
    await store.set("TO_DELETE", "value");
    expect(await store.delete("TO_DELETE")).toBe(true);
    expect(await store.get("TO_DELETE")).toBeUndefined();
  });

  it("list returns all secrets", async () => {
    await store.set("KEY_A", "val-a");
    await store.set("KEY_B", "val-b");
    const entries = await store.list();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.name).sort()).toEqual(["KEY_A", "KEY_B"]);
  });

  it("writes .env.enc with 600 permissions", async () => {
    await store.set("SECRET", "value");
    const s = await stat(encPath);
    expect(s.mode & 0o777).toBe(0o600);
  });

  it("encrypted file is not readable as plaintext", async () => {
    await store.set("SECRET", "my-secret-value");
    const raw = await readFile(encPath, "utf-8");
    expect(raw).not.toContain("my-secret-value");
    expect(raw).not.toContain("SECRET");
    // Should be valid JSON with ciphertext
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.ciphertext).toBeTruthy();
  });

  it("fails with wrong passphrase", async () => {
    await store.set("SECRET", "value");
    const badStore = new EncryptedStore(encPath, "wrong-passphrase");
    await expect(badStore.get("SECRET")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Export / Import cycle
// ---------------------------------------------------------------------------

describe("export / import cycle", () => {
  it("plaintext export -> import round-trip preserves all secrets", async () => {
    const envPath = join(tmpDir, ".env");
    const metaPath = envPath + ".meta";
    const store = new PlaintextEnvStore(envPath, metaPath);

    // Add secrets
    await store.set("ANTHROPIC_API_KEY", "sk-ant-test");
    await store.set("TELEGRAM_BOT_TOKEN", "123:abc");
    await store.set("CUSTOM_SECRET", "custom-value");

    // Export
    const passphrase = "export-pass-123";
    const archive = await store.exportArchive(passphrase);

    expect(archive.version).toBe(1);
    expect(archive.secretCount).toBe(3);
    expect(archive.ciphertext).toBeTruthy();

    // Import into a new store
    const newEnvPath = join(tmpDir, "new-env", ".env");
    await mkdir(join(tmpDir, "new-env"), { recursive: true });
    const newStore = new PlaintextEnvStore(newEnvPath);

    const imported = await newStore.importArchive(archive, passphrase);
    expect(imported).toHaveLength(3);
    expect(imported.sort()).toEqual(["ANTHROPIC_API_KEY", "CUSTOM_SECRET", "TELEGRAM_BOT_TOKEN"]);

    // Verify values
    expect(await newStore.get("ANTHROPIC_API_KEY")).toBe("sk-ant-test");
    expect(await newStore.get("TELEGRAM_BOT_TOKEN")).toBe("123:abc");
    expect(await newStore.get("CUSTOM_SECRET")).toBe("custom-value");
  });

  it("encrypted export -> import round-trip preserves all secrets", async () => {
    const encPath = join(tmpDir, ".env.enc");
    const store = new EncryptedStore(encPath, "store-pass");

    await store.set("KEY_A", "value-a");
    await store.set("KEY_B", "value-b");

    const archive = await store.exportArchive("archive-pass");
    expect(archive.secretCount).toBe(2);

    // Import into a new encrypted store
    const newEncPath = join(tmpDir, "new.env.enc");
    const newStore = new EncryptedStore(newEncPath, "new-store-pass");

    const imported = await newStore.importArchive(archive, "archive-pass");
    expect(imported.sort()).toEqual(["KEY_A", "KEY_B"]);
    expect(await newStore.get("KEY_A")).toBe("value-a");
    expect(await newStore.get("KEY_B")).toBe("value-b");
  });

  it("import fails with wrong passphrase", async () => {
    const envPath = join(tmpDir, ".env");
    const store = new PlaintextEnvStore(envPath);

    await store.set("SECRET", "value");
    const archive = await store.exportArchive("correct-pass");

    const newStore = new PlaintextEnvStore(join(tmpDir, "new.env"));
    await expect(newStore.importArchive(archive, "wrong-pass")).rejects.toThrow();
  });

  it("archive integrity check detects tampering", async () => {
    const envPath = join(tmpDir, ".env");
    const store = new PlaintextEnvStore(envPath);

    await store.set("SECRET", "value");
    const archive = await store.exportArchive("pass");

    // Tamper with the integrity HMAC
    const tampered: SecretArchive = { ...archive, integrityHmac: "deadbeef".repeat(8) };
    // Since we only tampered HMAC (not ciphertext), decrypt will work but HMAC check fails
    expect(() => decryptArchive(tampered, "pass")).toThrow("Archive integrity check failed");
  });
});

// ---------------------------------------------------------------------------
// Backend switching (plaintext -> encrypted migration)
// ---------------------------------------------------------------------------

describe("backend switching", () => {
  it("migrates from plaintext to encrypted and wipes .env", async () => {
    const envPath = join(tmpDir, ".env");
    const encPath = join(tmpDir, ".env.enc");
    const passphrase = "migration-pass";

    // Create plaintext .env
    const env: EnvFile = { entries: [] };
    setEnvValue(env, "SECRET_A", "value-a");
    setEnvValue(env, "SECRET_B", "value-b");
    await atomicWriteEnvFile(envPath, env);

    // Migrate
    const { migratedCount } = await migrateToEncrypted(envPath, encPath, passphrase);
    expect(migratedCount).toBe(2);

    // Verify .env is wiped
    await expect(stat(envPath)).rejects.toThrow();

    // Verify encrypted store has the secrets
    const store = new EncryptedStore(encPath, passphrase);
    expect(await store.get("SECRET_A")).toBe("value-a");
    expect(await store.get("SECRET_B")).toBe("value-b");
  });

  it("decryptForDeploy writes plaintext .env from encrypted store", async () => {
    const encPath = join(tmpDir, ".env.enc");
    const outputPath = join(tmpDir, "deploy.env");
    const passphrase = "deploy-pass";

    // Create encrypted store
    const store = new EncryptedStore(encPath, passphrase);
    await store.set("API_KEY", "sk-123");
    await store.set("BOT_TOKEN", "abc-456");

    // Decrypt for deploy
    await decryptForDeploy(encPath, outputPath, passphrase);

    // Verify output
    const content = await readFile(outputPath, "utf-8");
    expect(content).toContain("API_KEY=sk-123");
    expect(content).toContain("BOT_TOKEN=abc-456");

    // Verify 600 permissions
    const s = await stat(outputPath);
    expect(s.mode & 0o777).toBe(0o600);
  });

  it("decryptForDeploy fails with wrong passphrase", async () => {
    const encPath = join(tmpDir, ".env.enc");
    const outputPath = join(tmpDir, "deploy.env");

    const store = new EncryptedStore(encPath, "correct");
    await store.set("SECRET", "value");

    await expect(
      decryptForDeploy(encPath, outputPath, "wrong"),
    ).rejects.toThrow();
  });
});
