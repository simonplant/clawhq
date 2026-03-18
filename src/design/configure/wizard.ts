/**
 * Init wizard runner — orchestrates all steps for `clawhq init --guided`.
 */

import type { FetchFn } from "./detect.js";
import { generate, type GeneratedConfig } from "./generate.js";
import { stepBasics, stepDetection, stepIntegrations, stepModelRouting, stepTemplate } from "./steps.js";
import { formatSummary } from "./summary.js";
import type { DetectionResult, WizardAnswers, WizardIO } from "./types.js";
import { writeBundle, type WriteResult } from "./writer.js";

export interface WizardResult {
  answers: WizardAnswers;
  config: GeneratedConfig;
  writeResult: WriteResult;
  summary: string;
  detection?: DetectionResult;
}

export async function runWizard(
  io: WizardIO,
  outputDir: string,
  options?: {
    validateCredential?: (envVar: string, value: string) => Promise<boolean>;
    fetchFn?: FetchFn;
    airGapped?: boolean;
  },
): Promise<WizardResult> {
  const airGapped = options?.airGapped ?? false;

  io.log("ClawHQ Init — Guided Setup");
  io.log("==========================");
  io.log("");
  if (airGapped) {
    io.log("AIR-GAPPED MODE: No cloud APIs, no external network access.");
    io.log("Agent will use only local Ollama models. All outbound traffic blocked.");
    io.log("");
  }
  io.log("This wizard will walk you through setting up your OpenClaw agent.");
  io.log("Generated config will be written to: " + outputDir);

  // Step 1: Basics
  const basics = await stepBasics(io);

  // Step 2: Template selection
  const template = await stepTemplate(io);

  let detection: DetectionResult;
  let integrations;
  let modelRouting;

  if (airGapped) {
    // Air-gapped: skip auto-detection and external integrations entirely
    io.log("");
    io.log("Skipping auto-detection and external integrations (air-gapped mode).");
    detection = {
      discoveredIntegrations: null,
      ollamaModels: [],
      routingSuggestions: [],
      ollamaAvailable: false,
    };
    integrations = await stepIntegrations(io, template, options?.validateCredential);
    modelRouting = {
      localOnly: true,
      cloudProviders: [],
      categories: [
        { category: "email", cloudAllowed: false },
        { category: "calendar", cloudAllowed: false },
        { category: "research", cloudAllowed: false },
        { category: "writing", cloudAllowed: false },
        { category: "coding", cloudAllowed: false },
      ],
    };
    io.log("");
    io.log("Model routing: local-only (Ollama). No cloud providers configured.");
  } else {
    // Step 3: Auto-detection — prompt for email to enable provider discovery
    io.log("");
    const emailAddress = await io.prompt("Email address (for service auto-detection, optional)", "");
    detection = await stepDetection(io, template, emailAddress || undefined, options?.fetchFn);

    // Show confirmation of detected services
    const hasDetections = detection.discoveredIntegrations || detection.ollamaModels.length > 0;
    if (hasDetections) {
      const confirmed = await io.confirm("Proceed with detected services?", true);
      if (!confirmed) {
        io.log("  Auto-detection results cleared.");
        detection.discoveredIntegrations = null;
        detection.ollamaModels = [];
        detection.routingSuggestions = [];
      }
    }

    // Step 4: Integration setup (with detection pre-fill)
    integrations = await stepIntegrations(io, template, options?.validateCredential, detection);

    // Step 5: Model routing (with detection suggestions)
    modelRouting = await stepModelRouting(io, detection);
  }

  const answers: WizardAnswers = {
    basics,
    template,
    integrations,
    modelRouting,
    ...(airGapped ? { airGapped: true } : {}),
  };

  // Step 6: Config generation
  io.log("");
  io.log("Step 6/6: Config Generation");
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
      detection,
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

  return { answers, config, writeResult, summary, detection };
}
