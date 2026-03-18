import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generate, getBuiltInTemplates, getTemplateById, writeBundle } from "../design/configure/index.js";
import type { WizardAnswers } from "../design/configure/index.js";

/**
 * Tests for non-interactive init flow (--non-interactive).
 *
 * Validates that template defaults + CLI overrides produce the same
 * bundle as the wizard would, without any interactive prompts.
 */

let outputDir: string;

beforeEach(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "clawhq-plan-test-"));
});

afterEach(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

describe("non-interactive init", () => {
  it("generates a valid bundle with template defaults", async () => {
    const template = await getTemplateById("replace-my-pa");
    expect(template).toBeDefined();

    const answers: WizardAnswers = {
      basics: {
        agentName: "agent-2",
        timezone: "America/Los_Angeles",
        wakingHoursStart: "06:00",
        wakingHoursEnd: "23:00",
      },
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by toBeDefined() above
      template: template!,
      integrations: [],
      modelRouting: {
        localOnly: true,
        cloudProviders: [],
        categories: [
          { category: "email", cloudAllowed: false },
          { category: "calendar", cloudAllowed: false },
          { category: "research", cloudAllowed: false },
          { category: "writing", cloudAllowed: false },
          { category: "coding", cloudAllowed: false },
        ],
      },
    };

    const config = generate(answers);
    expect(config.validationPassed).toBe(true);

    const writeResult = await writeBundle(config.bundle, outputDir);
    expect(writeResult.errors).toHaveLength(0);
    expect(writeResult.filesWritten.length).toBeGreaterThan(0);

    // Verify openclaw.json was written with the right agent name
    const openclawJson = await readFile(join(outputDir, "openclaw.json"), "utf8");
    const parsed = JSON.parse(openclawJson);
    expect(parsed.identity.name).toBe("agent-2");
  });

  it("works with different templates", async () => {
    const templates = await getBuiltInTemplates();
    expect(templates.length).toBeGreaterThan(0);

    // Test with the first available template
    const template = templates[0];
    const answers: WizardAnswers = {
      basics: {
        agentName: "test-agent",
        timezone: "UTC",
        wakingHoursStart: "06:00",
        wakingHoursEnd: "23:00",
      },
      template,
      integrations: [],
      modelRouting: {
        localOnly: true,
        cloudProviders: [],
        categories: [
          { category: "email", cloudAllowed: false },
          { category: "calendar", cloudAllowed: false },
          { category: "research", cloudAllowed: false },
          { category: "writing", cloudAllowed: false },
          { category: "coding", cloudAllowed: false },
        ],
      },
    };

    const config = generate(answers);
    expect(config.validationPassed).toBe(true);
  });

  it("rejects unknown template IDs", async () => {
    const template = await getTemplateById("nonexistent-template");
    expect(template).toBeUndefined();
  });

  it("produces same output structure as wizard would", async () => {
    const template = await getTemplateById("research-copilot");
    expect(template).toBeDefined();

    const answers: WizardAnswers = {
      basics: {
        agentName: "fleet-agent-1",
        timezone: "Europe/Berlin",
        wakingHoursStart: "06:00",
        wakingHoursEnd: "23:00",
      },
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by toBeDefined() above
      template: template!,
      integrations: [],
      modelRouting: {
        localOnly: true,
        cloudProviders: [],
        categories: [
          { category: "email", cloudAllowed: false },
          { category: "calendar", cloudAllowed: false },
          { category: "research", cloudAllowed: false },
          { category: "writing", cloudAllowed: false },
          { category: "coding", cloudAllowed: false },
        ],
      },
    };

    const config = generate(answers);
    expect(config.validationPassed).toBe(true);
    expect(config.bundle.openclawConfig).toBeDefined();
    expect(config.bundle.dockerCompose).toBeDefined();
    expect(config.bundle.dockerfile).toBeDefined();
    expect(config.bundle.identityFiles).toBeDefined();
    expect(config.bundle.cronJobs).toBeDefined();

    const writeResult = await writeBundle(config.bundle, outputDir);
    expect(writeResult.errors).toHaveLength(0);

    // Verify key files exist
    const openclawJson = await readFile(join(outputDir, "openclaw.json"), "utf8");
    expect(JSON.parse(openclawJson).identity.name).toBe("fleet-agent-1");

    const dockerCompose = await readFile(join(outputDir, "docker-compose.yml"), "utf8");
    expect(dockerCompose).toContain("openclaw-fleet-agent-1");
  });

  it("can provision multiple agents in sequence", async () => {
    const template = await getTemplateById("replace-my-pa");
    expect(template).toBeDefined();

    for (let i = 0; i < 3; i++) {
      const agentDir = await mkdtemp(join(tmpdir(), `clawhq-fleet-${i}-`));
      try {
        const answers: WizardAnswers = {
          basics: {
            agentName: `agent-${i}`,
            timezone: "UTC",
            wakingHoursStart: "06:00",
            wakingHoursEnd: "23:00",
          },
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by toBeDefined() above
      template: template!,
          integrations: [],
          modelRouting: {
            localOnly: true,
            cloudProviders: [],
            categories: [
              { category: "email", cloudAllowed: false },
              { category: "calendar", cloudAllowed: false },
              { category: "research", cloudAllowed: false },
              { category: "writing", cloudAllowed: false },
              { category: "coding", cloudAllowed: false },
            ],
          },
        };

        const config = generate(answers);
        expect(config.validationPassed).toBe(true);

        const writeResult = await writeBundle(config.bundle, agentDir);
        expect(writeResult.errors).toHaveLength(0);

        const openclawJson = await readFile(join(agentDir, "openclaw.json"), "utf8");
        expect(JSON.parse(openclawJson).identity.name).toBe(`agent-${i}`);
      } finally {
        await rm(agentDir, { recursive: true, force: true });
      }
    }
  });
});
