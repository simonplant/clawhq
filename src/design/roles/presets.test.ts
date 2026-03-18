import { describe, expect, it } from "vitest";

import {
  applyRoleToIdentity,
  generateRoleSection,
  parseManualCustomizations,
  parseRoleSection,
  PRESET_IDS,
  ROLE_PRESETS,
} from "./presets.js";

describe("ROLE_PRESETS", () => {
  it("defines exactly 6 presets", () => {
    expect(PRESET_IDS).toHaveLength(6);
  });

  it("includes all expected preset IDs", () => {
    expect(PRESET_IDS).toContain("executive-assistant");
    expect(PRESET_IDS).toContain("research-analyst");
    expect(PRESET_IDS).toContain("life-coach");
    expect(PRESET_IDS).toContain("data-analyst");
    expect(PRESET_IDS).toContain("security-guardian");
    expect(PRESET_IDS).toContain("companion");
  });

  it("each preset has all required fields", () => {
    for (const id of PRESET_IDS) {
      const preset = ROLE_PRESETS[id];
      expect(preset.id).toBe(id);
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(["formal", "casual", "professional"]).toContain(preset.tone);
      expect(["high", "medium", "low"]).toContain(preset.formality);
      expect(["high", "medium", "low"]).toContain(preset.proactivity);
      expect(preset.domainExpertise).toBeTruthy();
      expect(preset.communicationStyle).toBeTruthy();
    }
  });

  it("executive-assistant has formal tone and high proactivity", () => {
    const preset = ROLE_PRESETS["executive-assistant"];
    expect(preset.tone).toBe("formal");
    expect(preset.formality).toBe("high");
    expect(preset.proactivity).toBe("high");
  });
});

describe("generateRoleSection", () => {
  it("generates markdown with preset fields", () => {
    const preset = ROLE_PRESETS["executive-assistant"];
    const section = generateRoleSection(preset);

    expect(section).toContain("## Role");
    expect(section).toContain("**Preset:** Executive Assistant");
    expect(section).toContain("**Tone:** formal");
    expect(section).toContain("**Formality:** high");
    expect(section).toContain("**Proactivity:** high");
    expect(section).toContain("### Domain Expertise");
    expect(section).toContain("### Communication Style");
    expect(section).toContain(preset.domainExpertise);
    expect(section).toContain(preset.communicationStyle);
  });
});

describe("parseRoleSection", () => {
  it("returns null when no role section exists", () => {
    const content = "# IDENTITY.md\n\nSome content.\n";
    expect(parseRoleSection(content)).toBeNull();
  });

  it("parses role section at end of file", () => {
    const content = "# IDENTITY.md\n\n## Role\n\nSome role content.\n";
    const result = parseRoleSection(content);

    expect(result).not.toBeNull();
    if (result) {
      expect(result.section).toContain("## Role");
      expect(result.section).toContain("Some role content.");
    }
  });

  it("parses role section with subsequent heading", () => {
    const content = "# IDENTITY.md\n\n## Role\n\nRole content.\n\n## Other\n\nOther content.\n";
    const result = parseRoleSection(content);

    expect(result).not.toBeNull();
    if (result) {
      expect(result.section).toContain("Role content.");
      expect(result.section).not.toContain("Other content.");
    }
  });
});

describe("parseManualCustomizations", () => {
  it("returns null when no manual customizations exist", () => {
    expect(parseManualCustomizations("# IDENTITY.md\n")).toBeNull();
  });

  it("returns manual customizations block", () => {
    const content = "# IDENTITY.md\n\n## Manual Customizations\n\nMy custom stuff.\n";
    const result = parseManualCustomizations(content);

    expect(result).not.toBeNull();
    expect(result).toContain("## Manual Customizations");
    expect(result).toContain("My custom stuff.");
  });
});

describe("applyRoleToIdentity", () => {
  const preset = ROLE_PRESETS["executive-assistant"];

  it("appends role section when none exists", () => {
    const content = "# IDENTITY.md\n\nAgent identity.\n";
    const result = applyRoleToIdentity(content, preset);

    expect(result).toContain("# IDENTITY.md");
    expect(result).toContain("## Role");
    expect(result).toContain("**Preset:** Executive Assistant");
  });

  it("replaces existing role section", () => {
    const content = "# IDENTITY.md\n\n## Role\n\nOld role content.\n\n## Other\n\nKeep this.\n";
    const result = applyRoleToIdentity(content, preset);

    expect(result).toContain("**Preset:** Executive Assistant");
    expect(result).not.toContain("Old role content.");
    expect(result).toContain("Keep this.");
  });

  it("preserves manual customizations when they exist outside role section", () => {
    const content = "# IDENTITY.md\n\n## Manual Customizations\n\nCustom stuff.\n";
    const result = applyRoleToIdentity(content, preset);

    expect(result).toContain("## Role");
    expect(result).toContain("## Manual Customizations");
    expect(result).toContain("Custom stuff.");
  });

  it("returns unchanged content when same preset already applied", () => {
    const content = "# IDENTITY.md\n\n" + generateRoleSection(preset);
    const result = applyRoleToIdentity(content, preset);

    // Should contain the same role section
    expect(result).toContain("**Preset:** Executive Assistant");
  });

  it("swaps between presets correctly", () => {
    const content = "# IDENTITY.md\n\n" + generateRoleSection(ROLE_PRESETS["companion"]);
    const result = applyRoleToIdentity(content, preset);

    expect(result).toContain("**Preset:** Executive Assistant");
    expect(result).not.toContain("**Preset:** Companion");
  });
});
