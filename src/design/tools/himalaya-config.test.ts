import { describe, expect, it } from "vitest";

import {
  detectProvider,
  generateHimalayaConfig,
  getProvider,
} from "./himalaya-config.js";

describe("detectProvider", () => {
  it.each([
    ["user@icloud.com", "icloud"],
    ["user@me.com", "icloud"],
    ["user@mac.com", "icloud"],
    ["user@gmail.com", "google"],
    ["user@googlemail.com", "google"],
    ["user@outlook.com", "microsoft"],
    ["user@hotmail.com", "microsoft"],
    ["user@live.com", "microsoft"],
    ["user@yahoo.com", "yahoo"],
    ["user@ymail.com", "yahoo"],
    ["user@fastmail.com", "fastmail"],
    ["user@proton.me", "proton"],
    ["user@protonmail.com", "proton"],
  ])("detects %s as %s", (email, expected) => {
    expect(detectProvider(email)).toBe(expected);
  });

  it("returns null for unknown domains", () => {
    expect(detectProvider("user@example.com")).toBeNull();
    expect(detectProvider("user@custom-domain.org")).toBeNull();
  });

  it("returns null for strings without @", () => {
    expect(detectProvider("not-an-email")).toBeNull();
  });

  it("handles case-insensitive domains", () => {
    expect(detectProvider("user@GMAIL.COM")).toBe("google");
    expect(detectProvider("user@iCloud.Com")).toBe("icloud");
  });

  it("handles emails with subaddressing (plus addressing)", () => {
    expect(detectProvider("user+tag@gmail.com")).toBe("google");
  });

  it("uses the last @ for unusual addresses", () => {
    expect(detectProvider("weird@name@gmail.com")).toBe("google");
  });
});

describe("getProvider", () => {
  it("returns settings for known providers", () => {
    const icloud = getProvider("icloud");
    expect(icloud).toBeDefined();
    expect(icloud?.imapHost).toBe("imap.mail.me.com");
    expect(icloud?.imapPort).toBe(993);
    expect(icloud?.smtpHost).toBe("smtp.mail.me.com");
    expect(icloud?.smtpPort).toBe(587);
  });

  it("returns undefined for unknown provider keys", () => {
    expect(getProvider("unknown")).toBeUndefined();
  });

  it.each(["icloud", "google", "microsoft", "yahoo", "fastmail", "proton"])(
    "has settings for %s",
    (key) => {
      const settings = getProvider(key);
      expect(settings).toBeDefined();
      expect(settings?.imapHost).toBeTruthy();
      expect(settings?.smtpHost).toBeTruthy();
      expect(settings?.imapPort).toBeGreaterThan(0);
      expect(settings?.smtpPort).toBeGreaterThan(0);
    },
  );

  it("proton uses localhost (bridge)", () => {
    const proton = getProvider("proton");
    expect(proton?.imapHost).toBe("127.0.0.1");
    expect(proton?.smtpHost).toBe("127.0.0.1");
    expect(proton?.imapPort).toBe(1143);
    expect(proton?.smtpPort).toBe(1025);
  });
});

describe("generateHimalayaConfig", () => {
  it("generates valid TOML for icloud", () => {
    const config = generateHimalayaConfig({
      accountName: "jarvis",
      email: "user@icloud.com",
      provider: "icloud",
      passwordEnvVar: "EMAIL_APP_PASSWORD",
    });

    expect(config).toContain("[accounts.jarvis]");
    expect(config).toContain("default = true");
    expect(config).toContain('email = "user@icloud.com"');
    expect(config).toContain('passwd.cmd = "printenv EMAIL_APP_PASSWORD"');
    expect(config).toContain('backend.host = "imap.mail.me.com"');
    expect(config).toContain("backend.port = 993");
    expect(config).toContain('backend.encryption = "tls"');
    expect(config).toContain('message.send.backend.host = "smtp.mail.me.com"');
    expect(config).toContain("message.send.backend.port = 587");
    expect(config).toContain('message.send.backend.encryption = "start-tls"');
  });

  it("generates valid TOML for google", () => {
    const config = generateHimalayaConfig({
      accountName: "agent",
      email: "agent@gmail.com",
      provider: "google",
      passwordEnvVar: "GMAIL_APP_PASSWORD",
    });

    expect(config).toContain("[accounts.agent]");
    expect(config).toContain('backend.host = "imap.gmail.com"');
    expect(config).toContain('message.send.backend.host = "smtp.gmail.com"');
  });

  it("uses no encryption for proton (bridge)", () => {
    const config = generateHimalayaConfig({
      accountName: "secure",
      email: "user@proton.me",
      provider: "proton",
      passwordEnvVar: "PROTON_BRIDGE_PASSWORD",
    });

    expect(config).toContain('backend.encryption = "none"');
    expect(config).toContain('message.send.backend.encryption = "none"');
    expect(config).toContain('backend.host = "127.0.0.1"');
    expect(config).toContain("backend.port = 1143");
    expect(config).toContain("message.send.backend.port = 1025");
  });

  it("throws for unknown provider", () => {
    expect(() =>
      generateHimalayaConfig({
        accountName: "test",
        email: "user@example.com",
        provider: "unknown",
        passwordEnvVar: "PASSWORD",
      }),
    ).toThrow("Unknown email provider: unknown");
  });

  it("uses printenv for password retrieval (no secrets in config)", () => {
    const config = generateHimalayaConfig({
      accountName: "test",
      email: "user@yahoo.com",
      provider: "yahoo",
      passwordEnvVar: "YAHOO_APP_PASSWORD",
    });

    expect(config).toContain("printenv YAHOO_APP_PASSWORD");
    expect(config).not.toContain("password");
  });

  it("sets login to email for all providers", () => {
    const config = generateHimalayaConfig({
      accountName: "test",
      email: "user@fastmail.com",
      provider: "fastmail",
      passwordEnvVar: "FM_PASSWORD",
    });

    expect(config).toContain('backend.login = "email"');
    expect(config).toContain('message.send.backend.login = "email"');
  });
});
