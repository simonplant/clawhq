/**
 * End-to-end regression for the 2026-04-21 stub-clobber.
 *
 * Reproduces the scenario that destroyed the live clawhq.yaml:
 *
 *   1. User has a composition-bearing clawhq.yaml.
 *   2. User runs `clawhq init --guided --reset`. The deploy is archived;
 *      clawhq.yaml is moved out of the deploy dir.
 *   3. The wizard runs, the forge pipeline writes the new state.
 *   4. User then runs `clawhq apply`.
 *
 * Pre-fix outcome: step 4 failed with "No composition.profile" because the
 * wizard wrote a composition-less yaml.
 *
 * Post-fix outcome: composition.profile + composition.personality are
 * emitted; apply succeeds and produces a runnable deployment.
 *
 * Since the 20260421 incident, the forge pipeline was also refactored to
 * route through `apply()` instead of the parallel bundleToFiles path —
 * this test now exercises the new pipeline end-to-end, which catches the
 * original regression AND any drift introduced by the refactor.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as yamlParse } from "yaml";

import { forgeFromAnswers } from "../../cli/commands/init-run.js";
import { GATEWAY_DEFAULT_PORT, OLLAMA_DEFAULT_MODEL } from "../../config/defaults.js";
import { loadBlueprint, listBuiltinBlueprints } from "../blueprints/loader.js";

import type { WizardAnswers } from "./types.js";

let deployDir: string;

beforeEach(() => {
  deployDir = mkdtempSync(join(tmpdir(), "clawhq-init-reset-test-"));
});

afterEach(() => {
  rmSync(deployDir, { recursive: true, force: true });
});

function wizardAnswersFor(blueprintName: string): WizardAnswers {
  const loaded = loadBlueprint(blueprintName);
  return {
    blueprint: loaded.blueprint,
    blueprintPath: loaded.sourcePath,
    channel: "telegram",
    modelProvider: "local",
    localModel: OLLAMA_DEFAULT_MODEL,
    gatewayPort: GATEWAY_DEFAULT_PORT,
    deployDir,
    airGapped: false,
    integrations: {},
    customizationAnswers: {},
    userContext: {
      name: "Test User",
      timezone: "America/Los_Angeles",
      communicationPreference: "brief",
    },
  };
}

describe("init --reset + apply round-trip (20260421 regression)", () => {
  for (const blueprintName of listBuiltinBlueprints()) {
    it(`[${blueprintName}] forgeFromAnswers produces a composition-bearing yaml`, async () => {
      await forgeFromAnswers(wizardAnswersFor(blueprintName));

      const yamlPath = join(deployDir, "clawhq.yaml");
      expect(existsSync(yamlPath)).toBe(true);

      const parsed = yamlParse(readFileSync(yamlPath, "utf-8")) as {
        composition?: { profile?: string; personality?: string };
      };
      expect(parsed.composition).toBeDefined();
      expect(parsed.composition?.profile).toBeTruthy();
      expect(typeof parsed.composition?.profile).toBe("string");
    });
  }

  it("forge → apply round-trip produces a runnable deployment (family-hub)", async () => {
    // forgeFromAnswers already calls apply internally; the fact that it
    // doesn't throw is the full end-to-end proof.
    await forgeFromAnswers(wizardAnswersFor("family-hub"));

    // Verify the key derived files made it to disk.
    expect(existsSync(join(deployDir, "engine/openclaw.json"))).toBe(true);
    expect(existsSync(join(deployDir, "engine/.env"))).toBe(true);
    expect(existsSync(join(deployDir, "cron/jobs.json"))).toBe(true);
    expect(existsSync(join(deployDir, "workspace/SOUL.md"))).toBe(true);
  });
});
