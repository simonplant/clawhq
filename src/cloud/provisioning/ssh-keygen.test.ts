import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateSshKeypair, sshKeyPath } from "./ssh-keygen.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "ssh-keygen-test-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("generateSshKeypair", () => {
  it("creates a private key file at the expected path", () => {
    const result = generateSshKeypair(testDir, "test-instance-001");

    const expectedPath = join(testDir, "keys", "test-instance-001.pem");
    expect(result.privateKeyPath).toBe(expectedPath);

    const content = readFileSync(expectedPath, "utf-8");
    expect(content).toContain("BEGIN PRIVATE KEY");
    expect(content).toContain("END PRIVATE KEY");
  });

  it("writes the private key with mode 0600", () => {
    const result = generateSshKeypair(testDir, "test-instance-002");

    const mode = statSync(result.privateKeyPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("returns a public key in OpenSSH format", () => {
    const result = generateSshKeypair(testDir, "test-instance-003");

    expect(result.publicKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+$/);
  });

  it("generates unique keypairs for different instance IDs", () => {
    const a = generateSshKeypair(testDir, "instance-a");
    const b = generateSshKeypair(testDir, "instance-b");

    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.privateKeyPath).not.toBe(b.privateKeyPath);
  });

  it("creates the keys directory if it does not exist", () => {
    const result = generateSshKeypair(testDir, "test-instance-004");

    expect(result.privateKeyPath).toContain("/keys/");
    // File exists (no throw on stat)
    expect(() => statSync(result.privateKeyPath)).not.toThrow();
  });
});

describe("sshKeyPath", () => {
  it("returns the expected path without generating a key", () => {
    const path = sshKeyPath(testDir, "some-id");
    expect(path).toBe(join(testDir, "keys", "some-id.pem"));
  });
});
