/**
 * AI-powered config inference — `clawhq init --smart`.
 *
 * Re-exports the public API for the inference module.
 */

export { runSmartInit, type SmartInitResult } from "./smart.js";
export { OllamaClient } from "./ollama.js";
export { buildSystemPrompt, buildRefinementPrompt } from "./prompt.js";
export { parseInferenceResponse, formatProposal } from "./parser.js";
export { refineProposal } from "./refine.js";
export type {
  InferenceResult,
  SmartInitOptions,
  OllamaMessage,
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaTagsResponse,
} from "./types.js";
