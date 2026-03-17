import { describe, expect, it } from "vitest";

import {
  ensureCustomizationsBlock,
  extractCustomizations,
  extractCustomizationsContent,
  mergeCustomizations,
} from "./customizations.js";

describe("extractCustomizations", () => {
  it("returns null when no customizations block", () => {
    const content = "# AGENTS.md\n\nSome operating instructions.\n";
    expect(extractCustomizations(content)).toBeNull();
  });

  it("extracts a complete customizations block", () => {
    const content = [
      "# AGENTS.md",
      "",
      "Some content.",
      "",
      "<!-- CUSTOMIZATIONS -->",
      "My custom rule: always be concise.",
      "<!-- /CUSTOMIZATIONS -->",
      "",
    ].join("\n");

    const result = extractCustomizations(content);
    expect(result).toContain("<!-- CUSTOMIZATIONS -->");
    expect(result).toContain("My custom rule: always be concise.");
    expect(result).toContain("<!-- /CUSTOMIZATIONS -->");
  });

  it("handles unclosed customizations block", () => {
    const content = [
      "# AGENTS.md",
      "",
      "<!-- CUSTOMIZATIONS -->",
      "My custom rule.",
    ].join("\n");

    const result = extractCustomizations(content);
    expect(result).toContain("<!-- CUSTOMIZATIONS -->");
    expect(result).toContain("My custom rule.");
    expect(result).toContain("<!-- /CUSTOMIZATIONS -->");
  });
});

describe("extractCustomizationsContent", () => {
  it("returns null when no block", () => {
    expect(extractCustomizationsContent("No block here.")).toBeNull();
  });

  it("returns null when block is empty", () => {
    const content = "<!-- CUSTOMIZATIONS -->\n\n<!-- /CUSTOMIZATIONS -->";
    expect(extractCustomizationsContent(content)).toBeNull();
  });

  it("returns inner content without markers", () => {
    const content = [
      "<!-- CUSTOMIZATIONS -->",
      "Rule 1: be concise.",
      "Rule 2: no jargon.",
      "<!-- /CUSTOMIZATIONS -->",
    ].join("\n");

    const result = extractCustomizationsContent(content);
    expect(result).toBe("Rule 1: be concise.\nRule 2: no jargon.");
  });
});

describe("mergeCustomizations", () => {
  it("returns new content when existing has no customizations", () => {
    const newContent = "# AGENTS.md\n\nNew content.\n";
    const existingContent = "# AGENTS.md\n\nOld content.\n";

    expect(mergeCustomizations(newContent, existingContent)).toBe(newContent);
  });

  it("preserves existing customizations in new content", () => {
    const newContent = "# AGENTS.md\n\nNew generated content.\n";
    const existingContent = [
      "# AGENTS.md",
      "",
      "Old content.",
      "",
      "<!-- CUSTOMIZATIONS -->",
      "My custom rule.",
      "<!-- /CUSTOMIZATIONS -->",
      "",
    ].join("\n");

    const result = mergeCustomizations(newContent, existingContent);
    expect(result).toContain("New generated content.");
    expect(result).toContain("<!-- CUSTOMIZATIONS -->");
    expect(result).toContain("My custom rule.");
    expect(result).toContain("<!-- /CUSTOMIZATIONS -->");
  });

  it("replaces new customizations block with existing one", () => {
    const newContent = [
      "# AGENTS.md",
      "",
      "New content.",
      "",
      "<!-- CUSTOMIZATIONS -->",
      "Template default customization.",
      "<!-- /CUSTOMIZATIONS -->",
      "",
    ].join("\n");

    const existingContent = [
      "# AGENTS.md",
      "",
      "Old content.",
      "",
      "<!-- CUSTOMIZATIONS -->",
      "User's manual edit.",
      "<!-- /CUSTOMIZATIONS -->",
      "",
    ].join("\n");

    const result = mergeCustomizations(newContent, existingContent);
    expect(result).toContain("New content.");
    expect(result).toContain("User's manual edit.");
    expect(result).not.toContain("Template default customization.");
  });
});

describe("ensureCustomizationsBlock", () => {
  it("adds block when not present", () => {
    const content = "# AGENTS.md\n\nSome content.\n";
    const result = ensureCustomizationsBlock(content);
    expect(result).toContain("<!-- CUSTOMIZATIONS -->");
    expect(result).toContain("<!-- /CUSTOMIZATIONS -->");
    expect(result).toContain("Add your manual customizations");
  });

  it("does not add duplicate block", () => {
    const content = [
      "# AGENTS.md",
      "",
      "<!-- CUSTOMIZATIONS -->",
      "Existing.",
      "<!-- /CUSTOMIZATIONS -->",
    ].join("\n");

    const result = ensureCustomizationsBlock(content);
    const count = (result.match(/<!-- CUSTOMIZATIONS -->/g) ?? []).length;
    expect(count).toBe(1);
  });
});
