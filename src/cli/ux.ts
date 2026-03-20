/**
 * CLI UX helpers — error formatting, spinner wrapper, first-run detection.
 *
 * Centralizes terminal output concerns so command handlers stay focused
 * on business logic.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import chalk from "chalk";

// ── Error Formatting ────────────────────────────────────────────────────────

/** Known error types that get specific formatting. */
interface FormattedError {
  title: string;
  detail: string;
  hint?: string;
}

/**
 * Format an error for clean terminal display.
 *
 * Maps known error types to human-readable output with hints.
 * Unknown errors get a generic format with the raw message.
 */
export function formatError(error: unknown): FormattedError {
  if (error instanceof Error) {
    // Match known error names for specific hints
    switch (error.name) {
      case "ConnectionError":
        return {
          title: "Connection failed",
          detail: error.message,
          hint: "Is the agent running? Try: clawhq up",
        };
      case "AuthError":
        return {
          title: "Authentication failed",
          detail: error.message,
          hint: "Check your gateway token: --token or CLAWHQ_GATEWAY_TOKEN",
        };
      case "RateLimitError":
        return {
          title: "Rate limit exceeded",
          detail: error.message,
          hint: "Wait a moment and try again",
        };
      case "RpcTimeoutError":
        return {
          title: "Request timed out",
          detail: error.message,
          hint: "The gateway may be overloaded. Check: clawhq status",
        };
      default:
        return {
          title: "Error",
          detail: error.message,
        };
    }
  }

  return {
    title: "Error",
    detail: String(error),
  };
}

/**
 * Render a FormattedError to a string for terminal output.
 */
export function renderError(error: unknown): string {
  const formatted = formatError(error);
  const lines: string[] = [];

  lines.push(chalk.red(`✘ ${formatted.title}: ${formatted.detail}`));

  if (formatted.hint) {
    lines.push(chalk.dim(`  → ${formatted.hint}`));
  }

  return lines.join("\n");
}

// ── Port Validation ─────────────────────────────────────────────────────────

/**
 * Parse and validate a port string. Exits with an error if the value is not a valid number.
 */
export function validatePort(portStr: string): number {
  const port = parseInt(portStr, 10);
  if (isNaN(port)) {
    console.error(chalk.red("Invalid port number"));
    process.exit(1);
  }
  return port;
}

// ── First-Run Detection ─────────────────────────────────────────────────────

export interface FirstRunResult {
  installed: boolean;
  deployDir: string;
}

/**
 * Check whether ClawHQ has been installed.
 *
 * Looks for the deployment directory and the meta-config file.
 * Returns the status and the path that was checked.
 */
export function checkFirstRun(deployDir?: string): FirstRunResult {
  const dir = deployDir ?? join(homedir(), ".clawhq");
  const metaConfig = join(dir, "clawhq.yaml");

  return {
    installed: existsSync(dir) && existsSync(metaConfig),
    deployDir: dir,
  };
}

/**
 * Print first-run guidance if the platform isn't installed.
 *
 * Called before commands that require an installed platform.
 * Returns true if the platform is missing (caller should exit).
 */
export function warnIfNotInstalled(deployDir?: string): boolean {
  const result = checkFirstRun(deployDir);

  if (!result.installed) {
    console.log(chalk.yellow("ClawHQ is not installed yet."));
    console.log(chalk.dim(`  Checked: ${result.deployDir}`));
    console.log("");
    console.log(`  Run ${chalk.bold("clawhq install")} to set up the platform.`);
    console.log(
      chalk.dim("  This installs prerequisites, acquires the engine, and scaffolds the deployment directory."),
    );
    return true;
  }

  return false;
}
