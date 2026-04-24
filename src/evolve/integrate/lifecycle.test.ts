/**
 * Regression tests for the multi-provider + slot handling in
 * `clawhq integrate add`. Prior to this, `integrate add email` wrote
 * `providers.email = "email"` to clawhq.yaml, which isn't a valid catalog
 * provider id — the downstream compile resolved no providers and emitted
 * an empty himalaya config. These tests lock in the new contract:
 *
 * - multi-provider domains (email, calendar) reject generic adds,
 * - providerId must resolve in the catalog and match the domain,
 * - slot N writes prefixed env vars and records `email-<N>` in composition.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { addIntegration, removeIntegrationCmd } from "./lifecycle.js";

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "clawhq-integrate-test-"));
  mkdirSync(join(testDir, "engine"), { recursive: true });
  // Minimum clawhq.yaml the updater expects — a composition object.
  writeFileSync(
    join(testDir, "clawhq.yaml"),
    yamlStringify({ version: "0.1.0", composition: { profile: "life-ops" } }),
  );
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("addIntegration — multi-provider domains", () => {
  it("rejects `email` without --provider", async () => {
    const result = await addIntegration({
      deployDir: testDir,
      name: "email",
      credentials: {},
      skipValidation: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/multiple providers/i);
    expect(result.error).toMatch(/--provider/);
    // No providers written — the bug this test locks down is `providers.email = "email"`.
    const yaml = yamlParse(readFileSync(join(testDir, "clawhq.yaml"), "utf-8")) as {
      composition?: { providers?: Record<string, string> };
    };
    expect(yaml.composition?.providers).toBeUndefined();
  });

  it("rejects an unknown providerId", async () => {
    const result = await addIntegration({
      deployDir: testDir,
      name: "email",
      providerId: "not-a-real-provider",
      credentials: {},
      skipValidation: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown provider/);
  });

  it("rejects a provider from a different domain", async () => {
    // `todoist` is a valid catalog provider id, but its domain is "tasks", not "email".
    const result = await addIntegration({
      deployDir: testDir,
      name: "email",
      providerId: "todoist",
      credentials: {},
      skipValidation: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/serves domain "tasks", not "email"/);
  });

  it("writes a valid provider id to composition.providers for primary slot", async () => {
    const result = await addIntegration({
      deployDir: testDir,
      name: "email",
      providerId: "icloud",
      credentials: {
        IMAP_HOST: "imap.mail.me.com",
        IMAP_USER: "me@icloud.com",
        IMAP_PASS: "app-specific-password",
        SMTP_HOST: "smtp.mail.me.com",
        SMTP_USER: "me@icloud.com",
        SMTP_PASS: "app-specific-password",
      },
      skipValidation: true,
    });
    expect(result.success).toBe(true);

    const yaml = yamlParse(readFileSync(join(testDir, "clawhq.yaml"), "utf-8")) as {
      composition?: { providers?: Record<string, string> };
    };
    expect(yaml.composition?.providers).toEqual({ email: "icloud" });

    // Primary slot → env vars written without prefix (IMAP_HOST, not EMAIL_IMAP_HOST).
    const env = readFileSync(join(testDir, "engine", ".env"), "utf-8");
    expect(env).toMatch(/^IMAP_HOST=imap\.mail\.me\.com$/m);
    expect(env).toMatch(/^IMAP_USER=me@icloud\.com$/m);
    expect(env).not.toMatch(/EMAIL_IMAP_HOST/); // no prefix for primary
  });

  it("writes EMAIL_2_ prefix and email-2 domain key for --slot 2", async () => {
    const result = await addIntegration({
      deployDir: testDir,
      name: "email",
      providerId: "gmail",
      slot: 2,
      credentials: {
        IMAP_HOST: "imap.gmail.com",
        IMAP_USER: "user@gmail.com",
        IMAP_PASS: "app-password",
        SMTP_HOST: "smtp.gmail.com",
        SMTP_USER: "user@gmail.com",
        SMTP_PASS: "app-password",
      },
      skipValidation: true,
    });
    expect(result.success).toBe(true);
    expect(result.integrationName).toBe("email-2");

    const yaml = yamlParse(readFileSync(join(testDir, "clawhq.yaml"), "utf-8")) as {
      composition?: { providers?: Record<string, string> };
    };
    expect(yaml.composition?.providers).toEqual({ "email-2": "gmail" });

    const env = readFileSync(join(testDir, "engine", ".env"), "utf-8");
    expect(env).toMatch(/^EMAIL_2_IMAP_HOST=imap\.gmail\.com$/m);
    expect(env).toMatch(/^EMAIL_2_IMAP_USER=user@gmail\.com$/m);
    // Primary-slot keys must not appear for a slot-2 add.
    expect(env).not.toMatch(/^IMAP_HOST=/m);
  });

  it("allows primary + slot-2 to coexist on the same deployment", async () => {
    await addIntegration({
      deployDir: testDir,
      name: "email",
      providerId: "icloud",
      credentials: { IMAP_HOST: "imap.mail.me.com", IMAP_USER: "a@icloud.com", IMAP_PASS: "x", SMTP_HOST: "smtp.mail.me.com", SMTP_USER: "a@icloud.com", SMTP_PASS: "x" },
      skipValidation: true,
    });
    const second = await addIntegration({
      deployDir: testDir,
      name: "email",
      providerId: "gmail",
      slot: 2,
      credentials: { IMAP_HOST: "imap.gmail.com", IMAP_USER: "b@gmail.com", IMAP_PASS: "y", SMTP_HOST: "smtp.gmail.com", SMTP_USER: "b@gmail.com", SMTP_PASS: "y" },
      skipValidation: true,
    });
    expect(second.success).toBe(true);

    const yaml = yamlParse(readFileSync(join(testDir, "clawhq.yaml"), "utf-8")) as {
      composition?: { providers?: Record<string, string> };
    };
    expect(yaml.composition?.providers).toEqual({ email: "icloud", "email-2": "gmail" });
  });
});

describe("removeIntegrationCmd — composition cleanup", () => {
  it("removes the provider binding from clawhq.yaml alongside the manifest entry", async () => {
    // Pre-fix behaviour: remove cleaned .env + manifest but left
    // composition.providers alone. Next apply would re-emit configuration
    // for the removed provider — on the fail-loud path that's an error,
    // on older paths it was a silent zombie binding.
    await addIntegration({
      deployDir: testDir,
      name: "email",
      providerId: "icloud",
      credentials: {
        IMAP_HOST: "imap.mail.me.com",
        IMAP_USER: "me@icloud.com",
        IMAP_PASS: "secret",
        SMTP_HOST: "smtp.mail.me.com",
        SMTP_USER: "me@icloud.com",
        SMTP_PASS: "secret",
      },
      skipValidation: true,
    });
    const result = await removeIntegrationCmd({ deployDir: testDir, name: "email" });
    expect(result.success).toBe(true);

    const yaml = yamlParse(readFileSync(join(testDir, "clawhq.yaml"), "utf-8")) as {
      composition?: { providers?: Record<string, string> };
    };
    // composition.providers key dropped entirely once last binding goes.
    expect(yaml.composition?.providers).toBeUndefined();
  });

  it("removes only the targeted slot when multiple are configured", async () => {
    await addIntegration({
      deployDir: testDir,
      name: "email",
      providerId: "icloud",
      credentials: { IMAP_HOST: "imap.mail.me.com", IMAP_USER: "a@icloud.com", IMAP_PASS: "x", SMTP_HOST: "smtp.mail.me.com", SMTP_USER: "a@icloud.com", SMTP_PASS: "x" },
      skipValidation: true,
    });
    await addIntegration({
      deployDir: testDir,
      name: "email",
      providerId: "gmail",
      slot: 2,
      credentials: { IMAP_HOST: "imap.gmail.com", IMAP_USER: "b@gmail.com", IMAP_PASS: "y", SMTP_HOST: "smtp.gmail.com", SMTP_USER: "b@gmail.com", SMTP_PASS: "y" },
      skipValidation: true,
    });

    const result = await removeIntegrationCmd({ deployDir: testDir, name: "email-2" });
    expect(result.success).toBe(true);

    const yaml = yamlParse(readFileSync(join(testDir, "clawhq.yaml"), "utf-8")) as {
      composition?: { providers?: Record<string, string> };
    };
    expect(yaml.composition?.providers).toEqual({ email: "icloud" });
  });
});
