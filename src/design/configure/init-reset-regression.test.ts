/**
 * End-to-end regression for the 2026-04-21 stub-clobber.
 *
 * Reproduces the exact scenario that destroyed the live clawhq.yaml:
 *
 *   1. User has a composition-bearing clawhq.yaml (life-ops profile,
 *      fastmail-jmap provider, specific skills).
 *   2. User runs `clawhq init --guided --reset`. The deploy is archived;
 *      clawhq.yaml is moved out of the deploy dir.
 *   3. The wizard runs. buildClawHQConfig produces a ClawHQConfig.
 *   4. bundleToFiles → writeBundle writes to disk (writer-layer guard
 *      preserves seeded-once files automatically; no opt-in filter).
 *   5. User then runs `clawhq apply`.
 *
 * Pre-fix outcome: step 5 fails with "No composition.profile" because the
 * wizard wrote a composition-less yaml. A hundred real blueprints broke
 * their deployments silently the same way.
 *
 * Post-fix outcome: the wizard's yaml carries composition.profile +
 * composition.personality; apply succeeds and emits a runnable deployment.
 *
 * This test would fail pre-fix. Keep it — removing it reopens a
 * full-outage failure mode.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as yamlParse } from "yaml";


import { bundleToFiles } from "../../cli/commands/helpers.js";
import { GATEWAY_DEFAULT_PORT, OLLAMA_DEFAULT_MODEL } from "../../config/defaults.js";
import { apply } from "../../evolve/apply/index.js";
import { loadBlueprint, listBuiltinBlueprints } from "../blueprints/loader.js";

import { generateBundle } from "./generate.js";
import type { WizardAnswers } from "./types.js";
import { writeBundle } from "./writer.js";

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
  };
}

function runWizardWriteCycle(blueprintName: string): void {
  // Simulate --reset: the deploy is fresh, clawhq.yaml doesn't exist yet.
  const answers = wizardAnswersFor(blueprintName);
  const bundle = generateBundle(answers);
  const files = bundleToFiles(
    bundle,
    answers.blueprint,
    answers.customizationAnswers,
    Object.keys(answers.integrations),
  );
  // Seed a minimal USER.md so apply's user-context read succeeds; the wizard
  // identity files would normally cover this but bundleToFiles doesn't know
  // about the post-wizard USER.md merge path. This keeps the test focused
  // on the yaml/composition contract, not identity wiring.
  const workspace = join(deployDir, "workspace");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, "USER.md"), "**Name:** Test User\n**Timezone:** America/Los_Angeles\n");
  writeBundle(deployDir, files);
}

describe("init --reset + apply round-trip (20260421 regression)", () => {
  for (const blueprintName of listBuiltinBlueprints()) {
    it(`[${blueprintName}] wizard-written yaml has composition.profile`, () => {
      runWizardWriteCycle(blueprintName);

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

  it("apply --dry-run succeeds on a wizard-written yaml (life-ops family-hub)", async () => {
    runWizardWriteCycle("family-hub");

    const result = await apply({ deployDir, dryRun: true });
    expect(
      result.success,
      `apply failed: ${result.success ? "" : result.error}`,
    ).toBe(true);
  });
});
