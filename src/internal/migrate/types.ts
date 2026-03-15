/**
 * ChatGPT conversation import types.
 *
 * Supports parsing ChatGPT data exports (ZIP with conversations.json),
 * extracting facts/preferences via local LLM, PII masking, and
 * interactive user review before writing to identity/memory files.
 */

/** A single message within a ChatGPT conversation. */
export interface ChatGPTMessage {
  id: string;
  author: { role: "user" | "assistant" | "system" | "tool"; };
  content: { content_type: string; parts: string[]; };
  create_time: number | null;
}

/** A parsed ChatGPT conversation. */
export interface ChatGPTConversation {
  title: string;
  create_time: number;
  update_time: number;
  mapping: Record<string, { message: ChatGPTMessage | null }>;
}

/** Result of parsing a ChatGPT export ZIP. */
export interface ParseResult {
  conversations: ChatGPTConversation[];
  totalMessages: number;
  userMessageCount: number;
  assistantMessageCount: number;
}

/** An extracted fact or preference from conversation history. */
export interface ExtractedItem {
  /** Unique identifier. */
  id: string;
  /** The extracted content (human-readable). */
  content: string;
  /** Category of the extraction. */
  category: "preference" | "fact" | "relationship" | "habit";
  /** Confidence in the extraction. */
  confidence: "high" | "medium" | "low";
  /** Source conversation title(s). */
  sources: string[];
  /** Whether PII was detected and masked. */
  piiMasked: boolean;
}

/** User's decision on an extracted item during review. */
export type ReviewDecision = "approve" | "reject" | "edit";

/** Result of reviewing a single extracted item. */
export interface ReviewedItem {
  item: ExtractedItem;
  decision: ReviewDecision;
  /** Edited content (only when decision is "edit"). */
  editedContent?: string;
}

/** Result of the full migration pipeline. */
export interface MigrateResult {
  parsed: ParseResult;
  extracted: ExtractedItem[];
  reviewed: ReviewedItem[];
  written: {
    userMdEntries: number;
    memoryEntries: number;
  };
}

/** Options for the migrate command. */
export interface MigrateOptions {
  /** Path to the ChatGPT export ZIP file. */
  exportPath: string;
  /** OpenClaw home directory. */
  openclawHome: string;
  /** Ollama API host URL. */
  ollamaHost: string;
  /** Ollama model name. */
  ollamaModel: string;
  /** Maximum token budget for USER.md additions. */
  tokenBudget: number;
}

/** IO interface for interactive review (injectable for testing). */
export interface MigrateIO {
  print(message: string): void;
  prompt(question: string): Promise<string>;
}

export class MigrateError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "MigrateError";
  }
}
