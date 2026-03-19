import { describe, expect, it } from "vitest";

import type { Prompter } from "./wizard.js";
import { runWizard, WizardAbortError } from "./wizard.js";

// ── Mock Prompter ────────────────────────────────────────────────────────────

/**
 * Create a mock prompter that replays scripted answers.
 *
 * Each call to select/input/confirm pops the next answer from the queue.
 */
function mockPrompter(answers: unknown[]): Prompter {
  const queue = [...answers];
  const next = () => {
    if (queue.length === 0) throw new Error("Mock prompter ran out of answers");
    return queue.shift() as NonNullable<unknown>;
  };

  return {
    select: async () => next(),
    input: async (opts) => {
      const answer = next();
      // If the answer is empty string, use the default
      return answer === "" && opts.default ? opts.default : String(answer);
    },
    confirm: async () => Boolean(next()),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("runWizard", () => {
  it("completes happy path without errors", async () => {
    // Script: select blueprint → channel → air-gapped? → model → local model →
    //         deploy dir → port → configure tasks? → confirm
    const prompter = mockPrompter([
      "family-hub",       // blueprint selection
      "telegram",         // channel selection
      false,              // not air-gapped
      "local",            // model provider
      "",                 // local model (use default)
      "",                 // deploy dir (use default)
      "",                 // port (use default)
      // Integration prompts for "messaging" (required): BOT_TOKEN
      "test-bot-token",
      // Integration prompts for "calendar" (required): CALDAV_URL, USER, PASS
      "https://cal.example.com",
      "user",
      "pass",
      // "tasks" recommended — skip
      false,
      // Confirm
      true,
    ]);

    const answers = await runWizard(prompter);

    expect(answers.blueprint.name).toBe("Family Hub");
    expect(answers.channel).toBe("telegram");
    expect(answers.modelProvider).toBe("local");
    expect(answers.airGapped).toBe(false);
  });

  it("uses pre-selected blueprint from options", async () => {
    const prompter = mockPrompter([
      "telegram",         // channel
      false,              // not air-gapped
      "local",            // model
      "",                 // local model default
      "",                 // deploy dir
      "",                 // port
      "token",            // messaging BOT_TOKEN
      "https://cal.example.com", // calendar
      "user",
      "pass",
      false,              // skip tasks
      true,               // confirm
    ]);

    const answers = await runWizard(prompter, { blueprintName: "family-hub" });
    expect(answers.blueprint.name).toBe("Family Hub");
  });

  it("throws WizardAbortError when user cancels", async () => {
    const prompter = mockPrompter([
      "family-hub",
      "telegram",
      false,
      "local",
      "",
      "",
      "",
      "token",
      "https://cal.example.com",
      "user",
      "pass",
      false,
      false, // user cancels at confirmation
    ]);

    await expect(runWizard(prompter)).rejects.toThrow(WizardAbortError);
  });

  it("skips cloud-dependent integrations in air-gapped mode", async () => {
    const prompter = mockPrompter([
      "telegram",         // channel
      true,               // air-gapped
      "",                 // local model default (forced local)
      "",                 // deploy dir
      "",                 // port
      "token",            // messaging BOT_TOKEN
      "https://cal.example.com", // calendar
      "user",
      "pass",
      false,              // skip tasks
      true,               // confirm
    ]);

    const answers = await runWizard(prompter, { blueprintName: "family-hub" });

    expect(answers.airGapped).toBe(true);
    expect(answers.modelProvider).toBe("local");
  });

  it("supports air-gapped flag from options", async () => {
    const prompter = mockPrompter([
      "telegram",
      "",                 // local model default
      "",                 // deploy dir
      "",                 // port
      "token",
      "https://cal.example.com",
      "user",
      "pass",
      false,
      true,
    ]);

    const answers = await runWizard(prompter, {
      blueprintName: "family-hub",
      airGapped: true,
    });

    expect(answers.airGapped).toBe(true);
    expect(answers.modelProvider).toBe("local");
  });

  it("collects integration credentials correctly", async () => {
    const prompter = mockPrompter([
      "telegram",
      false,
      "local",
      "",
      "",
      "",
      "my-bot-token",     // messaging BOT_TOKEN
      "https://caldav.example.com", // calendar CALDAV_URL
      "caluser",          // calendar CALDAV_USER
      "calpass",          // calendar CALDAV_PASS
      true,               // configure tasks (recommended)
      "tasks-api-token",  // tasks API_TOKEN
      true,               // confirm
    ]);

    const answers = await runWizard(prompter, { blueprintName: "family-hub" });

    expect(answers.integrations["messaging"]?.["BOT_TOKEN"]).toBe("my-bot-token");
    expect(answers.integrations["calendar"]?.["CALDAV_URL"]).toBe("https://caldav.example.com");
    expect(answers.integrations["tasks"]?.["API_TOKEN"]).toBe("tasks-api-token");
  });
});
