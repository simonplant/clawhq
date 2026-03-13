/**
 * Check: OpenClaw config passes all 14 landmine validation rules.
 * Delegates to the config validator.
 */

import { readFile } from "node:fs/promises";

import { loadOpenClawConfig } from "../../config/loader.js";
import type { OpenClawConfig, ValidationResult } from "../../config/schema.js";
import { validate, type ValidationContext } from "../../config/validator.js";
import type { Check, CheckResult, DoctorContext } from "../types.js";

export const configValidationCheck: Check = {
  name: "Config validation",

  async run(ctx: DoctorContext): Promise<CheckResult> {
    let openclawConfig: OpenClawConfig;
    try {
      openclawConfig = await loadOpenClawConfig(ctx.configPath) as OpenClawConfig;
    } catch (err: unknown) {
      return {
        name: this.name,
        status: "fail",
        message: `Cannot load openclaw.json: ${err instanceof Error ? err.message : String(err)}`,
        fix: `Ensure ${ctx.configPath} exists and is valid JSON`,
      };
    }

    let composeContent: string | undefined;
    if (ctx.composePath) {
      try {
        composeContent = await readFile(ctx.composePath, "utf-8");
      } catch {
        // Compose file not found — validation will warn where needed
      }
    }

    let envContent: string | undefined;
    if (ctx.envPath) {
      try {
        envContent = await readFile(ctx.envPath, "utf-8");
      } catch {
        // .env not found — validation will warn where needed
      }
    }

    const valCtx: ValidationContext = {
      openclawConfig,
      openclawHome: ctx.openclawHome,
      composePath: ctx.composePath,
      composeContent,
      envPath: ctx.envPath,
      envContent,
    };

    const results = validate(valCtx);
    const failures = results.filter((r: ValidationResult) => r.status === "fail");
    const warnings = results.filter((r: ValidationResult) => r.status === "warn");

    if (failures.length > 0) {
      return {
        name: this.name,
        status: "fail",
        message: `${failures.length} rule(s) failed: ${failures.map((f: ValidationResult) => f.rule).join(", ")}`,
        fix: failures.map((f: ValidationResult) => `${f.rule}: ${f.fix}`).join("; "),
      };
    }

    if (warnings.length > 0) {
      return {
        name: this.name,
        status: "warn",
        message: `${warnings.length} warning(s): ${warnings.map((w: ValidationResult) => w.rule).join(", ")}`,
        fix: warnings.map((w: ValidationResult) => `${w.rule}: ${w.fix}`).join("; "),
      };
    }

    return {
      name: this.name,
      status: "pass",
      message: "All 14 landmine rules pass",
      fix: "",
    };
  },
};
