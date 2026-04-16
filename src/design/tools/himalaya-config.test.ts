import { describe, expect, it } from "vitest";

import { PROVIDERS } from "../catalog/providers.js";

import { generateHimalayaConfig } from "./himalaya-config.js";

function get(id: string, domainKey: string) {
  const p = PROVIDERS.find(p => p.id === id);
  if (!p) throw new Error(`provider ${id} missing from catalog`);
  return { ...p, domainKey };
}

describe("generateHimalayaConfig", () => {
  it("returns empty when no himalaya providers", () => {
    expect(generateHimalayaConfig([])).toBe("");
    expect(generateHimalayaConfig([get("fastmail-jmap", "email")])).toBe("");
    expect(generateHimalayaConfig([get("icloud-cal", "calendar")])).toBe("");
  });

  it("emits v1.2 backend syntax for iCloud at primary slot", () => {
    const out = generateHimalayaConfig(
      [get("icloud", "email")],
      {
        IMAP_USER: "me@icloud.com",
        IMAP_HOST: "imap.mail.me.com",
        SMTP_USER: "me@icloud.com",
        SMTP_HOST: "smtp.mail.me.com",
      },
    );
    expect(out).toContain("[accounts.icloud]");
    expect(out).toContain("default = true");
    expect(out).toContain('backend.type = "imap"');
    expect(out).toContain('backend.host = "imap.mail.me.com"');
    expect(out).toContain('backend.login = "me@icloud.com"');
    expect(out).toContain('backend.auth.cmd = "printenv IMAP_PASS"');
    expect(out).toContain('message.send.backend.type = "smtp"');
    expect(out).toContain('message.send.backend.auth.cmd = "printenv SMTP_PASS"');
    // No legacy prefix (primary slot → no prefix)
    expect(out).not.toContain("EMAIL_1_");
    expect(out).not.toContain("[accounts.icloud.imap]");
  });

  it("applies EMAIL_2_ prefix for a secondary slot", () => {
    const out = generateHimalayaConfig(
      [get("icloud", "email-2")],
      {
        EMAIL_2_IMAP_USER: "me@icloud.com",
        EMAIL_2_IMAP_HOST: "imap.mail.me.com",
        EMAIL_2_SMTP_USER: "me@icloud.com",
        EMAIL_2_SMTP_HOST: "smtp.mail.me.com",
      },
    );
    expect(out).toContain('backend.auth.cmd = "printenv EMAIL_2_IMAP_PASS"');
    expect(out).toContain('message.send.backend.auth.cmd = "printenv EMAIL_2_SMTP_PASS"');
    expect(out).toContain('backend.login = "me@icloud.com"');
  });

  it("assigns default only to the first account when multiple himalaya providers present", () => {
    const out = generateHimalayaConfig(
      [get("icloud", "email"), get("gmail", "email-2")],
      {
        IMAP_USER: "a@icloud.com", IMAP_HOST: "imap.mail.me.com",
        SMTP_USER: "a@icloud.com", SMTP_HOST: "smtp.mail.me.com",
        EMAIL_2_IMAP_USER: "b@gmail.com", EMAIL_2_IMAP_HOST: "imap.gmail.com",
        EMAIL_2_SMTP_USER: "b@gmail.com", EMAIL_2_SMTP_HOST: "smtp.gmail.com",
      },
    );
    const defaults = out.match(/default = true/g) ?? [];
    expect(defaults.length).toBe(1);
    expect(out).toContain("[accounts.icloud]");
    expect(out).toContain("[accounts.gmail]");
  });

  it("falls back to provider defaults when env is missing a host entry", () => {
    const out = generateHimalayaConfig([get("icloud", "email")], { IMAP_USER: "me@icloud.com", SMTP_USER: "me@icloud.com" });
    expect(out).toContain('backend.host = "imap.mail.me.com"');
    expect(out).toContain('message.send.backend.host = "smtp.mail.me.com"');
  });
});
