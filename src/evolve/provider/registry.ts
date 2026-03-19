/**
 * Provider registry — known AI API providers.
 *
 * Providers handle model routing. Each provider has an API key requirement,
 * validation endpoint, and default model configuration.
 */

import type { ProviderDefinition } from "./types.js";

/** All known providers. */
export const PROVIDER_REGISTRY: Record<string, ProviderDefinition> = {
  anthropic: {
    name: "anthropic",
    label: "Anthropic Claude",
    description: "Claude models via Anthropic API",
    requiresApiKey: true,
    envKey: "ANTHROPIC_API_KEY",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-6",
  },
  openai: {
    name: "openai",
    label: "OpenAI",
    description: "GPT models via OpenAI API",
    requiresApiKey: true,
    envKey: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com",
    defaultModel: "gpt-4o",
  },
  ollama: {
    name: "ollama",
    label: "Ollama (Local)",
    description: "Local models via Ollama — air-gapped, zero egress",
    requiresApiKey: false,
    baseUrl: "http://localhost:11434",
    defaultModel: "llama3.2",
  },
};

/** List all known provider names. */
export function availableProviderNames(): string[] {
  return Object.keys(PROVIDER_REGISTRY);
}

/** Look up a provider definition. Returns undefined if not found. */
export function getProviderDef(name: string): ProviderDefinition | undefined {
  return PROVIDER_REGISTRY[name.toLowerCase()];
}
