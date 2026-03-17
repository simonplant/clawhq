/**
 * Centralized CLI UI helpers.
 *
 * Phase-colored labels, status indicators, spinners, section headers,
 * and error formatting. Dependency anchor for all CLI UX features.
 */

import chalk from "chalk";
import ora, { type Ora } from "ora";

/* ------------------------------------------------------------------ */
/*  Phase labels                                                       */
/* ------------------------------------------------------------------ */

export const phase = {
  plan: chalk.cyan("plan"),
  build: chalk.blue("build"),
  secure: chalk.yellow("secure"),
  deploy: chalk.green("deploy"),
  operate: chalk.magenta("operate"),
} as const;

export type Phase = keyof typeof phase;

/** Return a phase-colored label for a given phase name. */
export function phaseLabel(name: Phase): string {
  return phase[name];
}

/* ------------------------------------------------------------------ */
/*  Status indicators                                                  */
/* ------------------------------------------------------------------ */

export const status = {
  pass: chalk.green("✔"),
  fail: chalk.red("✘"),
  warn: chalk.yellow("⚠"),
} as const;

export type Status = keyof typeof status;

/** Return a colored status symbol. */
export function statusIndicator(s: Status): string {
  return status[s];
}

/* ------------------------------------------------------------------ */
/*  Spinner factory                                                    */
/* ------------------------------------------------------------------ */

/** Create an ora spinner with consistent defaults. */
export function spinner(text: string): Ora {
  return ora({ text, spinner: "dots" });
}

/* ------------------------------------------------------------------ */
/*  Section header                                                     */
/* ------------------------------------------------------------------ */

/** Print a bold section header with surrounding blank lines. */
export function sectionHeader(title: string): string {
  return `\n${chalk.bold(title)}\n`;
}

/* ------------------------------------------------------------------ */
/*  Error formatting                                                   */
/* ------------------------------------------------------------------ */

/** Format a structured error with code, message, and optional hint. */
export function formatError(code: string, message: string, hint?: string): string {
  const lines: string[] = [
    `${chalk.red("Error")} ${chalk.red.bold(code)}: ${message}`,
  ];
  if (hint) {
    lines.push(`${chalk.yellow("Hint")}: ${hint}`);
  }
  return lines.join("\n");
}
