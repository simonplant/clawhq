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

import chalk from "chalk";
import ora from "ora";

import { validateBundle } from "../../config/validate.js";
import {
  ConfigFileError,
  generateBundle,
  SmartInferenceAbortError,
  WizardAbortError,
  writeBundle,
  type WizardAnswers,
} from "../../design/configure/index.js";
import { archiveDeployment, deploymentExists } from "../../evolve/lifecycle/attic.js";
import { CommandError } from "../errors.js";
import { renderError } from "../ux.js";

import { bundleToFiles } from "./helpers.js";

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

// ── Shared forge pipeline (legacy smart/config-file paths) ───────────────────

/**
 * The shared "got WizardAnswers, now finish the forge" pipeline. Used by
 * both --smart / --blueprint and the legacy --config branch.
 *
 * Throws CommandError on validation failure; otherwise prints the success
 * block and returns.
 */
export function forgeFromAnswers(answers: WizardAnswers): void {
  const spinner = ora("Generating config…");
  spinner.start();
  const bundle = generateBundle(answers);
  const report = validateBundle(bundle);
  if (!report.valid) {
    spinner.fail("Config validation failed");
    for (const err of report.errors) {
      console.error(chalk.red(`  ✘ ${err.rule}: ${err.message}`));
    }
    throw new CommandError("", 1);
  }
  const files = bundleToFiles(
    bundle,
    answers.blueprint,
    answers.customizationAnswers,
    Object.keys(answers.integrations),
  );
  const result = writeBundle(answers.deployDir, files);
  spinner.succeed(`Config written to ${result.deployDir}`);
  for (const warn of report.warnings) {
    console.log(chalk.yellow(`  ⚠ ${warn.rule}: ${warn.message}`));
  }
  console.log(chalk.green(`\n✔ Agent forged successfully`));
  console.log(chalk.dim(`  ${result.written.length} files written`));
  console.log(chalk.dim(`\n  Next: clawhq up`));
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
