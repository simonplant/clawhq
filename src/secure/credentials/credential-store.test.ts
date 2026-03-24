import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DIR_MODE_SECRET, FILE_MODE_SECRET } from "../../config/defaults.js";

import {
  credentialsPath,
  deleteIntegrationCredentials,
  getCredentials,
  readCredentialStore,
  removeCredentials,
  setCredentials,
  storeIntegrationCredentials,
  verifyCredentialPermissions,
  writeCredentialStore,
} from "./credential-store.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "clawhq-cred-test-"));
}

// ── credentialsPath ─────────────────────────────────────────────────────────

describe("credentialsPath", () => {
  it("returns engine/credentials.json under deployDir", () => {
    expect(credentialsPath("/deploy")).toBe("/deploy/engine/credentials.json");
  });
});

// ── readCredentialStore ─────────────────────────────────────────────────────

describe("readCredentialStore", () => {
  it("returns empty store when file does not exist", () => {
    const store = readCredentialStore(tmpDir());
    expect(store).toEqual({ version: 1, credentials: [] });
  });
});

// ── writeCredentialStore ────────────────────────────────────────────────────

describe("writeCredentialStore", () => {
  it("creates engine/ directory with mode 0700", () => {
    const dir = tmpDir();
    writeCredentialStore(dir, { version: 1, credentials: [] });

    const engineDir = join(dir, "engine");
    const stat = statSync(engineDir);
    expect(stat.mode & 0o777).toBe(DIR_MODE_SECRET);
  });

  it("writes credentials.json with mode 0600", () => {
    const dir = tmpDir();
    writeCredentialStore(dir, { version: 1, credentials: [] });

    const stat = statSync(credentialsPath(dir));
    expect(stat.mode & 0o777).toBe(FILE_MODE_SECRET);
  });
});

// ── setCredentials / getCredentials ─────────────────────────────────────────

describe("setCredentials", () => {
  it("adds new integration credentials", () => {
    const store = { version: 1 as const, credentials: [] };
    const updated = setCredentials(store, "imap", { host: "mail.example.com" });

    expect(updated.credentials).toHaveLength(1);
    expect(getCredentials(updated, "imap")?.values).toEqual({ host: "mail.example.com" });
  });

  it("replaces existing integration credentials", () => {
    const store = setCredentials({ version: 1, credentials: [] }, "imap", { host: "old" });
    const updated = setCredentials(store, "imap", { host: "new" });

    expect(updated.credentials).toHaveLength(1);
    expect(getCredentials(updated, "imap")?.values).toEqual({ host: "new" });
    expect(getCredentials(updated, "imap")?.rotatedAt).toBeDefined();
  });
});

// ── removeCredentials ───────────────────────────────────────────────────────

describe("removeCredentials", () => {
  it("removes an integration", () => {
    const store = setCredentials({ version: 1, credentials: [] }, "imap", { host: "x" });
    const updated = removeCredentials(store, "imap");
    expect(updated.credentials).toHaveLength(0);
  });
});

// ── storeIntegrationCredentials ─────────────────────────────────────────────

describe("storeIntegrationCredentials", () => {
  it("creates engine/ dir with 0700 and file with 0600", () => {
    const dir = tmpDir();
    storeIntegrationCredentials(dir, "telegram", { token: "abc" });

    const engineDir = join(dir, "engine");
    expect(statSync(engineDir).mode & 0o777).toBe(DIR_MODE_SECRET);
    expect(statSync(credentialsPath(dir)).mode & 0o777).toBe(FILE_MODE_SECRET);
  });
});

// ── verifyCredentialPermissions ──────────────────────────────────────────────

describe("verifyCredentialPermissions", () => {
  it("returns true for correctly permissioned file", () => {
    const dir = tmpDir();
    storeIntegrationCredentials(dir, "test", { key: "val" });
    expect(verifyCredentialPermissions(dir)).toBe(true);
  });

  it("returns false when file does not exist", () => {
    expect(verifyCredentialPermissions(tmpDir())).toBe(false);
  });
});

// ── deleteIntegrationCredentials ────────────────────────────────────────────

describe("deleteIntegrationCredentials", () => {
  it("removes integration and preserves file permissions", () => {
    const dir = tmpDir();
    storeIntegrationCredentials(dir, "imap", { host: "x" });
    storeIntegrationCredentials(dir, "telegram", { token: "y" });

    deleteIntegrationCredentials(dir, "imap");

    const store = readCredentialStore(dir);
    expect(store.credentials).toHaveLength(1);
    expect(getCredentials(store, "imap")).toBeUndefined();
    expect(statSync(credentialsPath(dir)).mode & 0o777).toBe(FILE_MODE_SECRET);
  });
});
