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
    egressDomains: [],  // dynamic — depends on IMAP/SMTP host
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
