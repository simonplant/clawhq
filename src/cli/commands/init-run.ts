/**
 * Orchestration helpers extracted from the `clawhq init` action closure.
 *
 * Three goals:
 *   1. Give the destructive-path guard (`--reset` archive) a pure, testable
 *      surface — returning a tagged result instead of printing and throwing.
 *   2. Deduplicate the legacy smart/blueprint/config pipelines, which all
 *      run the same validate → bundleToFiles → writeBundle → print sequence.
 *   3. Translate the various abort/error types into a single CommandError
 *      shape so the action closure doesn't need a 12-line catch tower.
 *
 * The interactive composition wizard stays in design.ts — it's pure UI and
 * doesn't benefit from extraction.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import chalk from "chalk";
import ora from "ora";
import { stringify as yamlStringify } from "yaml";

import {
  addInstance,
  findByName,
  listInstances,
  migrateLegacyRegistries,
  removeInstance,
} from "../../cloud/instances/index.js";
import { FILE_MODE_SECRET } from "../../config/defaults.js";
import { writeFileAtomic } from "../../config/fs-atomic.js";
import { withDeployLock } from "../../config/lock.js";
import {
  ConfigFileError,
  generateBundle,
  SmartInferenceAbortError,
  WizardAbortError,
  type WizardAnswers,
} from "../../design/configure/index.js";
import { apply } from "../../evolve/apply/index.js";
import { archiveDeployment, deploymentExists } from "../../evolve/lifecycle/attic.js";
import { CommandError } from "../errors.js";
import { renderError } from "../ux.js";

// ── Ensure fresh / reset ─────────────────────────────────────────────────────

/**
 * Pure-logic result of the `clawhq init` protective guard. The caller owns
 * printing and error-raising — this function just reports what it would do.
 */
export type EnsureFreshResult =
  | { readonly kind: "fresh" }
  | { readonly kind: "archived"; readonly archivePath: string }
  | { readonly kind: "refused" };

/**
 * Decide whether `init` can proceed against `deployDir`.
 *
 * - fresh     → no existing deployment, proceed.
 * - archived  → existing deployment moved aside, proceed.
 * - refused   → existing deployment and `--reset` not passed; caller must bail.
 */
export function ensureFreshOrReset(
  deployDir: string,
  reset: boolean,
): EnsureFreshResult {
  if (!deploymentExists(deployDir)) return { kind: "fresh" };
  if (!reset) return { kind: "refused" };
  const { archivePath } = archiveDeployment(deployDir);
  return { kind: "archived", archivePath };
}

/**
 * Print the user-facing message for a guard result and throw CommandError
 * when the result refuses the init. Split from the logic so tests can verify
 * the decision without capturing stdout.
 */
export function applyEnsureFreshResult(
  result: EnsureFreshResult,
  deployDir: string,
): void {
  switch (result.kind) {
    case "fresh":
      return;
    case "archived":
      console.log(chalk.yellow("  ⚠ existing deployment archived"));
      console.log(chalk.dim(`    from: ${deployDir}`));
      console.log(chalk.dim(`    to:   ${result.archivePath}`));
      console.log(chalk.dim("    (recover via: mv <archive> <deployDir>)\n"));
      return;
    case "refused":
      console.error(chalk.red("\n  ✘ clawhq.yaml already exists at ") + deployDir);
      console.error(chalk.dim("\n  `init` is for first-time setup. For an existing deployment:"));
      console.error(chalk.dim("    • reconfigure:       ") + chalk.bold(`clawhq apply -d ${deployDir}`));
      console.error(chalk.dim("    • add integrations:  ") + chalk.bold("clawhq integrate add <name>"));
      console.error(chalk.dim("    • wipe and re-forge: ") + chalk.bold(`clawhq init --reset -d ${deployDir}`));
      console.error(chalk.dim("\n  (--reset archives the current deployment to a timestamped sibling before wiping.)\n"));
      throw new CommandError("", 1);
  }
}

// ── Instance registry wiring ─────────────────────────────────────────────────

/**
 * Mint this deployment's uuid and record it in the unified instance registry.
 *
 * - Runs legacy-registry migration first (idempotent).
 * - Drops any stale local entry pointing at the same deployDir (handles the
 *   `--reset` case where init archives the old deployment).
 * - Resolves a unique name: prefers `clawhqConfig.instanceName`, else the
 *   deployDir basename. On name collision, suffixes `-2`, `-3`, …
 *
 * Returns the minted uuid for the caller to embed in `clawhq.yaml`.
 */
export function registerInstanceForInit(
  answers: WizardAnswers,
  clawhqConfig: { readonly instanceName?: string; readonly composition?: { readonly profile?: string } },
  registryRoot?: string,
): string {
  // Fold legacy fleet.json + cloud/instances.json into the new registry if
  // they haven't been migrated yet. No-op on fresh installs.
  migrateLegacyRegistries(registryRoot);

  // Reset path: archiveDeployment has already moved the old files aside, but
  // the old registry entry for this deployDir is still present. Drop it.
  const targetDir = resolve(answers.deployDir);
  for (const existing of listInstances(registryRoot)) {
    if (existing.location.kind === "local" && resolve(existing.location.deployDir) === targetDir) {
      removeInstance(existing.id, registryRoot);
    }
  }

  const preferred = clawhqConfig.instanceName ?? basename(targetDir);
  let name = preferred;
  let suffix = 2;
  while (findByName(name, registryRoot)) {
    name = `${preferred}-${suffix}`;
    suffix += 1;
  }

  const id = randomUUID();
  addInstance(
    {
      id,
      name,
      status: "initialized",
      ...(clawhqConfig.composition?.profile
        ? { blueprint: clawhqConfig.composition.profile }
        : {}),
      location: { kind: "local", deployDir: answers.deployDir },
    },
    registryRoot,
  );
  return id;
}

// ── Shared forge pipeline (legacy smart/config-file paths) ───────────────────

/**
 * Write ONLY the files that flow from the wizard to disk — composition
 * manifest, user context, and integration credentials. `apply()` produces
 * every other file from these inputs.
 *
 * Replaces the old bundleToFiles → writeBundle path: that pipeline emitted
 * the same 50+ files that `clawhq apply` produces, creating a parallel
 * compile surface that drifted from the real one. Seeding only the
 * user-input files and delegating the rest to apply eliminates the drift.
 */
function seedFromAnswers(answers: WizardAnswers, registryRoot?: string): void {
  const bundle = generateBundle(answers);
  const instanceId = registerInstanceForInit(answers, bundle.clawhqConfig, registryRoot);

  // clawhq.yaml — the user's manifest. buildClawHQConfig emits the
  // composition block (fixed in c80b8de). instanceId anchors this
  // deployment in the unified instance registry.
  writeFileAtomic(
    join(answers.deployDir, "clawhq.yaml"),
    yamlStringify({ instanceId, ...bundle.clawhqConfig }),
  );

  // workspace/USER.md — user context drives apply's identity rendering.
  const userMd = bundle.identityFiles.find((f) => f.path === "workspace/USER.md");
  if (userMd) {
    mkdirSync(join(answers.deployDir, "workspace"), { recursive: true });
    writeFileAtomic(join(answers.deployDir, userMd.path), userMd.content);
  }

  // engine/.env — integration credentials. Apply's .env merge preserves
  // these over the compiler's CHANGE_ME placeholders.
  const envContent = Object.entries(bundle.envVars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";
  mkdirSync(join(answers.deployDir, "engine"), { recursive: true });
  writeFileAtomic(
    join(answers.deployDir, "engine/.env"),
    envContent,
    FILE_MODE_SECRET,
  );
}

/**
 * The shared "got WizardAnswers, now finish the forge" pipeline. Used by
 * both --smart / --blueprint and the legacy --config branch.
 *
 * Seeds the wizard-input files and delegates to apply(), which runs
 * landmine validation against the real compile output and refuses to
 * write on failure. One reconciler, not two.
 *
 * Throws CommandError on apply failure.
 */
export async function forgeFromAnswers(answers: WizardAnswers): Promise<void> {
  // Hold the deploy lock for the whole forge so seed + apply run
  // atomically — no concurrent `clawhq build` / `apply` can sneak between
  // the yaml/USER.md seed and apply's regen. Reentrant-by-pid: the inner
  // apply() call sees our lock and doesn't re-acquire.
  await withDeployLock(answers.deployDir, async () => {
    // Seed the user-input files so apply has a manifest to regenerate from.
    seedFromAnswers(answers);

    // Apply compiles, validates landmines against the compile output, and
    // writes. Same code path users run every subsequent time — no parallel
    // validation pipeline off a separate shim type.
    const applySpinner = ora("Applying config…").start();
    const result = await apply({ deployDir: answers.deployDir });
    if (!result.success) {
      applySpinner.fail(`Apply failed: ${result.error ?? "unknown error"}`);
      throw new CommandError("", 1);
    }
    const changed = result.report.added.length + result.report.changed.length;
    applySpinner.succeed(`Config applied (${changed} file(s))`);

    console.log(chalk.green(`\n✔ Agent forged successfully`));
    console.log(chalk.dim(`\n  Next: clawhq up`));
  });
}

// ── Error translation ────────────────────────────────────────────────────────

/**
 * Map any error thrown from the init pipeline to a CommandError with the
 * right exit code and (already-printed) user message. The action closure
 * re-throws whatever this returns.
 *
 * - CommandError pass-through (already classified upstream)
 * - Wizard/SmartInference abort or Ctrl-C → exit 0 with "cancelled" notice
 * - ConfigFileError → red one-liner, exit 1
 * - anything else → renderError + exit 1
 */
export function translateInitError(error: unknown): CommandError {
  if (error instanceof CommandError) return error;

  if (error instanceof WizardAbortError || error instanceof SmartInferenceAbortError) {
    console.log(chalk.yellow("\nSetup cancelled."));
    return new CommandError("", 0);
  }

  if ((error as Error | undefined)?.name === "ExitPromptError") {
    console.log(chalk.yellow("\nSetup cancelled."));
    return new CommandError("", 0);
  }

  if (error instanceof ConfigFileError) {
    console.error(chalk.red(`\n  ✘ ${error.message}\n`));
    return new CommandError("", 1);
  }

  console.error(renderError(error));
  return new CommandError("", 1);
}
