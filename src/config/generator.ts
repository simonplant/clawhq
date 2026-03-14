/**
 * Deployment bundle generator.
 *
 * Takes wizard answers and produces a complete DeploymentBundle.
 * Validates against all 14 landmine rules before returning.
 *
 * This is the programmatic API — the init wizard uses init/generate.ts
 * which calls the same underlying generators.
 */

import { generate } from "../init/generate.js";
import type { WizardAnswers } from "../init/types.js";

import type {
  ClawHQConfig,
  DeploymentBundle,
  ValidationResult,
} from "./schema.js";
import { validate, validateCronExpression, type ValidationContext } from "./validator.js";


export interface GenerateOptions {
  templatePath?: string;
  answers?: WizardAnswers;
  clawhqConfig: ClawHQConfig;
}

export interface GenerateResult {
  bundle: DeploymentBundle | null;
  validation: ValidationResult[];
  errors: string[];
}

export async function generateBundle(options: GenerateOptions): Promise<GenerateResult> {
  const errors: string[] = [];

  if (!options.clawhqConfig) {
    errors.push("ClawHQ config is required for bundle generation");
    return { bundle: null, validation: [], errors };
  }

  if (!options.answers) {
    errors.push("Wizard answers are required for bundle generation");
    return { bundle: null, validation: [], errors };
  }

  // Delegate to the init generator which has the full implementation
  const result = generate(options.answers);

  // Re-validate with the ClawHQ config context
  const openclawHome = options.clawhqConfig.openclaw?.home ?? "~/.openclaw";
  const ctx: ValidationContext = {
    openclawConfig: result.bundle.openclawConfig,
    openclawHome,
    composeContent: result.bundle.dockerCompose,
    envContent: Object.entries(result.bundle.envVars)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  };

  const validation = validate(ctx);

  for (const job of result.bundle.cronJobs) {
    if (job.kind === "cron" && job.expr) {
      const cronResult = validateCronExpression(job.expr);
      if (cronResult.status === "fail") {
        validation.push(cronResult);
      }
    }
  }

  const failures = validation.filter((r) => r.status === "fail");
  if (failures.length > 0) {
    errors.push(`Validation failed: ${failures.length} rule(s) violated`);
  }

  return { bundle: result.bundle, validation, errors };
}
