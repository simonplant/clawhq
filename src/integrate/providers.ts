/**
 * Integration provider definitions.
 *
 * Each category has one or more providers. The first provider in each
 * category is the default. Provider definitions include the env var,
 * prompt label, and egress domains needed for firewall allowlisting.
 */

import type { IntegrationCategoryDef } from "./types.js";

export const INTEGRATION_CATEGORIES: IntegrationCategoryDef[] = [
  {
    category: "messaging",
    label: "Messaging",
    providers: [
      {
        provider: "telegram",
        label: "Telegram",
        envVar: "TELEGRAM_BOT_TOKEN",
        promptLabel: "Telegram bot token",
        egressDomains: ["api.telegram.org"],
      },
      {
        provider: "whatsapp",
        label: "WhatsApp",
        envVar: "WHATSAPP_API_TOKEN",
        promptLabel: "WhatsApp API token",
        egressDomains: ["graph.facebook.com"],
      },
    ],
  },
  {
    category: "email",
    label: "Email",
    providers: [
      {
        provider: "imap",
        label: "IMAP",
        envVar: "EMAIL_PASSWORD",
        promptLabel: "Email app password",
        egressDomains: [],
      },
    ],
  },
  {
    category: "calendar",
    label: "Calendar",
    providers: [
      {
        provider: "caldav",
        label: "CalDAV",
        envVar: "CALDAV_PASSWORD",
        promptLabel: "CalDAV password",
        egressDomains: [],
      },
      {
        provider: "google-calendar",
        label: "Google Calendar",
        envVar: "GOOGLE_CALENDAR_TOKEN",
        promptLabel: "Google Calendar OAuth token",
        egressDomains: ["www.googleapis.com", "oauth2.googleapis.com"],
      },
      {
        provider: "icloud",
        label: "iCloud Calendar",
        envVar: "ICLOUD_APP_PASSWORD",
        promptLabel: "iCloud app-specific password",
        egressDomains: ["caldav.icloud.com"],
      },
    ],
  },
  {
    category: "tasks",
    label: "Tasks",
    providers: [
      {
        provider: "todoist",
        label: "Todoist",
        envVar: "TODOIST_API_KEY",
        promptLabel: "Todoist API key",
        egressDomains: ["api.todoist.com"],
      },
    ],
  },
  {
    category: "code",
    label: "Code",
    providers: [
      {
        provider: "github",
        label: "GitHub",
        envVar: "GITHUB_TOKEN",
        promptLabel: "GitHub personal access token",
        egressDomains: ["api.github.com"],
      },
    ],
  },
  {
    category: "research",
    label: "Research",
    providers: [
      {
        provider: "tavily",
        label: "Tavily",
        envVar: "TAVILY_API_KEY",
        promptLabel: "Tavily API key",
        egressDomains: ["api.tavily.com"],
      },
    ],
  },
];

/**
 * Find a category definition by name.
 */
export function findCategory(category: string): IntegrationCategoryDef | undefined {
  return INTEGRATION_CATEGORIES.find((c) => c.category === category);
}

/**
 * Find a provider within a category.
 */
export function findProvider(
  category: string,
  providerName: string,
): IntegrationCategoryDef["providers"][number] | undefined {
  const cat = findCategory(category);
  if (!cat) return undefined;
  return cat.providers.find((p) => p.provider === providerName);
}

/**
 * Get all egress domains for a set of configured integrations.
 */
export function getIntegrationEgressDomains(
  integrations: Array<{ category: string; provider: string }>,
): string[] {
  const domains = new Set<string>();
  for (const int of integrations) {
    const provider = findProvider(int.category, int.provider);
    if (provider) {
      for (const d of provider.egressDomains) {
        domains.add(d);
      }
    }
  }
  return [...domains];
}
