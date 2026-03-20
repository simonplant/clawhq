/**
 * Local Ollama HTTP client for AI-powered config inference.
 *
 * Talks exclusively to localhost — no data leaves the machine.
 * Uses the Ollama REST API: POST /api/generate for text completion.
 */

import { OLLAMA_DEFAULT_MODEL, OLLAMA_DEFAULT_URL, OLLAMA_GENERATE_TIMEOUT_MS, OLLAMA_PROBE_TIMEOUT_MS } from "../../config/defaults.js";

const DEFAULT_MODEL = OLLAMA_DEFAULT_MODEL;

/** Options for the Ollama client. */
export interface OllamaOptions {
  /** Base URL for the Ollama API. */
  readonly baseUrl?: string;

  /** Model to use for inference (default: llama3:8b). */
  readonly model?: string;
}

/** Response from Ollama /api/generate (non-streaming, final response). */
interface OllamaGenerateResponse {
  readonly response: string;
  readonly done: boolean;
}

/**
 * Check if Ollama is reachable on localhost.
 *
 * @returns true if Ollama responds, false otherwise
 */
export async function isOllamaAvailable(
  baseUrl: string = OLLAMA_DEFAULT_URL,
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(OLLAMA_PROBE_TIMEOUT_MS),
    });
    return res.ok;
  } catch (err) {
    console.warn(`[ollama] Availability check failed for ${baseUrl}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * List models available on the local Ollama instance.
 *
 * @returns Array of model names, or empty if Ollama is unreachable
 */
export async function listOllamaModels(
  baseUrl: string = OLLAMA_DEFAULT_URL,
): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(OLLAMA_PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  } catch (err) {
    console.warn(`[ollama] Failed to list models from ${baseUrl}:`, err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Send a prompt to local Ollama and get a text response.
 *
 * @param prompt — The full prompt to send
 * @param options — Ollama connection options
 * @returns The generated text response
 * @throws {OllamaError} if Ollama is unreachable or returns an error
 */
export async function generate(
  prompt: string,
  options: OllamaOptions = {},
): Promise<string> {
  const baseUrl = options.baseUrl ?? OLLAMA_DEFAULT_URL;
  const model = options.model ?? DEFAULT_MODEL;

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0.1, // Low temperature for deterministic inference
        },
      }),
      signal: AbortSignal.timeout(OLLAMA_GENERATE_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new OllamaError(
        `Ollama inference timed out after ${OLLAMA_GENERATE_TIMEOUT_MS / 1000}s. Is the model loaded?`,
      );
    }
    throw new OllamaError(
      `Cannot reach Ollama at ${baseUrl}. Is Ollama running? Start it with: ollama serve`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new OllamaError(
      `Ollama returned ${res.status}: ${body || res.statusText}`,
    );
  }

  const data = (await res.json()) as OllamaGenerateResponse;
  return data.response;
}

/** Ollama client error. */
export class OllamaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaError";
  }
}
