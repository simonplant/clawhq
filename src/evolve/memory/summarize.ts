/**
 * LLM-powered memory summarization via local Ollama.
 *
 * Summarizes memory entries during hot → warm transitions.
 * All inference runs locally — no data leaves the machine.
 * Falls back to truncation if Ollama is unavailable.
 */

import {
  generate,
  isOllamaAvailable,
  OllamaError,
} from "../../design/configure/ollama.js";
import { OLLAMA_DEFAULT_URL } from "../../config/defaults.js";

import type { SummarizeOptions, SummarizeResult } from "./types.js";

// ── Prompt Templates ─────────────────────────────────────────────────────────

const PROMPTS: Record<string, string> = {
  aggressive: `Summarize the following agent memory into 2-3 key bullet points. Keep only the most important facts, decisions, and preferences. Remove all conversational context and filler.

Memory:
{TEXT}

Summary:`,

  balanced: `Summarize the following agent memory, preserving key facts, decisions, user preferences, and action outcomes. Reduce the content to roughly 30% of its original length while keeping all actionable information.

Memory:
{TEXT}

Summary:`,

  conservative: `Summarize the following agent memory, preserving as much detail as possible about facts, decisions, user preferences, action outcomes, and context. Reduce the content to roughly 50% of its original length.

Memory:
{TEXT}

Summary:`,
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Summarize a memory entry using local Ollama.
 *
 * Falls back gracefully if Ollama is unavailable — returns the original
 * text (no data loss). The lifecycle engine will retry on the next run.
 */
export async function summarizeMemory(
  options: SummarizeOptions,
): Promise<SummarizeResult> {
  const { text, strategy } = options;
  const ollamaUrl = options.ollamaUrl ?? OLLAMA_DEFAULT_URL;
  const model = options.model ?? "llama3:8b";

  const originalSize = Buffer.byteLength(text, "utf-8");

  // Skip summarization for very short memories
  if (originalSize < 256) {
    return {
      success: true,
      summary: text,
      originalSize,
      summarySize: originalSize,
    };
  }

  // Check Ollama availability
  const available = await isOllamaAvailable(ollamaUrl);
  if (!available) {
    return {
      success: false,
      originalSize,
      summarySize: originalSize,
      error: "Ollama not available. Memory preserved as-is for next run.",
    };
  }

  const prompt = (PROMPTS[strategy] ?? PROMPTS.balanced).replace(
    "{TEXT}",
    text,
  );

  try {
    const summary = await generate(prompt, {
      baseUrl: ollamaUrl,
      model,
    });

    const summarySize = Buffer.byteLength(summary, "utf-8");

    return {
      success: true,
      summary,
      originalSize,
      summarySize,
    };
  } catch (err) {
    const message =
      err instanceof OllamaError
        ? err.message
        : "Summarization failed unexpectedly";

    return {
      success: false,
      originalSize,
      summarySize: originalSize,
      error: message,
    };
  }
}
