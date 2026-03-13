/**
 * Check: Secrets not embedded in config files.
 * Scans openclaw.json for API key patterns that should be in .env only.
 */

import { readFile } from "node:fs/promises";

import type { Check, CheckResult, DoctorContext } from "../types.js";

// Patterns that indicate embedded secrets
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "Anthropic API key", pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
  { name: "OpenAI API key", pattern: /sk-[a-zA-Z0-9]{20,}/ },
  { name: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "GitHub token", pattern: /ghp_[a-zA-Z0-9]{36}/ },
  { name: "GitHub OAuth token", pattern: /gho_[a-zA-Z0-9]{36}/ },
  { name: "Bearer token", pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/ },
  { name: "Generic API key", pattern: /["'](?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token)["']\s*:\s*["'][^"']{8,}["']/ },
  { name: "Google API key", pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "Slack token", pattern: /xox[bpors]-[0-9a-zA-Z-]{10,}/ },
  { name: "Telegram bot token", pattern: /\d{8,10}:[a-zA-Z0-9_-]{35}/ },
];

export const secretsScanCheck: Check = {
  name: "Secrets scan",

  async run(ctx: DoctorContext): Promise<CheckResult> {
    let content: string;
    try {
      content = await readFile(ctx.configPath, "utf-8");
    } catch {
      return {
        name: this.name,
        status: "warn",
        message: `Cannot read config file at ${ctx.configPath}`,
        fix: `Ensure ${ctx.configPath} exists`,
      };
    }

    const found: string[] = [];
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        found.push(name);
      }
    }

    if (found.length === 0) {
      return {
        name: this.name,
        status: "pass",
        message: "No secrets detected in config files",
        fix: "",
      };
    }

    return {
      name: this.name,
      status: "fail",
      message: `Potential secrets found in config: ${found.join(", ")}`,
      fix: "Move all secrets to .env file and reference them as environment variables",
    };
  },
};
