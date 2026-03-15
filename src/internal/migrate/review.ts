/**
 * Interactive review for extracted preferences and facts.
 *
 * Presents each extracted item to the user for approval, editing, or rejection.
 * Uses injectable IO interface for testability.
 */

import type { ExtractedItem, MigrateIO, ReviewDecision, ReviewedItem } from "./types.js";

/** Category labels for display. */
const CATEGORY_LABELS: Record<ExtractedItem["category"], string> = {
  preference: "PREFERENCE",
  fact: "FACT",
  relationship: "RELATIONSHIP",
  habit: "HABIT",
};

/** Confidence labels for display. */
const CONFIDENCE_LABELS: Record<ExtractedItem["confidence"], string> = {
  high: "high",
  medium: "med",
  low: "low",
};

/**
 * Format a single extracted item for display.
 */
export function formatItem(item: ExtractedItem, index: number, total: number): string {
  const lines: string[] = [];
  const label = CATEGORY_LABELS[item.category];
  const conf = CONFIDENCE_LABELS[item.confidence];
  const piiFlag = item.piiMasked ? " [PII masked]" : "";

  lines.push(`[${index + 1}/${total}] ${label} (${conf})${piiFlag}`);
  lines.push(`  ${item.content}`);
  if (item.sources.length > 0) {
    const srcList = item.sources.slice(0, 3).join(", ");
    const more = item.sources.length > 3 ? ` +${item.sources.length - 3} more` : "";
    lines.push(`  Source: ${srcList}${more}`);
  }

  return lines.join("\n");
}

/**
 * Present extracted items for interactive review.
 *
 * For each item, the user can:
 * - (a)pprove: accept as-is
 * - (e)dit: modify the content
 * - (r)eject: skip this item
 * - (A)pprove all remaining
 * - (R)eject all remaining
 */
export async function reviewItems(
  items: ExtractedItem[],
  io: MigrateIO,
): Promise<ReviewedItem[]> {
  if (items.length === 0) {
    io.print("No items to review.");
    return [];
  }

  io.print(`\nReview ${items.length} extracted item(s). For each:`);
  io.print("  (a)pprove  (e)dit  (r)eject  (A)pprove-all  (R)eject-all\n");

  const results: ReviewedItem[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    io.print(formatItem(item, i, items.length));

    const answer = await io.prompt("  Decision [a/e/r/A/R]: ");
    const decision = parseDecision(answer);

    if (decision === "approve-all") {
      // Approve this and all remaining
      results.push({ item, decision: "approve" });
      for (let j = i + 1; j < items.length; j++) {
        results.push({ item: items[j], decision: "approve" });
      }
      io.print(`Approved ${items.length - i} remaining item(s).`);
      break;
    }

    if (decision === "reject-all") {
      // Reject this and all remaining
      results.push({ item, decision: "reject" });
      for (let j = i + 1; j < items.length; j++) {
        results.push({ item: items[j], decision: "reject" });
      }
      io.print(`Rejected ${items.length - i} remaining item(s).`);
      break;
    }

    if (decision === "edit") {
      const edited = await io.prompt("  New content: ");
      if (edited.trim().length > 0) {
        results.push({ item, decision: "edit", editedContent: edited.trim() });
      } else {
        // Empty edit = keep original as approved
        results.push({ item, decision: "approve" });
      }
    } else {
      results.push({ item, decision });
    }
  }

  const approved = results.filter((r) => r.decision === "approve" || r.decision === "edit").length;
  const rejected = results.filter((r) => r.decision === "reject").length;
  io.print(`\nReview complete: ${approved} approved, ${rejected} rejected.`);

  return results;
}

/**
 * Parse user input into a review decision.
 */
function parseDecision(input: string): ReviewDecision | "approve-all" | "reject-all" {
  const trimmed = input.trim();
  if (trimmed === "A") return "approve-all";
  if (trimmed === "R") return "reject-all";
  if (trimmed === "e" || trimmed === "edit") return "edit";
  if (trimmed === "r" || trimmed === "reject") return "reject";
  // Default to approve (a, approve, or any other input)
  return "approve";
}
