import { beforeAll, describe, expect, it } from "vitest";

import { getBuiltInTemplates } from "../configure/templates.js";
import type { TemplateChoice } from "../configure/types.js";

import { buildRefinementPrompt, buildSystemPrompt } from "./prompt.js";

let TEMPLATES: TemplateChoice[];

beforeAll(async () => {
  TEMPLATES = await getBuiltInTemplates();
});

describe("buildSystemPrompt", () => {
  it("includes all template IDs", () => {
    const prompt = buildSystemPrompt(TEMPLATES);

    for (const t of TEMPLATES) {
      expect(prompt).toContain(t.id);
    }
  });

  it("includes integration categories", () => {
    const prompt = buildSystemPrompt(TEMPLATES);

    expect(prompt).toContain("messaging");
    expect(prompt).toContain("email");
    expect(prompt).toContain("calendar");
    expect(prompt).toContain("tasks");
    expect(prompt).toContain("research");
  });

  it("includes JSON output format", () => {
    const prompt = buildSystemPrompt(TEMPLATES);

    expect(prompt).toContain('"templateId"');
    expect(prompt).toContain('"agentName"');
    expect(prompt).toContain('"integrations"');
    expect(prompt).toContain('"autonomyLevel"');
    expect(prompt).toContain('"boundaries"');
    expect(prompt).toContain('"cloudProviders"');
  });

  it("includes autonomy level options", () => {
    const prompt = buildSystemPrompt(TEMPLATES);

    expect(prompt).toContain("low");
    expect(prompt).toContain("medium");
    expect(prompt).toContain("high");
  });

  it("instructs to respond with JSON only", () => {
    const prompt = buildSystemPrompt(TEMPLATES);

    expect(prompt).toContain("ONLY a JSON object");
  });
});

describe("buildRefinementPrompt", () => {
  it("includes current config and user adjustment", () => {
    const currentConfig = '{"templateId": "replace-my-pa"}';
    const adjustment = "Make it more autonomous";

    const prompt = buildRefinementPrompt(currentConfig, adjustment);

    expect(prompt).toContain(currentConfig);
    expect(prompt).toContain(adjustment);
  });
});
