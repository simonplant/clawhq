import { beforeAll, describe, expect, it } from "vitest";

import { generate } from "./generate.js";
import { getBuiltInTemplates } from "./templates.js";
import type { TemplateChoice, WizardAnswers } from "./types.js";

let TEMPLATES: TemplateChoice[];

beforeAll(async () => {
  TEMPLATES = await getBuiltInTemplates();
});

function findTemplate(name: string): TemplateChoice {
  const t = TEMPLATES.find((t) => t.name.toLowerCase().includes(name.toLowerCase()));
  if (!t) throw new Error(`Template "${name}" not found`);
  return t;
}

function makeAnswers(template: TemplateChoice): WizardAnswers {
  return {
    basics: {
      agentName: "test-agent",
      timezone: "UTC",
      wakingHoursStart: "06:00",
      wakingHoursEnd: "23:00",
    },
    template,
    integrations: [
      {
        provider: "Messaging (Telegram)",
        category: "messaging",
        envVar: "TELEGRAM_BOT_TOKEN",
        credential: "bot-token",
        validated: false,
      },
    ],
    modelRouting: {
      localOnly: true,
      cloudProviders: [],
      categories: [],
    },
  };
}

describe("template-driven channels in generate", () => {
  it("generates multi-channel config for replace-google-assistant", () => {
    const template = findTemplate("Replace Google Assistant");
    const result = generate(makeAnswers(template));

    const channels = result.bundle.openclawConfig.channels;
    expect(channels).toBeDefined();
    expect(channels?.["telegram"]).toEqual({ enabled: true });
    expect(channels?.["whatsapp"]).toEqual({ enabled: false });
    expect(channels?.["discord"]).toEqual({ enabled: false });
  });

  it("generates multi-channel config for founders-ops", () => {
    const template = findTemplate("Founder");
    const result = generate(makeAnswers(template));

    const channels = result.bundle.openclawConfig.channels;
    expect(channels).toBeDefined();
    expect(Object.keys(channels ?? {})).toEqual(
      expect.arrayContaining(["telegram", "whatsapp", "slack", "discord"]),
    );
    // Only telegram (default) should be enabled
    expect(channels?.["telegram"]).toEqual({ enabled: true });
    expect(channels?.["slack"]).toEqual({ enabled: false });
  });

  it("generates multi-channel config for research-copilot", () => {
    const template = findTemplate("Research Co-pilot");
    const result = generate(makeAnswers(template));

    const channels = result.bundle.openclawConfig.channels;
    expect(channels).toBeDefined();
    expect(Object.keys(channels ?? {})).toEqual(
      expect.arrayContaining(["telegram", "matrix", "discord"]),
    );
  });

  it("generates CHANNELS.md identity file", () => {
    const template = findTemplate("Replace Google Assistant");
    const result = generate(makeAnswers(template));

    const channelsMd = result.bundle.identityFiles["CHANNELS.md"];
    expect(channelsMd).toBeDefined();
    expect(channelsMd).toContain("telegram");
    expect(channelsMd).toContain("whatsapp");
    expect(channelsMd).toContain("discord");
    expect(channelsMd).toContain("default");
  });

  it("CHANNELS.md falls back to telegram-only for templates without channels block", () => {
    // Create a template without channels
    const template: TemplateChoice = {
      ...findTemplate("Replace Google Assistant"),
      channels: undefined,
    };
    const result = generate(makeAnswers(template));

    const channelsMd = result.bundle.identityFiles["CHANNELS.md"];
    expect(channelsMd).toContain("telegram");
    expect(channelsMd).toContain("default");
  });

  it("all built-in templates have channels defined", () => {
    for (const template of TEMPLATES) {
      expect(template.channels).toBeDefined();
      expect(template.channels?.supported).toContain("telegram");
      expect(template.channels?.supported).toContain(template.channels?.default);
    }
  });

  it("validation still passes with multi-channel configs", () => {
    for (const template of TEMPLATES) {
      const result = generate(makeAnswers(template));
      const failures = result.validationResults.filter((r) => r.status === "fail");
      expect(failures).toHaveLength(0);
    }
  });
});
