/**
 * Init wizard runner — orchestrates all steps for `clawhq init --guided`.
 */

import { generate, type GeneratedConfig } from "./generate.js";
import { stepBasics, stepIntegrations, stepModelRouting, stepTemplate } from "./steps.js";
import { formatSummary } from "./summary.js";
import type { WizardAnswers, WizardIO } from "./types.js";
import { writeBundle, type WriteResult } from "./writer.js";

export interface WizardResult {
  answers: WizardAnswers;
  config: GeneratedConfig;
  writeResult: WriteResult;
  summary: string;
}

export async function runWizard(
  io: WizardIO,
  outputDir: string,
  options?: {
    validateCredential?: (envVar: string, value: string) => Promise<boolean>;
  },
): Promise<WizardResult> {
  io.log("ClawHQ Init — Guided Setup");
  io.log("==========================");
  io.log("");
  io.log("This wizard will walk you through setting up your OpenClaw agent.");
  io.log("Generated config will be written to: " + outputDir);

  // Step 1: Basics
  const basics = await stepBasics(io);

  // Step 2: Template selection
  const template = await stepTemplate(io);

  // Step 3: Integration setup
  const integrations = await stepIntegrations(io, template, options?.validateCredential);

  // Step 4: Model routing
  const modelRouting = await stepModelRouting(io);

  const answers: WizardAnswers = {
    basics,
    template,
    integrations,
    modelRouting,
  };

  // Step 5: Config generation
  io.log("");
  io.log("Step 5/5: Config Generation");
  io.log("───────────────────────────");
  io.log("");
  io.log("Generating configuration files...");

  const config = generate(answers);

  if (!config.validationPassed) {
    const failures = config.validationResults.filter((r) => r.status === "fail");
    io.log("");
    io.log(`WARNING: Validation failed (${failures.length} rule(s) violated).`);
    for (const f of failures) {
      io.log(`  ${f.rule}: ${f.message}`);
    }
    io.log("");
    io.log("Config will not be written until all validation rules pass.");

    return {
      answers,
      config,
      writeResult: { filesWritten: [], errors: ["Validation failed"] },
      summary: formatSummary(answers, config.validationResults, {
        filesWritten: [],
        errors: ["Validation failed — config not written"],
      }),
    };
  }

  io.log("Validation passed. Writing files...");

  const writeResult = await writeBundle(config.bundle, outputDir);

  if (writeResult.errors.length > 0) {
    io.log("");
    io.log("ERROR: Some files could not be written:");
    for (const e of writeResult.errors) {
      io.log(`  ${e}`);
    }
  }

  const summary = formatSummary(answers, config.validationResults, writeResult);
  io.log(summary);

  return { answers, config, writeResult, summary };
}
