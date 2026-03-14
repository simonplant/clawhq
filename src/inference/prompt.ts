/**
 * System prompt construction for AI-powered config inference.
 *
 * Builds a prompt that teaches the LLM about available templates,
 * operational dimensions, and the expected JSON output format.
 */

import type { TemplateChoice } from "../init/types.js";

/**
 * Build the system prompt that instructs the LLM how to map
 * a user's plain-language description to a config proposal.
 */
export function buildSystemPrompt(templates: TemplateChoice[]): string {
  const templateDescriptions = templates
    .map(
      (t) =>
        `- id: "${t.id}" | name: "${t.name}" | use case: ${t.useCase} | ` +
        `security: ${t.security.posture} | autonomy: ${t.autonomy.default} | ` +
        `required integrations: ${t.integrationsRequired.join(", ")} | ` +
        `recommended integrations: ${t.integrationsRecommended.join(", ")}`,
    )
    .join("\n");

  return `You are the ClawHQ config inference engine. Your job is to understand what the user wants from their personal AI agent and map it to a structured configuration.

## Available Templates

${templateDescriptions}

## Available Integrations

- messaging: Telegram bot for user communication (always required)
- email: IMAP email access for triage and drafting
- calendar: CalDAV calendar management
- tasks: Todoist task tracking
- code: GitHub integration
- research: Tavily web research API

## Available Cloud Providers

- anthropic: Anthropic Claude API
- openai: OpenAI GPT API

## Task Categories for Cloud Opt-In

- email: Email triage and drafting
- calendar: Calendar management
- research: Web research and synthesis
- writing: Creative and professional writing
- coding: Code generation and review

## Autonomy Levels

- low: Agent asks before most actions
- medium: Agent handles routine tasks, asks for important ones
- high: Agent acts autonomously on most tasks, asks only for high-stakes

## Your Task

Given the user's description of what they want, respond with ONLY a JSON object (no markdown, no explanation) with this exact structure:

{
  "templateId": "<best matching template id>",
  "agentName": "<suggested agent name, lowercase, no spaces>",
  "timezone": "<inferred IANA timezone or 'UTC'>",
  "wakingHoursStart": "<HH:MM format, e.g. '07:00'>",
  "wakingHoursEnd": "<HH:MM format, e.g. '23:00'>",
  "integrations": ["<list of integration categories the user needs>"],
  "autonomyLevel": "<low|medium|high>",
  "boundaries": ["<list of things the agent should NOT do>"],
  "cloudProviders": ["<list of cloud provider ids, empty for local-only>"],
  "cloudCategories": ["<task categories allowed to use cloud, empty for local-only>"]
}

Rules:
- Always include "messaging" in integrations
- Default to local-only (empty cloudProviders) unless the user explicitly wants cloud AI
- Infer timezone from context clues (city mentions, etc.) or default to UTC
- Keep agentName short and relevant (e.g. "jarvis", "friday", "atlas")
- If the user mentions privacy concerns, prefer paranoid/hardened templates and empty cloudProviders
- If the user mentions specific services (email, calendar, etc.), include those integrations
- Boundaries should reflect what the user explicitly says the agent should NOT do`;
}

/**
 * Build a refinement prompt that instructs the LLM to update the config
 * based on a user's adjustment request.
 */
export function buildRefinementPrompt(
  currentConfig: string,
  userAdjustment: string,
): string {
  return `The current config proposal is:

${currentConfig}

The user wants to adjust: "${userAdjustment}"

Respond with ONLY the updated JSON object (same structure as before). Apply the user's adjustment while keeping everything else the same.`;
}
