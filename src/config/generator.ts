/**
 * Deployment bundle generator (stub).
 *
 * Full implementation in FEAT-017/018. This module provides the interface
 * and a skeleton that validates inputs but does not produce real output yet.
 */

import type { ClawHQConfig, DeploymentBundle, OpenClawConfig, ValidationResult } from "./schema.js";
import { validate, type ValidationContext } from "./validator.js";

export interface GenerateOptions {
  templatePath?: string;
  answers?: Record<string, unknown>;
  clawhqConfig: ClawHQConfig;
}

export interface GenerateResult {
  bundle: DeploymentBundle | null;
  validation: ValidationResult[];
  errors: string[];
}

export async function generateBundle(options: GenerateOptions): Promise<GenerateResult> {
  const errors: string[] = [];

  // Stub: in FEAT-017/018, this will:
  // 1. Load the template YAML
  // 2. Merge template defaults with user answers
  // 3. Generate openclaw.json, .env, docker-compose.yml, identity files, cron jobs
  // 4. Validate the generated config against all landmine rules
  // 5. Return the bundle only if validation passes

  if (!options.clawhqConfig) {
    errors.push("ClawHQ config is required for bundle generation");
    return { bundle: null, validation: [], errors };
  }

  // Placeholder config for validation
  const openclawConfig: OpenClawConfig = {
    dangerouslyDisableDeviceAuth: true,
    allowedOrigins: ["http://localhost:18789"],
    trustedProxies: ["172.17.0.1"],
    tools: { exec: { host: "gateway", security: "full" } },
    fs: { workspaceOnly: true },
  };

  const ctx: ValidationContext = {
    openclawConfig,
    openclawHome: options.clawhqConfig.openclaw?.home ?? "~/.openclaw",
  };

  const validation = validate(ctx);
  const failures = validation.filter((r) => r.status === "fail");

  if (failures.length > 0) {
    errors.push(
      `Validation failed: ${failures.length} rule(s) violated`,
    );
    return { bundle: null, validation, errors };
  }

  // Stub bundle — full generation not yet implemented
  errors.push("Bundle generation not yet implemented (stub) — see FEAT-017/018");
  return { bundle: null, validation, errors };
}
