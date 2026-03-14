/**
 * Himalaya email client config generator.
 *
 * Detects email provider from address domain and generates
 * a TOML configuration file for himalaya with IMAP/SMTP settings.
 */

export interface ProviderSettings {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

const DOMAIN_TO_PROVIDER: Record<string, string> = {
  "icloud.com": "icloud",
  "me.com": "icloud",
  "mac.com": "icloud",
  "gmail.com": "google",
  "googlemail.com": "google",
  "outlook.com": "microsoft",
  "hotmail.com": "microsoft",
  "live.com": "microsoft",
  "yahoo.com": "yahoo",
  "ymail.com": "yahoo",
  "fastmail.com": "fastmail",
  "proton.me": "proton",
  "protonmail.com": "proton",
};

const PROVIDER_SETTINGS: Record<string, ProviderSettings> = {
  icloud: {
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
  },
  google: {
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
  },
  microsoft: {
    imapHost: "outlook.office365.com",
    imapPort: 993,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
  },
  yahoo: {
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 587,
  },
  fastmail: {
    imapHost: "imap.fastmail.com",
    imapPort: 993,
    smtpHost: "smtp.fastmail.com",
    smtpPort: 587,
  },
  proton: {
    imapHost: "127.0.0.1",
    imapPort: 1143,
    smtpHost: "127.0.0.1",
    smtpPort: 1025,
  },
};

/**
 * Detect email provider from an email address.
 * Returns the provider key (e.g. "icloud", "google") or null if unknown.
 */
export function detectProvider(email: string): string | null {
  const atIndex = email.lastIndexOf("@");
  if (atIndex === -1) return null;

  const domain = email.slice(atIndex + 1).toLowerCase().trim();
  return DOMAIN_TO_PROVIDER[domain] ?? null;
}

/**
 * Get IMAP/SMTP settings for a known provider key.
 * Returns undefined if the provider is not recognized.
 */
export function getProvider(key: string): ProviderSettings | undefined {
  return PROVIDER_SETTINGS[key];
}

export interface HimalayaConfigOptions {
  accountName: string;
  email: string;
  provider: string;
  passwordEnvVar: string;
}

/**
 * Generate a himalaya TOML config file for the given email account.
 *
 * Uses printenv-based password retrieval so the actual credential
 * is never stored in the config file — it comes from the container's
 * environment variables at runtime.
 */
export function generateHimalayaConfig(options: HimalayaConfigOptions): string {
  const { accountName, email, provider, passwordEnvVar } = options;
  const settings = PROVIDER_SETTINGS[provider];

  if (!settings) {
    throw new Error(`Unknown email provider: ${provider}`);
  }

  const encryption = provider === "proton" ? "none" : "tls";
  const smtpEncryption = provider === "proton" ? "none" : "start-tls";

  const lines = [
    `[accounts.${accountName}]`,
    "default = true",
    `email = "${email}"`,
    "",
    `passwd.cmd = "printenv ${passwordEnvVar}"`,
    "",
    "backend.type = \"imap\"",
    `backend.host = "${settings.imapHost}"`,
    `backend.port = ${settings.imapPort}`,
    `backend.encryption = "${encryption}"`,
    "backend.login = \"email\"",
    "",
    "message.send.backend.type = \"smtp\"",
    `message.send.backend.host = "${settings.smtpHost}"`,
    `message.send.backend.port = ${settings.smtpPort}`,
    `message.send.backend.encryption = "${smtpEncryption}"`,
    "message.send.backend.login = \"email\"",
    "",
  ];

  return lines.join("\n");
}
