/**
 * Known provider definitions.
 *
 * Built-in registry of API providers with their credentials, domains,
 * and health-check endpoints. Mirrors PROVIDER_DOMAINS from the firewall
 * module but adds credential metadata and test endpoints.
 */

import type { ProviderDefinition } from "./types.js";

/** All known provider definitions. */
export const KNOWN_PROVIDERS: ProviderDefinition[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    category: "llm",
    envVar: "ANTHROPIC_API_KEY",
    keyPattern: "^sk-ant-",
    domains: ["api.anthropic.com"],
    testUrl: "https://api.anthropic.com/v1/messages",
    testMethod: "POST",
    testHeaders: {
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
  },
  {
    id: "openai",
    label: "OpenAI",
    category: "llm",
    envVar: "OPENAI_API_KEY",
    keyPattern: "^sk-",
    domains: ["api.openai.com"],
    testUrl: "https://api.openai.com/v1/models",
    testMethod: "GET",
  },
  {
    id: "google",
    label: "Google AI",
    category: "llm",
    envVar: "GOOGLE_AI_API_KEY",
    keyPattern: "^AI",
    domains: ["generativelanguage.googleapis.com"],
    testUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    testMethod: "GET",
  },
  {
    id: "ollama",
    label: "Ollama",
    category: "local",
    envVar: "OLLAMA_HOST",
    domains: [], // localhost only, no egress needed
    testUrl: "http://localhost:11434/api/tags",
    testMethod: "GET",
  },
  {
    id: "groq",
    label: "Groq",
    category: "llm",
    envVar: "GROQ_API_KEY",
    keyPattern: "^gsk_",
    domains: ["api.groq.com"],
    testUrl: "https://api.groq.com/openai/v1/models",
    testMethod: "GET",
  },
  {
    id: "mistral",
    label: "Mistral",
    category: "llm",
    envVar: "MISTRAL_API_KEY",
    domains: ["api.mistral.ai"],
    testUrl: "https://api.mistral.ai/v1/models",
    testMethod: "GET",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    category: "llm",
    envVar: "OPENROUTER_API_KEY",
    keyPattern: "^sk-or-",
    domains: ["openrouter.ai"],
    testUrl: "https://openrouter.ai/api/v1/models",
    testMethod: "GET",
  },
  {
    id: "tavily",
    label: "Tavily",
    category: "tool",
    envVar: "TAVILY_API_KEY",
    keyPattern: "^tvly-",
    domains: ["api.tavily.com"],
    testUrl: "https://api.tavily.com/search",
    testMethod: "POST",
    testHeaders: {
      "content-type": "application/json",
    },
  },
];

/**
 * Look up a provider definition by id.
 * Returns undefined if not found in the built-in registry.
 */
export function findProvider(id: string): ProviderDefinition | undefined {
  return KNOWN_PROVIDERS.find((p) => p.id === id);
}

/**
 * List all known provider ids.
 */
export function listKnownProviderIds(): string[] {
  return KNOWN_PROVIDERS.map((p) => p.id);
}

/**
 * Get all known providers grouped by category.
 */
export function getProvidersByCategory(): Record<string, ProviderDefinition[]> {
  const grouped: Record<string, ProviderDefinition[]> = {};
  for (const p of KNOWN_PROVIDERS) {
    if (!grouped[p.category]) {
      grouped[p.category] = [];
    }
    grouped[p.category].push(p);
  }
  return grouped;
}
