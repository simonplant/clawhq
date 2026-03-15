/**
 * ChatGPT conversation import — migrate from ChatGPT to ClawHQ.
 *
 * Parses ChatGPT export ZIPs, extracts facts and preferences via local LLM
 * (with pattern-based fallback), applies PII masking, presents items for
 * interactive user review, and writes approved entries to USER.md and
 * warm memory tier.
 */

export type {
  ChatGPTConversation,
  ChatGPTMessage,
  ExtractedItem,
  MigrateIO,
  MigrateOptions,
  MigrateResult,
  ParseResult,
  ReviewDecision,
  ReviewedItem,
} from "./types.js";
export { MigrateError } from "./types.js";

export { buildConversationTexts, extractMessages, parseExport } from "./parser.js";

export {
  estimateTokens,
  extract,
  extractWithLLM,
  extractWithPatterns,
} from "./extractor.js";

export type { PIIScanResult } from "./pii.js";
export { maskExtractedItems, scanForPII } from "./pii.js";

export { formatItem, reviewItems } from "./review.js";

export {
  appendToUserMd,
  generateUserMdSection,
  writeToWarmMemory,
} from "./writer.js";
