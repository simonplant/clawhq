import { beforeAll, describe, expect, it } from "vitest";

import { getBuiltInTemplates } from "../init/templates.js";
import type { TemplateChoice } from "../init/types.js";

import { formatProposal, parseInferenceResponse } from "./parser.js";
import type { InferenceResult } from "./types.js";

let TEMPLATES: TemplateChoice[];

beforeAll(async () => {
  TEMPLATES = await getBuiltInTemplates();
});

/** Assert non-null and return typed value. */
function assertResult(result: InferenceResult | null): InferenceResult {
  expect(result).not.toBeNull();
  return result as InferenceResult;
}

describe("parseInferenceResponse", () => {
  it("parses a clean JSON response", () => {
    const response = JSON.stringify({
      templateId: "replace-my-pa",
      agentName: "jarvis",
      timezone: "America/New_York",
      wakingHoursStart: "07:00",
      wakingHoursEnd: "23:00",
      integrations: ["messaging", "email", "calendar"],
      autonomyLevel: "medium",
      boundaries: ["never send emails without approval"],
      cloudProviders: [],
      cloudCategories: [],
    });

    const result = assertResult(parseInferenceResponse(response, TEMPLATES));

    expect(result.templateId).toBe("replace-my-pa");
    expect(result.agentName).toBe("jarvis");
    expect(result.timezone).toBe("America/New_York");
    expect(result.integrations).toContain("messaging");
    expect(result.integrations).toContain("email");
    expect(result.autonomyLevel).toBe("medium");
    expect(result.cloudProviders).toHaveLength(0);
  });

  it("extracts JSON from markdown code fence", () => {
    const response = `Here's the config:

\`\`\`json
{
  "templateId": "replace-google-assistant",
  "agentName": "friday",
  "timezone": "UTC",
  "wakingHoursStart": "08:00",
  "wakingHoursEnd": "22:00",
  "integrations": ["messaging"],
  "autonomyLevel": "low",
  "boundaries": [],
  "cloudProviders": [],
  "cloudCategories": []
}
\`\`\`

Let me know if you'd like changes!`;

    const result = assertResult(parseInferenceResponse(response, TEMPLATES));

    expect(result.templateId).toBe("replace-google-assistant");
    expect(result.agentName).toBe("friday");
  });

  it("extracts JSON from surrounding prose", () => {
    const response = `Based on your needs, here's what I suggest: {"templateId": "founders-ops", "agentName": "atlas", "timezone": "Europe/Berlin", "wakingHoursStart": "06:00", "wakingHoursEnd": "22:00", "integrations": ["messaging", "email"], "autonomyLevel": "high", "boundaries": [], "cloudProviders": ["anthropic"], "cloudCategories": ["research"]} Hope this helps!`;

    const result = assertResult(parseInferenceResponse(response, TEMPLATES));

    expect(result.templateId).toBe("founders-ops");
    expect(result.cloudProviders).toContain("anthropic");
  });

  it("always includes messaging in integrations", () => {
    const response = JSON.stringify({
      templateId: "research-copilot",
      agentName: "scholar",
      timezone: "UTC",
      wakingHoursStart: "09:00",
      wakingHoursEnd: "21:00",
      integrations: ["research"],
      autonomyLevel: "low",
      boundaries: [],
      cloudProviders: [],
      cloudCategories: [],
    });

    const result = assertResult(parseInferenceResponse(response, TEMPLATES));

    expect(result.integrations).toContain("messaging");
  });

  it("falls back to first template for unknown templateId", () => {
    const response = JSON.stringify({
      templateId: "nonexistent-template",
      agentName: "test",
      timezone: "UTC",
      wakingHoursStart: "07:00",
      wakingHoursEnd: "23:00",
      integrations: ["messaging"],
      autonomyLevel: "medium",
      boundaries: [],
      cloudProviders: [],
      cloudCategories: [],
    });

    const result = assertResult(parseInferenceResponse(response, TEMPLATES));

    expect(TEMPLATES.map((t) => t.id)).toContain(result.templateId);
  });

  it("sanitizes agent name with special characters", () => {
    const response = JSON.stringify({
      templateId: "replace-my-pa",
      agentName: "My Cool Agent!",
      timezone: "UTC",
      wakingHoursStart: "07:00",
      wakingHoursEnd: "23:00",
      integrations: ["messaging"],
      autonomyLevel: "medium",
      boundaries: [],
      cloudProviders: [],
      cloudCategories: [],
    });

    const result = assertResult(parseInferenceResponse(response, TEMPLATES));

    expect(result.agentName).toBe("my-cool-agent");
  });

  it("defaults invalid timezone to UTC", () => {
    const response = JSON.stringify({
      templateId: "replace-my-pa",
      agentName: "test",
      timezone: "not a timezone",
      wakingHoursStart: "07:00",
      wakingHoursEnd: "23:00",
      integrations: ["messaging"],
      autonomyLevel: "medium",
      boundaries: [],
      cloudProviders: [],
      cloudCategories: [],
    });

    const result = assertResult(parseInferenceResponse(response, TEMPLATES));

    expect(result.timezone).toBe("UTC");
  });

  it("defaults invalid autonomy level to medium", () => {
    const response = JSON.stringify({
      templateId: "replace-my-pa",
      agentName: "test",
      timezone: "UTC",
      wakingHoursStart: "07:00",
      wakingHoursEnd: "23:00",
      integrations: ["messaging"],
      autonomyLevel: "super-autonomous",
      boundaries: [],
      cloudProviders: [],
      cloudCategories: [],
    });

    const result = assertResult(parseInferenceResponse(response, TEMPLATES));

    expect(result.autonomyLevel).toBe("medium");
  });

  it("returns null for completely invalid response", () => {
    const result = parseInferenceResponse("This is not JSON at all.", TEMPLATES);
    expect(result).toBeNull();
  });

  it("defaults invalid time formats", () => {
    const response = JSON.stringify({
      templateId: "replace-my-pa",
      agentName: "test",
      timezone: "UTC",
      wakingHoursStart: "7am",
      wakingHoursEnd: "midnight",
      integrations: ["messaging"],
      autonomyLevel: "medium",
      boundaries: [],
      cloudProviders: [],
      cloudCategories: [],
    });

    const result = assertResult(parseInferenceResponse(response, TEMPLATES));

    expect(result.wakingHoursStart).toBe("07:00");
    expect(result.wakingHoursEnd).toBe("23:00");
  });
});

describe("formatProposal", () => {
  it("formats a local-only proposal", () => {
    const result = {
      templateId: "replace-my-pa",
      agentName: "jarvis",
      timezone: "America/New_York",
      wakingHoursStart: "07:00",
      wakingHoursEnd: "23:00",
      integrations: ["messaging", "email", "calendar"],
      autonomyLevel: "medium" as const,
      boundaries: ["never send emails without approval"],
      cloudProviders: [],
      cloudCategories: [],
    };

    const formatted = formatProposal(result, TEMPLATES);

    expect(formatted).toContain("Replace my PA");
    expect(formatted).toContain("jarvis");
    expect(formatted).toContain("America/New_York");
    expect(formatted).toContain("local-only");
    expect(formatted).toContain("never send emails without approval");
  });

  it("formats a cloud-enabled proposal", () => {
    const result = {
      templateId: "research-copilot",
      agentName: "scholar",
      timezone: "UTC",
      wakingHoursStart: "09:00",
      wakingHoursEnd: "21:00",
      integrations: ["messaging", "research"],
      autonomyLevel: "low" as const,
      boundaries: [],
      cloudProviders: ["anthropic"],
      cloudCategories: ["research", "writing"],
    };

    const formatted = formatProposal(result, TEMPLATES);

    expect(formatted).toContain("anthropic");
    expect(formatted).toContain("research, writing");
    expect(formatted).not.toContain("local-only");
  });
});
