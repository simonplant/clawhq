/**
 * Integration registry — known integrations with credential templates.
 *
 * Each entry defines what env keys are needed, which domains to allowlist,
 * and how to validate the connection. New integrations are added here.
 */

import { OLLAMA_DEFAULT_URL } from "../../config/defaults.js";

import type { IntegrationDefinition } from "./types.js";

/** All known integrations. */
export const INTEGRATION_REGISTRY: Record<string, IntegrationDefinition> = {
  email: {
    name: "email",
    label: "Email (IMAP)",
    description: "Email access via IMAP — read, search, triage inbox",
    category: "communication",
    envKeys: [
      { key: "IMAP_HOST", label: "IMAP host", secret: false },
      { key: "IMAP_PORT", label: "IMAP port", secret: false, defaultValue: "993" },
      { key: "IMAP_USER", label: "IMAP username", secret: false },
      { key: "IMAP_PASS", label: "IMAP password", secret: true },
      { key: "SMTP_HOST", label: "SMTP host", secret: false },
      { key: "SMTP_PORT", label: "SMTP port", secret: false, defaultValue: "587" },
      { key: "SMTP_USER", label: "SMTP username", secret: false },
      { key: "SMTP_PASS", label: "SMTP password", secret: true },
    ],
    egressDomains: [],
    dynamicEgressEnvKeys: ["IMAP_HOST", "SMTP_HOST"],
    quirks: [
      "IMAP connections may drop silently — always re-check connection before batch operations",
      "Some providers rate-limit IMAP SEARCH — batch queries, avoid rapid-fire searches",
      "SMTP send failures are silent in some configs — verify send status via IMAP Sent folder",
    ],
  },
  calendar: {
    name: "calendar",
    label: "Calendar (CalDAV)",
    description: "Calendar access via CalDAV — read, create, manage events",
    category: "productivity",
    envKeys: [
      { key: "CALDAV_URL", label: "CalDAV URL", secret: false },
      { key: "CALDAV_USER", label: "CalDAV username", secret: false },
      { key: "CALDAV_PASS", label: "CalDAV password", secret: true },
    ],
    egressDomains: [],
    dynamicEgressEnvKeys: ["CALDAV_URL"],
    quirks: [
      "CalDAV sync can lag 1-5 minutes — re-fetch before confirming availability",
      "Recurring event modifications require updating the entire series or creating an exception",
    ],
  },
  telegram: {
    name: "telegram",
    label: "Telegram Bot",
    description: "Telegram messaging channel for agent communication",
    category: "communication",
    envKeys: [
      { key: "TELEGRAM_BOT_TOKEN", label: "Telegram bot token", secret: true },
      { key: "TELEGRAM_CHAT_ID", label: "Telegram chat ID", secret: false },
    ],
    egressDomains: ["api.telegram.org"],
    quirks: [
      "Messages over 4096 chars are rejected — split long responses",
      "Bot API rate limit: ~30 messages/second globally, 1 message/second per chat",
    ],
  },
  anthropic: {
    name: "anthropic",
    label: "Anthropic Claude",
    description: "Anthropic Claude API for AI model access",
    category: "ai",
    envKeys: [
      { key: "ANTHROPIC_API_KEY", label: "Anthropic API key", secret: true },
    ],
    egressDomains: ["api.anthropic.com"],
    quirks: [
      "API keys have per-minute and per-day token limits — monitor usage to avoid 429 errors",
    ],
  },
  openai: {
    name: "openai",
    label: "OpenAI",
    description: "OpenAI API for AI model access",
    category: "ai",
    envKeys: [
      { key: "OPENAI_API_KEY", label: "OpenAI API key", secret: true },
    ],
    egressDomains: ["api.openai.com"],
    quirks: [
      "API keys have tier-based rate limits — check your tier at platform.openai.com",
    ],
  },
  ollama: {
    name: "ollama",
    label: "Ollama (Local)",
    description: "Local Ollama instance for air-gapped AI model access",
    category: "ai",
    envKeys: [
      { key: "OLLAMA_HOST", label: "Ollama host", secret: false, defaultValue: OLLAMA_DEFAULT_URL },
    ],
    egressDomains: [],
    quirks: [
      "First request after idle loads the model into VRAM — expect 5-30s cold start",
      "Models unload after 5min idle by default — set OLLAMA_KEEP_ALIVE for persistent loading",
    ],
  },
  tavily: {
    name: "tavily",
    label: "Tavily Search",
    description: "Web search API for research and information retrieval",
    category: "data",
    envKeys: [
      { key: "TAVILY_API_KEY", label: "Tavily API key", secret: true },
    ],
    egressDomains: ["api.tavily.com"],
    quirks: [
      "Free tier: 1000 searches/month — use search_depth='basic' for routine queries, 'advanced' only when needed",
    ],
  },
  whatsapp: {
    name: "whatsapp",
    label: "WhatsApp Business",
    description: "WhatsApp Business API for messaging",
    category: "communication",
    envKeys: [
      { key: "WHATSAPP_PHONE_NUMBER_ID", label: "Phone Number ID", secret: false },
      { key: "WHATSAPP_ACCESS_TOKEN", label: "Access Token", secret: true },
    ],
    egressDomains: ["graph.facebook.com"],
    quirks: [
      "Access tokens expire every 24h unless using a System User token",
      "Template messages required for initiating conversations — free-form only within 24h window",
    ],
  },
  onepassword: {
    name: "onepassword",
    label: "1Password Vault",
    description: "Secret retrieval from 1Password vault via service account — read-only, fetch-at-use, never in LLM context",
    category: "security",
    envKeys: [
      { key: "OP_SERVICE_ACCOUNT_TOKEN", label: "1Password service account token", secret: true },
      { key: "OP_VAULT", label: "1Password vault name or ID (optional)", secret: false, defaultValue: "" },
    ],
    egressDomains: ["my.1password.com", "events.1password.com"],
    quirks: [
      "Service account tokens cannot create or modify items — read-only by design",
      "op CLI must be installed in the container — included in ClawHQ base image",
    ],
  },
  github: {
    name: "github",
    label: "GitHub",
    description: "GitHub REST API for repo, issue, PR, and release management",
    category: "productivity",
    envKeys: [
      { key: "GH_TOKEN", label: "GitHub personal access token", secret: true },
    ],
    egressDomains: ["api.github.com"],
    quirks: [
      "Fine-grained PATs scope to specific repos — use repo-level tokens, not classic tokens",
      "REST API rate limit: 5000 req/hour with auth, 60 req/hour without",
    ],
  },
  x: {
    name: "x",
    label: "X/Twitter (read-only)",
    description: "X/Twitter API v2 read-only scanner — search, timeline, user lookup",
    category: "data",
    envKeys: [
      { key: "X_BEARER_TOKEN", label: "X/Twitter API v2 bearer token", secret: true },
    ],
    egressDomains: ["api.twitter.com"],
    quirks: [
      "Free tier: 500K tweets/month read, 10K tweets/month search — monitor usage",
      "Read-only by design — no posting capability in this tool",
    ],
  },
  substack: {
    name: "substack",
    label: "Substack",
    description: "Substack newsletter reader — latest posts, search, full article read",
    category: "data",
    envKeys: [
      { key: "SUBSTACK_COOKIE", label: "Substack session cookie (for paid content)", secret: true },
    ],
    egressDomains: ["substack.com"],
    quirks: [
      "Session cookies expire — re-authenticate periodically for paid content access",
      "Without cookies, only free posts are accessible",
    ],
  },
  homeassistant: {
    name: "homeassistant",
    label: "Home Assistant",
    description: "Home Assistant REST API for smart home control and monitoring",
    category: "data",
    envKeys: [
      { key: "HA_URL", label: "Home Assistant base URL", secret: false },
      { key: "HA_TOKEN", label: "Home Assistant long-lived access token", secret: true },
      { key: "HA_ENTITY_ALLOW", label: "Allowed entity prefixes (comma-separated, optional)", secret: false, defaultValue: "" },
      { key: "HA_ENTITY_DENY", label: "Denied entity prefixes (comma-separated, optional)", secret: false, defaultValue: "" },
    ],
    egressDomains: [],
    dynamicEgressEnvKeys: ["HA_URL"],
    quirks: [
      "Long-lived access tokens do not expire — but can be revoked from the HA UI",
      "Use HA_ENTITY_ALLOW/HA_ENTITY_DENY to restrict which entities the agent can control",
      "call-service is a write operation — consider adding entity prefixes like 'lock.' to HA_ENTITY_DENY",
    ],
  },
  fastmail: {
    name: "fastmail",
    label: "FastMail (JMAP)",
    description: "Email access via FastMail JMAP API — read, search, send, triage",
    category: "communication",
    envKeys: [
      { key: "FASTMAIL_API_TOKEN", label: "FastMail API token (Settings → Privacy & Security → API tokens)", secret: true },
    ],
    egressDomains: ["api.fastmail.com", "www.fastmailusercontent.com"],
    quirks: [
      "JMAP session endpoint must be called first to discover mailbox IDs",
      "Attachment downloads go through fastmailusercontent.com, not api.fastmail.com",
    ],
  },
  tailscale: {
    name: "tailscale",
    label: "Tailscale",
    description: "Secure remote access to the agent via Tailscale mesh VPN — no port forwarding needed",
    category: "security",
    envKeys: [
      { key: "TS_AUTHKEY", label: "Tailscale auth key (Settings → Keys → Generate auth key)", secret: true },
      { key: "TS_HOSTNAME", label: "Tailscale device hostname", secret: false, defaultValue: "clawhq-agent" },
    ],
    egressDomains: ["controlplane.tailscale.com", "login.tailscale.com"],
    quirks: [
      "Auth keys can be single-use or reusable — use reusable for auto-restart resilience",
      "Ephemeral keys auto-remove the device when it goes offline — use non-ephemeral for persistent agents",
      "The agent is accessible at http://<hostname>:18789 from any device on your tailnet",
    ],
  },
};

/** List all known integration names. */
export function availableIntegrationNames(): string[] {
  return Object.keys(INTEGRATION_REGISTRY);
}

/** Look up an integration definition. Returns undefined if not found. */
export function getIntegrationDef(name: string): IntegrationDefinition | undefined {
  return INTEGRATION_REGISTRY[name.toLowerCase()];
}

/**
 * Get operational quirks for a tool category.
 *
 * Maps tool categories (e.g. "email", "calendar") to integration registry
 * quirks. Returns empty array if no quirks are known for the category.
 */
export function getQuirksForCategory(category: string): readonly string[] {
  const def = INTEGRATION_REGISTRY[category.toLowerCase()];
  return def?.quirks ?? [];
}
