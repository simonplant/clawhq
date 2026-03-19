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
