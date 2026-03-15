/**
 * Write approved migration items to USER.md and warm memory tier.
 *
 * Appends extracted preferences/facts to the USER.md identity file
 * and writes structured entries to the warm memory tier. Respects
 * token budgets for identity files.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { writeEntry } from "../memory/store.js";
import type { PreferenceEntry, ContextEntry, RelationshipEntry } from "../memory/types.js";

import type { ReviewedItem } from "./types.js";
import { MigrateError } from "./types.js";

/** Default max chars for USER.md (aligned with bootstrapMaxChars). */
const DEFAULT_MAX_CHARS = 20_000;

/**
 * Get the effective content for a reviewed item.
 */
function getContent(reviewed: ReviewedItem): string {
  if (reviewed.decision === "edit" && reviewed.editedContent) {
    return reviewed.editedContent;
  }
  return reviewed.item.content;
}

/**
 * Generate USER.md section content from approved items.
 */
export function generateUserMdSection(items: ReviewedItem[]): string {
  const approved = items.filter(
    (r) => r.decision === "approve" || r.decision === "edit",
  );

  if (approved.length === 0) return "";

  const lines: string[] = [
    "",
    "## Imported from ChatGPT",
    "",
    "_Extracted from conversation history and reviewed by user._",
    "",
  ];

  const byCategory = new Map<string, ReviewedItem[]>();
  for (const item of approved) {
    const cat = item.item.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    const catList = byCategory.get(cat);
    if (catList) catList.push(item);
  }

  const categoryOrder = ["preference", "fact", "habit", "relationship"] as const;
  const categoryHeaders: Record<string, string> = {
    preference: "### Preferences",
    fact: "### Facts",
    habit: "### Habits",
    relationship: "### Relationships",
  };

  for (const cat of categoryOrder) {
    const catItems = byCategory.get(cat);
    if (!catItems || catItems.length === 0) continue;

    lines.push(categoryHeaders[cat]);
    lines.push("");
    for (const reviewed of catItems) {
      lines.push(`- ${getContent(reviewed)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Append imported content to USER.md, respecting token budget.
 * Creates the file if it doesn't exist.
 */
export async function appendToUserMd(
  openclawHome: string,
  items: ReviewedItem[],
  maxChars: number = DEFAULT_MAX_CHARS,
): Promise<number> {
  const approved = items.filter(
    (r) => r.decision === "approve" || r.decision === "edit",
  );

  if (approved.length === 0) return 0;

  const home = openclawHome.replace(/^~/, process.env.HOME ?? "~");
  const userMdPath = join(home, "workspace", "USER.md");

  let existing = "";
  try {
    existing = await readFile(userMdPath, "utf-8");
  } catch {
    // File doesn't exist — will create
  }

  const section = generateUserMdSection(items);
  const combined = existing + section;

  // Enforce token budget
  if (combined.length > maxChars) {
    // Trim the section to fit
    const available = maxChars - existing.length;
    if (available <= 0) {
      throw new MigrateError(
        `USER.md already at token budget (${existing.length}/${maxChars} chars). Cannot append imported data.`,
        "TOKEN_BUDGET_EXCEEDED",
      );
    }

    const trimmedSection = section.slice(0, available);
    await writeFile(userMdPath, existing + trimmedSection, "utf-8");

    // Count how many items fit (approximate)
    const written = trimmedSection.split("\n- ").length - 1;
    return Math.max(0, written);
  }

  await writeFile(userMdPath, combined, "utf-8");
  return approved.length;
}

/**
 * Write approved items to the warm memory tier as structured entries.
 */
export async function writeToWarmMemory(
  openclawHome: string,
  items: ReviewedItem[],
): Promise<number> {
  const approved = items.filter(
    (r) => r.decision === "approve" || r.decision === "edit",
  );

  if (approved.length === 0) return 0;

  const now = new Date().toISOString();
  let written = 0;

  for (const reviewed of approved) {
    const content = getContent(reviewed);
    const item = reviewed.item;

    const baseFields = {
      id: item.id,
      content,
      tags: extractTags(content),
      confidence: item.confidence,
      createdAt: now,
      lastAccessedAt: now,
      sourceRef: `chatgpt-import:${item.sources[0] ?? "unknown"}`,
    };

    if (item.category === "preference" || item.category === "habit") {
      const entry: PreferenceEntry = {
        ...baseFields,
        category: "preferences",
        parentId: null,
      };
      await writeEntry(openclawHome, "warm", entry);
      written++;
    } else if (item.category === "relationship") {
      const entities = content
        .split(/\s+/)
        .filter((w) => w.length > 2)
        .slice(0, 2);
      const entry: RelationshipEntry = {
        ...baseFields,
        category: "relationships",
        entities,
        relationshipType: "associated",
      };
      await writeEntry(openclawHome, "warm", entry);
      written++;
    } else {
      // fact → context
      const entry: ContextEntry = {
        ...baseFields,
        category: "context",
        expiresAt: null,
      };
      await writeEntry(openclawHome, "warm", entry);
      written++;
    }
  }

  return written;
}

/** Extract simple tags from content text. */
function extractTags(text: string): string[] {
  const words = text.toLowerCase().split(/\s+/);
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been",
    "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "about",
    "that", "this", "it", "its", "my", "your", "i", "me", "and",
    "or", "not", "no", "but", "if", "so", "up", "out", "all",
    "prefers",
  ]);
  return [...new Set(
    words
      .filter((w) => w.length > 2 && !stopWords.has(w))
      .slice(0, 5),
  )];
}
