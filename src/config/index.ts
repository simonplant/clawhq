/**
 * Config loading, validation, and generation.
 * See docs/ARCHITECTURE.md for module responsibilities.
 */

export type {
  OpenClawConfig,
  ClawHQConfig,
  DeploymentBundle,
  CronJobDefinition,
  ValidationResult,
  ValidationStatus,
} from "./schema.js";

export { loadConfig, loadOpenClawConfig, getUserConfigPath, getProjectConfigPath } from "./loader.js";
export type { LoadConfigOptions } from "./loader.js";

export {
  validate,
  validateCronExpression,
  checkIdentityBudget,
  LANDMINE_RULES,
} from "./validator.js";
export type { ValidationContext, LandmineRule } from "./validator.js";

export { generateBundle } from "./generator.js";
export type { GenerateOptions, GenerateResult } from "./generator.js";

// --- Convenience function ---

import { loadConfig, loadOpenClawConfig } from "./loader.js";
import type { ValidationResult } from "./schema.js";
import { validate, type ValidationContext } from "./validator.js";

export interface LoadAndValidateOptions {
  cwd?: string;
  userConfigPath?: string;
  projectConfigPath?: string;
  composeContent?: string;
  envContent?: string;
}

export interface LoadAndValidateResult {
  results: ValidationResult[];
  passed: boolean;
  failures: ValidationResult[];
  warnings: ValidationResult[];
}

export async function loadAndValidate(
  options: LoadAndValidateOptions = {},
): Promise<LoadAndValidateResult> {
  const config = await loadConfig({
    cwd: options.cwd,
    userConfigPath: options.userConfigPath,
    projectConfigPath: options.projectConfigPath,
  });

  const configPath = config.openclaw?.configPath;
  if (!configPath) {
    return {
      results: [],
      passed: false,
      failures: [
        {
          rule: "CONFIG",
          status: "fail",
          message: "OpenClaw config path not configured",
          fix: "Set openclaw.configPath in clawhq.yaml or ~/.clawhq/config.yaml",
        },
      ],
      warnings: [],
    };
  }

  let openclawConfig: Record<string, unknown>;
  try {
    openclawConfig = await loadOpenClawConfig(configPath);
  } catch (err) {
    return {
      results: [],
      passed: false,
      failures: [
        {
          rule: "CONFIG",
          status: "fail",
          message: `Failed to load openclaw.json: ${err instanceof Error ? err.message : String(err)}`,
          fix: `Ensure ${configPath} exists and is valid JSON`,
        },
      ],
      warnings: [],
    };
  }

  const ctx: ValidationContext = {
    openclawConfig: openclawConfig as import("./schema.js").OpenClawConfig,
    openclawHome: config.openclaw?.home ?? "~/.openclaw",
    composeContent: options.composeContent,
    envContent: options.envContent,
  };

  const results = validate(ctx);
  const failures = results.filter((r) => r.status === "fail");
  const warnings = results.filter((r) => r.status === "warn");

  return {
    results,
    passed: failures.length === 0,
    failures,
    warnings,
  };
}
