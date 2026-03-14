import { createHmac, randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  auditKeyPath,
  auditPath,
  computeEventHmac,
  emitSecretAuditEvent,
  getOrCreateAuditKey,
  readAuditEvents,
  verifyAuditChain,
} from "./audit.js";
import type { SecretAuditEvent } from "./audit.js";

describe("audit trail with HMAC chain", () => {
  let tmpDir: string;
  let envPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "audit-test-"));
    envPath = join(tmpDir, ".env");
  });

  // --- emitSecretAuditEvent ---

  describe("emitSecretAuditEvent", () => {
    it("writes a JSONL audit event with HMAC fields", async () => {
      await emitSecretAuditEvent(envPath, "added", "MY_KEY");

      const content = await readFile(auditPath(envPath), "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(1);

      const event: SecretAuditEvent = JSON.parse(lines[0]);
      expect(event.seq).toBe(1);
      expect(event.event).toBe("added");
      expect(event.secret_name).toBe("MY_KEY");
      expect(event.timestamp).toBeTruthy();
      expect(event.prev_hmac).toBe("");
      expect(event.hmac).toMatch(/^[0-9a-f]{64}$/);
    });

    it("appends multiple events with incrementing seq", async () => {
      await emitSecretAuditEvent(envPath, "added", "KEY_A");
      await emitSecretAuditEvent(envPath, "rotated", "KEY_A");
      await emitSecretAuditEvent(envPath, "revoked", "KEY_A");

      const events = await readAuditEvents(envPath);
      expect(events).toHaveLength(3);
      expect(events[0].seq).toBe(1);
      expect(events[1].seq).toBe(2);
      expect(events[2].seq).toBe(3);
      expect(events[0].event).toBe("added");
      expect(events[1].event).toBe("rotated");
      expect(events[2].event).toBe("revoked");
    });

    it("chains prev_hmac from previous event", async () => {
      await emitSecretAuditEvent(envPath, "added", "KEY_A");
      await emitSecretAuditEvent(envPath, "rotated", "KEY_A");

      const events = await readAuditEvents(envPath);
      expect(events[0].prev_hmac).toBe("");
      expect(events[1].prev_hmac).toBe(events[0].hmac);
    });

    it("sets 600 permissions on audit file", async () => {
      await emitSecretAuditEvent(envPath, "added", "KEY_A");

      const s = await readFile(auditPath(envPath)).then(() =>
        import("node:fs/promises").then((fs) => fs.stat(auditPath(envPath))),
      );
      expect(s.mode & 0o777).toBe(0o600);
    });
  });

  // --- HMAC key management ---

  describe("getOrCreateAuditKey", () => {
    it("creates a new key on first call", async () => {
      const key = await getOrCreateAuditKey(envPath);
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);

      // Key file should exist with 600 permissions
      const keyFile = auditKeyPath(envPath);
      const s = await import("node:fs/promises").then((fs) => fs.stat(keyFile));
      expect(s.mode & 0o777).toBe(0o600);
    });

    it("returns the same key on subsequent calls", async () => {
      const key1 = await getOrCreateAuditKey(envPath);
      const key2 = await getOrCreateAuditKey(envPath);
      expect(key1.equals(key2)).toBe(true);
    });
  });

  // --- computeEventHmac ---

  describe("computeEventHmac", () => {
    it("computes a deterministic HMAC-SHA256", () => {
      const key = Buffer.from("test-key-32-bytes-long-enough!00");
      const partial = {
        seq: 1,
        event: "added" as const,
        secret_name: "MY_KEY",
        timestamp: "2026-01-01T00:00:00.000Z",
        prev_hmac: "",
      };

      const hmac1 = computeEventHmac(key, partial);
      const hmac2 = computeEventHmac(key, partial);
      expect(hmac1).toBe(hmac2);
      expect(hmac1).toMatch(/^[0-9a-f]{64}$/);
    });

    it("produces different HMACs for different data", () => {
      const key = Buffer.from("test-key-32-bytes-long-enough!00");
      const base = {
        seq: 1,
        event: "added" as const,
        secret_name: "MY_KEY",
        timestamp: "2026-01-01T00:00:00.000Z",
        prev_hmac: "",
      };

      const hmac1 = computeEventHmac(key, base);
      const hmac2 = computeEventHmac(key, { ...base, secret_name: "OTHER_KEY" });
      expect(hmac1).not.toBe(hmac2);
    });

    it("produces different HMACs for different keys", () => {
      const key1 = Buffer.from("key-one-32-bytes-long-enough!000");
      const key2 = Buffer.from("key-two-32-bytes-long-enough!000");
      const partial = {
        seq: 1,
        event: "added" as const,
        secret_name: "MY_KEY",
        timestamp: "2026-01-01T00:00:00.000Z",
        prev_hmac: "",
      };

      expect(computeEventHmac(key1, partial)).not.toBe(
        computeEventHmac(key2, partial),
      );
    });

    it("includes prev_hmac in computation", () => {
      const key = Buffer.from("test-key-32-bytes-long-enough!00");
      const base = {
        seq: 2,
        event: "rotated" as const,
        secret_name: "MY_KEY",
        timestamp: "2026-01-01T00:00:00.000Z",
      };

      const hmac1 = computeEventHmac(key, { ...base, prev_hmac: "aaa" });
      const hmac2 = computeEventHmac(key, { ...base, prev_hmac: "bbb" });
      expect(hmac1).not.toBe(hmac2);
    });
  });

  // --- verifyAuditChain ---

  describe("verifyAuditChain", () => {
    it("returns valid for an untampered chain", async () => {
      await emitSecretAuditEvent(envPath, "added", "KEY_A");
      await emitSecretAuditEvent(envPath, "rotated", "KEY_A");
      await emitSecretAuditEvent(envPath, "revoked", "KEY_A");

      const result = await verifyAuditChain(envPath);
      expect(result.valid).toBe(true);
      expect(result.eventCount).toBe(3);
      expect(result.errors).toHaveLength(0);
    });

    it("returns valid for empty audit trail", async () => {
      // Create key but no events
      await getOrCreateAuditKey(envPath);
      const result = await verifyAuditChain(envPath);
      expect(result.valid).toBe(true);
      expect(result.eventCount).toBe(0);
    });

    it("detects tampered event data", async () => {
      await emitSecretAuditEvent(envPath, "added", "KEY_A");
      await emitSecretAuditEvent(envPath, "rotated", "KEY_A");

      // Tamper with event data
      const path = auditPath(envPath);
      const content = await readFile(path, "utf-8");
      const lines = content.trim().split("\n");
      const event = JSON.parse(lines[1]);
      event.secret_name = "TAMPERED";
      lines[1] = JSON.stringify(event);
      await writeFile(path, lines.join("\n") + "\n", "utf-8");

      const result = await verifyAuditChain(envPath);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.message.includes("HMAC mismatch"))).toBe(true);
    });

    it("detects tampered HMAC value", async () => {
      await emitSecretAuditEvent(envPath, "added", "KEY_A");
      await emitSecretAuditEvent(envPath, "rotated", "KEY_A");

      // Tamper with first event's HMAC (breaks chain linkage for event 2)
      const path = auditPath(envPath);
      const content = await readFile(path, "utf-8");
      const lines = content.trim().split("\n");
      const event = JSON.parse(lines[0]);
      event.hmac = "0".repeat(64);
      lines[0] = JSON.stringify(event);
      await writeFile(path, lines.join("\n") + "\n", "utf-8");

      const result = await verifyAuditChain(envPath);
      expect(result.valid).toBe(false);
      // Should detect both: HMAC mismatch on event 1, and prev_hmac mismatch on event 2
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    });

    it("detects deleted event (sequence gap)", async () => {
      await emitSecretAuditEvent(envPath, "added", "KEY_A");
      await emitSecretAuditEvent(envPath, "rotated", "KEY_A");
      await emitSecretAuditEvent(envPath, "revoked", "KEY_A");

      // Remove the middle event
      const path = auditPath(envPath);
      const content = await readFile(path, "utf-8");
      const lines = content.trim().split("\n");
      lines.splice(1, 1); // remove event 2
      await writeFile(path, lines.join("\n") + "\n", "utf-8");

      const result = await verifyAuditChain(envPath);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Sequence gap"))).toBe(true);
    });

    it("reports error when key file is missing", async () => {
      await emitSecretAuditEvent(envPath, "added", "KEY_A");

      // Delete the key file
      const keyPath = auditKeyPath(envPath);
      await import("node:fs/promises").then((fs) => fs.unlink(keyPath));

      const result = await verifyAuditChain(envPath);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("key file missing");
    });
  });

  // --- readAuditEvents ---

  describe("readAuditEvents", () => {
    it("returns empty array when no audit file exists", async () => {
      const events = await readAuditEvents(envPath);
      expect(events).toEqual([]);
    });

    it("reads all events in order", async () => {
      await emitSecretAuditEvent(envPath, "added", "A");
      await emitSecretAuditEvent(envPath, "added", "B");
      await emitSecretAuditEvent(envPath, "accessed", "A");

      const events = await readAuditEvents(envPath);
      expect(events).toHaveLength(3);
      expect(events.map((e) => e.secret_name)).toEqual(["A", "B", "A"]);
      expect(events.map((e) => e.event)).toEqual(["added", "added", "accessed"]);
    });
  });
});
