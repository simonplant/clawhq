/**
 * Types for the AI-powered config inference module (`clawhq init --smart`).
 *
 * The inference engine takes a plain-language description of user needs
 * and produces a structured config proposal that maps to WizardAnswers.
 */

import type { WizardIO } from "../configure/types.js";

/** Raw structured output from the LLM inference. */
export interface InferenceResult {
  templateId: string;
  agentName: string;
  timezone: string;
  wakingHoursStart: string;
  wakingHoursEnd: string;
  integrations: string[];
  autonomyLevel: "low" | "medium" | "high";
  boundaries: string[];
  cloudProviders: string[];
  cloudCategories: string[];
}

/** A single refinement turn from the user. */
export interface RefinementTurn {
  userMessage: string;
  updatedResult: InferenceResult;
}

/** Options for the smart init flow. */
export interface SmartInitOptions {
  io: WizardIO;
  outputDir: string;
  ollamaHost?: string;
  ollamaModel?: string;
  validateCredential?: (envVar: string, value: string) => Promise<boolean>;
}

/** Ollama chat message format. */
export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Ollama /api/chat request body. */
export interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream: false;
  options?: {
    temperature?: number;
    num_predict?: number;
  };
}

/** Ollama /api/chat response body. */
export interface OllamaChatResponse {
  message: OllamaMessage;
  done: boolean;
}

/** Ollama /api/tags response for model listing. */
export interface OllamaTagsResponse {
  models: Array<{
    name: string;
    size: number;
    modified_at: string;
  }>;
}
