/**
 * Provider registry — maps capability domains to their provider options.
 *
 * Key insight: provider selection is a credential + egress problem, not a
 * tool problem. The tool wrapper is identical across providers — only the
 * connection details change (server, auth, egress domains).
 *
 * Each provider entry defines:
 * - What env vars it needs (credential configuration)
 * - What egress domains it requires (firewall allowlist)
 * - What binary it uses (Docker image dependency)
 * - What auth method it expects (for credential health probes)
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface ProviderEnvVar {
  /** Env var name (e.g. "IMAP_HOST"). */
  readonly key: string;
  /** Human-readable label for setup wizard. */
  readonly label: string;
  /** Default value (provider-specific). */
  readonly default?: string;
  /** Whether this is a secret (masked in output). */
  readonly secret?: boolean;
}

export interface Provider {
  /** Unique provider ID (e.g. "gmail", "fastmail"). */
  readonly id: string;
  /** Human-readable name. */
  readonly name: string;
  /** Which capability domain this serves. */
  readonly domain: string;
  /** Protocol used (IMAP, JMAP, CalDAV, REST, etc.). */
  readonly protocol: string;
  /** Primary CLI tool used. */
  readonly cli: string;
  /** Required binary dependencies (for Docker build). */
  readonly binaries: readonly string[];
  /** Env vars needed for configuration. */
  readonly envVars: readonly ProviderEnvVar[];
  /** Egress domains for firewall allowlist. */
  readonly egressDomains: readonly string[];
  /** Auth method. */
  readonly auth: "app-password" | "api-key" | "oauth" | "token" | "none";
  /** Setup notes shown during init. */
  readonly setupNotes?: string;
}

// ── Registry ────────────────────────────────────────────────────────────────

export const PROVIDERS: readonly Provider[] = [
  // ── Email ────────────────────────────────────────────────────────────────
  {
    id: "gmail",
    name: "Gmail",
    domain: "email",
    protocol: "IMAP/SMTP",
    cli: "himalaya",
    binaries: ["himalaya"],
    envVars: [
      { key: "IMAP_HOST", label: "IMAP server", default: "imap.gmail.com" },
      { key: "IMAP_USER", label: "Email address" },
      { key: "IMAP_PASS", label: "App Password", secret: true },
      { key: "SMTP_HOST", label: "SMTP server", default: "smtp.gmail.com" },
      { key: "SMTP_USER", label: "Email address" },
      { key: "SMTP_PASS", label: "App Password", secret: true },
    ],
    egressDomains: ["imap.gmail.com", "smtp.gmail.com"],
    auth: "app-password",
    setupNotes: "Generate an App Password at myaccount.google.com → Security → App Passwords. Regular passwords won't work.",
  },
  {
    id: "icloud",
    name: "iCloud Mail",
    domain: "email",
    protocol: "IMAP/SMTP",
    cli: "himalaya",
    binaries: ["himalaya"],
    envVars: [
      { key: "IMAP_HOST", label: "IMAP server", default: "imap.mail.me.com" },
      { key: "IMAP_USER", label: "Apple ID email" },
      { key: "IMAP_PASS", label: "App-specific password", secret: true },
      { key: "SMTP_HOST", label: "SMTP server", default: "smtp.mail.me.com" },
      { key: "SMTP_USER", label: "Apple ID email" },
      { key: "SMTP_PASS", label: "App-specific password", secret: true },
    ],
    egressDomains: ["imap.mail.me.com", "smtp.mail.me.com"],
    auth: "app-password",
    setupNotes: "Generate an app-specific password at appleid.apple.com → Sign-In and Security → App-Specific Passwords.",
  },
  {
    id: "fastmail",
    name: "Fastmail",
    domain: "email",
    protocol: "IMAP/SMTP",
    cli: "himalaya",
    binaries: ["himalaya"],
    envVars: [
      { key: "IMAP_HOST", label: "IMAP server", default: "imap.fastmail.com" },
      { key: "IMAP_USER", label: "Email address" },
      { key: "IMAP_PASS", label: "App Password", secret: true },
      { key: "SMTP_HOST", label: "SMTP server", default: "smtp.fastmail.com" },
      { key: "SMTP_USER", label: "Email address" },
      { key: "SMTP_PASS", label: "App Password", secret: true },
    ],
    egressDomains: ["imap.fastmail.com", "smtp.fastmail.com"],
    auth: "app-password",
    setupNotes: "Generate an App Password at fastmail.com → Settings → Privacy & Security → Integrations → New App Password.",
  },
  {
    id: "fastmail-jmap",
    name: "Fastmail (JMAP)",
    domain: "email",
    protocol: "JMAP",
    cli: "email-fastmail",
    binaries: [],
    envVars: [
      { key: "FASTMAIL_API_TOKEN", label: "API token", secret: true },
    ],
    egressDomains: ["api.fastmail.com", "www.fastmailusercontent.com"],
    auth: "api-key",
    setupNotes: "Generate an API token at fastmail.com → Settings → Privacy & Security → Integrations → API tokens.",
  },
  {
    id: "outlook",
    name: "Outlook / Microsoft 365",
    domain: "email",
    protocol: "IMAP/SMTP",
    cli: "himalaya",
    binaries: ["himalaya"],
    envVars: [
      { key: "IMAP_HOST", label: "IMAP server", default: "outlook.office365.com" },
      { key: "IMAP_USER", label: "Email address" },
      { key: "IMAP_PASS", label: "App Password", secret: true },
      { key: "SMTP_HOST", label: "SMTP server", default: "smtp.office365.com" },
      { key: "SMTP_USER", label: "Email address" },
      { key: "SMTP_PASS", label: "App Password", secret: true },
    ],
    egressDomains: ["outlook.office365.com", "smtp.office365.com"],
    auth: "app-password",
  },
  {
    id: "generic-imap",
    name: "Generic IMAP/SMTP",
    domain: "email",
    protocol: "IMAP/SMTP",
    cli: "himalaya",
    binaries: ["himalaya"],
    envVars: [
      { key: "IMAP_HOST", label: "IMAP server" },
      { key: "IMAP_USER", label: "Username" },
      { key: "IMAP_PASS", label: "Password", secret: true },
      { key: "SMTP_HOST", label: "SMTP server" },
      { key: "SMTP_USER", label: "Username" },
      { key: "SMTP_PASS", label: "Password", secret: true },
    ],
    egressDomains: [],
    auth: "app-password",
    setupNotes: "You'll need to add your IMAP/SMTP server domains to the egress allowlist manually.",
  },

  // ── Calendar ─────────────────────────────────────────────────────────────
  {
    id: "icloud-cal",
    name: "iCloud Calendar",
    domain: "calendar",
    protocol: "CalDAV",
    cli: "curl",
    binaries: [],
    envVars: [
      { key: "CALDAV_URL", label: "CalDAV URL", default: "https://caldav.icloud.com" },
      { key: "CALDAV_USER", label: "Apple ID email" },
      { key: "CALDAV_PASS", label: "App-specific password", secret: true },
    ],
    egressDomains: ["caldav.icloud.com"],
    auth: "app-password",
  },
  {
    id: "google-cal",
    name: "Google Calendar",
    domain: "calendar",
    protocol: "CalDAV",
    cli: "curl",
    binaries: [],
    envVars: [
      { key: "CALDAV_URL", label: "CalDAV URL", default: "https://apidata.googleusercontent.com/caldav/v2" },
      { key: "CALDAV_USER", label: "Google email" },
      { key: "CALDAV_PASS", label: "App Password", secret: true },
    ],
    egressDomains: ["apidata.googleusercontent.com"],
    auth: "app-password",
  },
  {
    id: "fastmail-cal",
    name: "Fastmail Calendar",
    domain: "calendar",
    protocol: "CalDAV",
    cli: "curl",
    binaries: [],
    envVars: [
      { key: "CALDAV_URL", label: "CalDAV URL", default: "https://caldav.fastmail.com" },
      { key: "CALDAV_USER", label: "Email address" },
      { key: "CALDAV_PASS", label: "App Password", secret: true },
    ],
    egressDomains: ["caldav.fastmail.com"],
    auth: "app-password",
  },
  {
    id: "generic-caldav",
    name: "Generic CalDAV",
    domain: "calendar",
    protocol: "CalDAV",
    cli: "curl",
    binaries: [],
    envVars: [
      { key: "CALDAV_URL", label: "CalDAV server URL" },
      { key: "CALDAV_USER", label: "Username" },
      { key: "CALDAV_PASS", label: "Password", secret: true },
    ],
    egressDomains: [],
    auth: "app-password",
  },

  // ── Tasks ────────────────────────────────────────────────────────────────
  {
    id: "todoist",
    name: "Todoist",
    domain: "tasks",
    protocol: "REST",
    cli: "curl",
    binaries: [],
    envVars: [
      { key: "TODOIST_API_KEY", label: "API token", secret: true },
    ],
    egressDomains: ["api.todoist.com"],
    auth: "api-key",
    setupNotes: "Get your API token at todoist.com → Settings → Integrations → Developer.",
  },
  {
    id: "linear",
    name: "Linear",
    domain: "tasks",
    protocol: "GraphQL",
    cli: "curl",
    binaries: [],
    envVars: [
      { key: "LINEAR_API_KEY", label: "API key", secret: true },
    ],
    egressDomains: ["api.linear.app"],
    auth: "api-key",
  },
  {
    id: "github-issues",
    name: "GitHub Issues",
    domain: "tasks",
    protocol: "REST",
    cli: "gh",
    binaries: ["gh"],
    envVars: [
      { key: "GH_TOKEN", label: "GitHub PAT", secret: true },
    ],
    egressDomains: ["api.github.com"],
    auth: "token",
  },

  // ── Research ─────────────────────────────────────────────────────────────
  {
    id: "tavily",
    name: "Tavily",
    domain: "search",
    protocol: "REST",
    cli: "curl",
    binaries: [],
    envVars: [
      { key: "TAVILY_API_KEY", label: "API key", secret: true },
    ],
    egressDomains: ["api.tavily.com"],
    auth: "api-key",
    setupNotes: "Get your API key at app.tavily.com. Free tier: 1,000 searches/month.",
  },
  {
    id: "brave-search",
    name: "Brave Search",
    domain: "search",
    protocol: "REST",
    cli: "curl",
    binaries: [],
    envVars: [
      { key: "BRAVE_API_KEY", label: "API key", secret: true },
    ],
    egressDomains: ["api.search.brave.com"],
    auth: "api-key",
  },
  {
    id: "searxng",
    name: "SearXNG (self-hosted)",
    domain: "search",
    protocol: "REST",
    cli: "curl",
    binaries: [],
    envVars: [
      { key: "SEARXNG_URL", label: "SearXNG instance URL" },
    ],
    egressDomains: [],
    auth: "none",
    setupNotes: "Self-hosted meta-search engine. Maximum sovereignty — no API key, no cloud dependency.",
  },

  // ── Weather ──────────────────────────────────────────────────────────────
  {
    id: "open-meteo",
    name: "Open-Meteo",
    domain: "weather",
    protocol: "REST",
    cli: "curl",
    binaries: [],
    envVars: [],
    egressDomains: ["api.open-meteo.com"],
    auth: "none",
    setupNotes: "Free, no auth, global coverage. The sovereign default.",
  },

  // ── Code/Dev ─────────────────────────────────────────────────────────────
  {
    id: "github",
    name: "GitHub",
    domain: "code",
    protocol: "REST/GraphQL",
    cli: "gh",
    binaries: ["gh"],
    envVars: [
      { key: "GH_TOKEN", label: "GitHub PAT", secret: true },
    ],
    egressDomains: ["api.github.com", "github.com"],
    auth: "token",
  },

  // ── LLM Models ──────────────────────────────────────────────────────────
  {
    id: "ollama-local",
    name: "Ollama (Local)",
    domain: "models",
    protocol: "REST",
    cli: "curl",
    binaries: [],
    envVars: [],
    egressDomains: [],
    auth: "none",
    setupNotes: "Local inference via Ollama. No data leaves your machine. Install: ollama.ai. Pull a model: ollama pull gemma4:26b",
  },
  {
    id: "anthropic-api",
    name: "Anthropic API (PAYG)",
    domain: "models",
    protocol: "REST",
    cli: "curl",
    binaries: [],
    envVars: [
      { key: "ANTHROPIC_API_KEY", label: "Anthropic API key", secret: true },
    ],
    egressDomains: ["api.anthropic.com"],
    auth: "api-key",
    setupNotes: "Pay-as-you-go API access. Get your key at console.anthropic.com. Note: Claude subscription keys are NOT supported for OpenClaw — API billing only.",
  },
  {
    id: "google-ai",
    name: "Google AI (Gemini API)",
    domain: "models",
    protocol: "REST",
    cli: "curl",
    binaries: [],
    envVars: [
      { key: "GOOGLE_AI_API_KEY", label: "Google AI API key", secret: true },
    ],
    egressDomains: ["generativelanguage.googleapis.com"],
    auth: "api-key",
    setupNotes: "Get your API key at aistudio.google.com. Free tier available. Gemini 2.5 Pro recommended.",
  },
  {
    id: "openai-api",
    name: "OpenAI API",
    domain: "models",
    protocol: "REST",
    cli: "curl",
    binaries: [],
    envVars: [
      { key: "OPENAI_API_KEY", label: "OpenAI API key", secret: true },
    ],
    egressDomains: ["api.openai.com"],
    auth: "api-key",
    setupNotes: "Get your API key at platform.openai.com.",
  },
  {
    id: "openrouter",
    name: "OpenRouter (Multi-provider)",
    domain: "models",
    protocol: "REST",
    cli: "curl",
    binaries: [],
    envVars: [
      { key: "OPENROUTER_API_KEY", label: "OpenRouter API key", secret: true },
    ],
    egressDomains: ["openrouter.ai"],
    auth: "api-key",
    setupNotes: "Access 100+ models from one API key. Get your key at openrouter.ai. Useful for model comparison and fallback.",
  },

  // ── Smart Home ───────────────────────────────────────────────────────────
  {
    id: "home-assistant",
    name: "Home Assistant",
    domain: "home",
    protocol: "REST",
    cli: "curl",
    binaries: [],
    envVars: [
      { key: "HA_URL", label: "Home Assistant URL" },
      { key: "HA_TOKEN", label: "Long-lived access token", secret: true },
    ],
    egressDomains: [],
    auth: "token",
    setupNotes: "Create a long-lived access token in HA → Profile → Security. Egress domain is your HA instance URL.",
  },
];

// ── Lookup Helpers ──────────────────────────────────────────────────────────

/** Get all providers for a capability domain. */
export function getProvidersForDomain(domain: string): Provider[] {
  return PROVIDERS.filter((p) => p.domain === domain);
}

/** Get a provider by ID. */
export function getProvider(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Get all unique capability domains. */
export function getDomains(): string[] {
  return [...new Set(PROVIDERS.map((p) => p.domain))];
}

/** Get all unique binary dependencies for a set of provider IDs. */
export function getBinariesForProviders(providerIds: readonly string[]): string[] {
  const binaries = new Set<string>();
  for (const id of providerIds) {
    const provider = getProvider(id);
    if (provider) {
      for (const bin of provider.binaries) {
        binaries.add(bin);
      }
    }
  }
  return [...binaries];
}

/** Get all egress domains for a set of provider IDs. */
export function getEgressForProviders(providerIds: readonly string[]): string[] {
  const domains = new Set<string>();
  for (const id of providerIds) {
    const provider = getProvider(id);
    if (provider) {
      for (const domain of provider.egressDomains) {
        domains.add(domain);
      }
    }
  }
  return [...domains];
}
