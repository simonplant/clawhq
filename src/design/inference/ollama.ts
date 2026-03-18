/**
 * Ollama HTTP API integration for local LLM inference.
 *
 * Communicates with a local Ollama instance to run inference
 * without any cloud dependency.
 */

import type {
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaMessage,
  OllamaTagsResponse,
} from "./types.js";

const DEFAULT_HOST = "http://localhost:11434";
const DEFAULT_MODEL = "llama3:8b";
const CHAT_TIMEOUT_MS = 120_000;
const HEALTH_TIMEOUT_MS = 5_000;

export class OllamaClient {
  private readonly host: string;
  private readonly model: string;

  constructor(host?: string, model?: string) {
    this.host = (host ?? DEFAULT_HOST).replace(/\/$/, "");
    this.model = model ?? DEFAULT_MODEL;
  }

  /** Check if Ollama is reachable and has at least one model. */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.host}/api/tags`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as OllamaTagsResponse;
      return Array.isArray(data.models) && data.models.length > 0;
    } catch {
      return false;
    }
  }

  /** List available model names from the local Ollama instance. */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.host}/api/tags`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as OllamaTagsResponse;
      return (data.models ?? []).map((m) => m.name);
    } catch {
      return [];
    }
  }

  /** Pick the best available model: prefer configured, then largest available. */
  async selectModel(): Promise<string> {
    const models = await this.listModels();
    if (models.length === 0) return this.model;
    if (models.includes(this.model)) return this.model;
    // Prefer the configured model's base name (without tag)
    const baseName = this.model.split(":")[0];
    const match = models.find((m) => m.startsWith(baseName));
    if (match) return match;
    // Fall back to first available
    return models[0];
  }

  /** Send a chat completion request to Ollama. */
  async chat(messages: OllamaMessage[]): Promise<string> {
    const model = await this.selectModel();

    const body: OllamaChatRequest = {
      model,
      messages,
      stream: false,
      options: {
        temperature: 0.3,
        num_predict: 2048,
      },
    };

    const response = await fetch(`${this.host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "unknown error");
      throw new Error(`Ollama API error (${response.status}): ${text}`);
    }

    const data = (await response.json()) as OllamaChatResponse;
    return data.message.content;
  }
}
