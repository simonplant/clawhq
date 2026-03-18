/**
 * Natural-language explanation generator — converts a decision trace
 * into a user-friendly explanation citing specific rules and preferences.
 *
 * Uses local LLM (Ollama) when available. Falls back to a structured
 * template-based explanation when the LLM is unreachable.
 */

import { OllamaClient } from "../../design/inference/ollama.js";

import type {
  DecisionEntry,
  Explanation,
  ExplanationCitation,
} from "./types.js";

const EXPLAIN_PROMPT = `You are explaining an AI agent's decision to the user who asked "why did you do that?"

Given a decision record, generate a clear, friendly explanation in 2-4 sentences that:
1. States what the agent did
2. Explains WHY, citing the specific rules and preferences that drove it
3. References the source files (e.g., USER.md, AGENTS.md) where those rules come from

Be conversational but specific. Always cite the source of each rule or preference.

Output ONLY the explanation text, no JSON or markdown formatting.`;

/**
 * Generate a natural-language explanation for a decision entry using local LLM.
 */
export async function explainWithLLM(
  entry: DecisionEntry,
  chain: DecisionEntry[],
  ollamaHost: string,
  ollamaModel: string,
): Promise<Explanation> {
  const client = new OllamaClient(ollamaHost, ollamaModel);

  const decisionContext = formatDecisionForLLM(entry, chain);

  const response = await client.chat([
    { role: "system", content: EXPLAIN_PROMPT },
    { role: "user", content: decisionContext },
  ]);

  const citations = extractCitations(entry);

  return {
    decisionId: entry.id,
    text: response.trim(),
    citations,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generate a template-based explanation (fallback when LLM unavailable).
 */
export function explainWithTemplate(
  entry: DecisionEntry,
  chain: DecisionEntry[],
): Explanation {
  const citations = extractCitations(entry);
  const text = buildTemplateExplanation(entry, chain);

  return {
    decisionId: entry.id,
    text,
    citations,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generate an explanation, trying LLM first with template fallback.
 */
export async function explain(
  entry: DecisionEntry,
  chain: DecisionEntry[],
  ollamaHost: string,
  ollamaModel: string,
): Promise<{ explanation: Explanation; method: "llm" | "template" }> {
  const client = new OllamaClient(ollamaHost, ollamaModel);
  const available = await client.isAvailable();

  if (available) {
    try {
      const explanation = await explainWithLLM(entry, chain, ollamaHost, ollamaModel);
      return { explanation, method: "llm" };
    } catch {
      // Fall through to template
    }
  }

  const explanation = explainWithTemplate(entry, chain);
  return { explanation, method: "template" };
}

/**
 * Format a decision entry and its chain for the LLM prompt.
 */
function formatDecisionForLLM(entry: DecisionEntry, chain: DecisionEntry[]): string {
  const parts: string[] = [];

  if (chain.length > 1) {
    parts.push("Decision chain (context):");
    for (const step of chain) {
      if (step.id === entry.id) continue;
      parts.push(`  - [${step.actionType}] ${step.summary} → ${step.outcome}`);
    }
    parts.push("");
  }

  parts.push(`Decision: ${entry.summary}`);
  parts.push(`Action type: ${entry.actionType}`);
  parts.push(`Outcome: ${entry.outcome}`);
  parts.push("");
  parts.push("Factors that influenced this decision:");

  for (const factor of entry.factors) {
    parts.push(`  - [${factor.kind}] from ${factor.source}: "${factor.content}" (weight: ${factor.weight})`);
  }

  return parts.join("\n");
}

/**
 * Build a structured template-based explanation.
 */
function buildTemplateExplanation(
  entry: DecisionEntry,
  chain: DecisionEntry[],
): string {
  const parts: string[] = [];

  parts.push(`I ${entry.summary.toLowerCase()}.`);

  const rules = entry.factors.filter((f) => f.kind === "rule");
  const preferences = entry.factors.filter((f) => f.kind === "preference");
  const context = entry.factors.filter((f) => f.kind === "context");

  if (rules.length > 0) {
    const ruleTexts = rules.map((r) => `"${r.content}" (from ${r.source})`);
    parts.push(`This was based on ${rules.length === 1 ? "the rule" : "the rules"}: ${ruleTexts.join("; ")}.`);
  }

  if (preferences.length > 0) {
    const prefTexts = preferences.map((p) => `"${p.content}" (from ${p.source})`);
    parts.push(`Your ${preferences.length === 1 ? "preference" : "preferences"} played a role: ${prefTexts.join("; ")}.`);
  }

  if (context.length > 0) {
    const ctxTexts = context.map((c) => c.content);
    parts.push(`Additional context: ${ctxTexts.join("; ")}.`);
  }

  if (chain.length > 1) {
    const parentSummaries = chain
      .filter((c) => c.id !== entry.id)
      .map((c) => c.summary.toLowerCase());
    parts.push(`This was part of a sequence that started with: ${parentSummaries.join(", then ")}.`);
  }

  return parts.join(" ");
}

/**
 * Extract citations from a decision entry's factors.
 */
function extractCitations(entry: DecisionEntry): ExplanationCitation[] {
  return entry.factors
    .filter((f) => f.kind === "rule" || f.kind === "preference")
    .map((f) => ({
      source: f.source,
      content: f.content,
      kind: f.kind,
    }));
}
