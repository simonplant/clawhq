/**
 * CUSTOMIZATIONS block preservation for identity files.
 *
 * Identity files may contain a `<!-- CUSTOMIZATIONS -->` block at the end
 * where users add manual edits. When templates are re-applied, this block
 * is extracted from the existing file and appended to the newly generated
 * content — preserving manual work.
 */

const CUSTOMIZATIONS_START = "<!-- CUSTOMIZATIONS -->";
const CUSTOMIZATIONS_END = "<!-- /CUSTOMIZATIONS -->";

/**
 * Extract the customizations block from an identity file's content.
 * Returns the block content (including markers) or null if not present.
 */
export function extractCustomizations(content: string): string | null {
  const startIdx = content.indexOf(CUSTOMIZATIONS_START);
  if (startIdx === -1) return null;

  const endIdx = content.indexOf(CUSTOMIZATIONS_END, startIdx);
  if (endIdx === -1) {
    // Block opened but never closed — take everything from start marker to end of file
    return content.slice(startIdx).trimEnd() + "\n" + CUSTOMIZATIONS_END + "\n";
  }

  return content.slice(startIdx, endIdx + CUSTOMIZATIONS_END.length + 1).trimEnd() + "\n";
}

/**
 * Extract just the user content inside the customizations block (without markers).
 */
export function extractCustomizationsContent(content: string): string | null {
  const startIdx = content.indexOf(CUSTOMIZATIONS_START);
  if (startIdx === -1) return null;

  const afterStart = startIdx + CUSTOMIZATIONS_START.length;
  const endIdx = content.indexOf(CUSTOMIZATIONS_END, afterStart);

  const inner = endIdx === -1
    ? content.slice(afterStart)
    : content.slice(afterStart, endIdx);

  const trimmed = inner.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Merge newly generated identity file content with an existing customizations block.
 * If the existing file has a customizations block, it's preserved at the end
 * of the new content. If the new content already has a customizations block,
 * the existing one takes precedence.
 */
export function mergeCustomizations(
  newContent: string,
  existingContent: string,
): string {
  const existingBlock = extractCustomizations(existingContent);
  if (!existingBlock) return newContent;

  // Strip any customizations block from the new content
  const newStartIdx = newContent.indexOf(CUSTOMIZATIONS_START);
  const stripped = newStartIdx === -1
    ? newContent
    : newContent.slice(0, newStartIdx).trimEnd();

  return stripped + "\n\n" + existingBlock;
}

/**
 * Append an empty customizations block to content if one doesn't exist.
 * This marks where users can add manual edits that survive template re-apply.
 */
export function ensureCustomizationsBlock(content: string): string {
  if (content.includes(CUSTOMIZATIONS_START)) return content;

  return (
    content.trimEnd() +
    "\n\n" +
    CUSTOMIZATIONS_START +
    "\n" +
    "<!-- Add your manual customizations below this line. -->\n" +
    "<!-- This block is preserved when templates are re-applied. -->\n" +
    "\n" +
    CUSTOMIZATIONS_END +
    "\n"
  );
}
