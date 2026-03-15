/**
 * ChatGPT export ZIP parser.
 *
 * Parses the ZIP file exported from ChatGPT (Settings → Export).
 * The ZIP contains a `conversations.json` file with the full conversation history.
 * Uses `unzip` subprocess for extraction (consistent with project patterns for
 * system-level tools like GPG, tar, docker).
 */

import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ChatGPTConversation, ChatGPTMessage, ParseResult } from "./types.js";
import { MigrateError } from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * Extract a ZIP file to a temporary directory and return the path.
 */
async function extractZip(zipPath: string): Promise<string> {
  const extractDir = join(tmpdir(), `clawhq-migrate-${Date.now()}`);

  try {
    await execFileAsync("unzip", ["-o", "-q", zipPath, "-d", extractDir]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new MigrateError(
      `Failed to extract ZIP file: ${msg}`,
      "ZIP_EXTRACT_FAILED",
    );
  }

  return extractDir;
}

/**
 * Extract ordered messages from a ChatGPT conversation's mapping structure.
 * The mapping is a tree; we walk it to produce a flat, time-ordered list.
 */
export function extractMessages(
  mapping: Record<string, { message: ChatGPTMessage | null }>,
): ChatGPTMessage[] {
  const messages: ChatGPTMessage[] = [];

  for (const node of Object.values(mapping)) {
    if (node.message && node.message.content?.parts?.length > 0) {
      const parts = node.message.content.parts.filter(
        (p): p is string => typeof p === "string" && p.trim().length > 0,
      );
      if (parts.length > 0) {
        messages.push(node.message);
      }
    }
  }

  // Sort by create_time (nulls last)
  messages.sort((a, b) => (a.create_time ?? Infinity) - (b.create_time ?? Infinity));
  return messages;
}

/**
 * Concatenate user messages from conversations into text blocks
 * suitable for extraction. Groups by conversation.
 */
export function buildConversationTexts(
  conversations: ChatGPTConversation[],
): { title: string; text: string }[] {
  const results: { title: string; text: string }[] = [];

  for (const conv of conversations) {
    const messages = extractMessages(conv.mapping);
    const userMessages = messages
      .filter((m) => m.author.role === "user")
      .map((m) => m.content.parts.join("\n"))
      .filter((t) => t.length > 0);

    if (userMessages.length > 0) {
      results.push({
        title: conv.title,
        text: userMessages.join("\n\n"),
      });
    }
  }

  return results;
}

/**
 * Parse a ChatGPT export ZIP file.
 *
 * Extracts the ZIP, reads conversations.json, and returns parsed conversations
 * with message counts.
 */
export async function parseExport(zipPath: string): Promise<ParseResult> {
  const extractDir = await extractZip(zipPath);

  try {
    const conversationsPath = join(extractDir, "conversations.json");
    let raw: string;

    try {
      raw = await readFile(conversationsPath, "utf-8");
    } catch {
      throw new MigrateError(
        "conversations.json not found in export ZIP",
        "MISSING_CONVERSATIONS_JSON",
      );
    }

    let conversations: ChatGPTConversation[];
    try {
      conversations = JSON.parse(raw) as ChatGPTConversation[];
    } catch {
      throw new MigrateError(
        "conversations.json is not valid JSON",
        "INVALID_CONVERSATIONS_JSON",
      );
    }

    if (!Array.isArray(conversations)) {
      throw new MigrateError(
        "conversations.json is not an array",
        "INVALID_CONVERSATIONS_FORMAT",
      );
    }

    let totalMessages = 0;
    let userMessageCount = 0;
    let assistantMessageCount = 0;

    for (const conv of conversations) {
      const messages = extractMessages(conv.mapping);
      totalMessages += messages.length;
      userMessageCount += messages.filter((m) => m.author.role === "user").length;
      assistantMessageCount += messages.filter((m) => m.author.role === "assistant").length;
    }

    return {
      conversations,
      totalMessages,
      userMessageCount,
      assistantMessageCount,
    };
  } finally {
    // Clean up temp directory
    await rm(extractDir, { recursive: true, force: true }).catch(() => {});
  }
}
