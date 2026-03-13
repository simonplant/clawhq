import { describe, expect, it } from "vitest";

import { generate } from "./generate.js";
import { BUILT_IN_TEMPLATES } from "./templates.js";
import type { WizardAnswers } from "./types.js";

function makeAnswers(overrides: Partial<WizardAnswers> = {}): WizardAnswers {
  return {
    basics: {
      agentName: "test-agent",
      timezone: "UTC",
      wakingHoursStart: "06:00",
      wakingHoursEnd: "23:00",
    },
    template: BUILT_IN_TEMPLATES[0], // Replace Google Assistant
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
    ...overrides,
  };
}

describe("generate", () => {
  it("generates a valid config bundle", () => {
    const result = generate(makeAnswers());

    expect(result.bundle).not.toBeNull();
    expect(result.validationPassed).toBe(true);
    expect(result.bundle.openclawConfig.dangerouslyDisableDeviceAuth).toBe(true);
  });

  it("handles all 14 landmine rules without failures", () => {
    const result = generate(makeAnswers());

    const failures = result.validationResults.filter((r) => r.status === "fail");
    expect(failures).toHaveLength(0);
  });

  it("generates correct cron schedules (no invalid stepping)", () => {
    const result = generate(makeAnswers());

    for (const job of result.bundle.cronJobs) {
      const fields = job.schedule.split(" ");
      for (const field of fields) {
        // No bare N/M stepping (LM-09)
        expect(field).not.toMatch(/^\d+\/\d+$/);
      }
    }
  });

  it("generates identity files within token budget", () => {
    const result = generate(makeAnswers());

    const totalChars = Object.values(result.bundle.identityFiles).reduce(
      (sum, content) => sum + content.length,
      0,
    );
    // Must be well under 20,000 chars (bootstrapMaxChars default)
    expect(totalChars).toBeLessThan(20000);
  });

  it("includes cloud provider config when not local-only", () => {
    const result = generate(
      makeAnswers({
        modelRouting: {
          localOnly: false,
          cloudProviders: [
            {
              provider: "anthropic",
              envVar: "ANTHROPIC_API_KEY",
              credential: "sk-test",
              validated: false,
            },
          ],
          categories: [
            { category: "research", cloudAllowed: true },
            { category: "email", cloudAllowed: false },
          ],
        },
      }),
    );

    expect(result.bundle.openclawConfig.models?.providers?.["anthropic"]).toBeDefined();
    expect(result.bundle.envVars["ANTHROPIC_API_KEY"]).toBe("sk-test");
  });

  it("generates env vars from integrations", () => {
    const result = generate(makeAnswers());

    expect(result.bundle.envVars["TELEGRAM_BOT_TOKEN"]).toBe("bot-token");
  });

  it("generates docker-compose with correct security posture", () => {
    const result = generate(makeAnswers());

    // Hardened posture should include cap_drop, user, read_only
    expect(result.bundle.dockerCompose).toContain("1000:1000");
    expect(result.bundle.dockerCompose).toContain("ALL");
  });

  it("passes validation for all 6 templates", () => {
    for (const template of BUILT_IN_TEMPLATES) {
      const result = generate(makeAnswers({ template }));
      const failures = result.validationResults.filter((r) => r.status === "fail");
      expect(failures).toHaveLength(0);
    }
  });
});
