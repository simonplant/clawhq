/**
 * First-run experience — shows a one-line quickstart hint on fresh installs.
 *
 * State file: ~/.clawhq/state.json
 * Triggered via Commander preAction hook; skipped for non-TTY, --json, CI,
 * and init/quickstart/dashboard/help/version commands.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import chalk from "chalk";
import type { Command } from "commander";

/** Commands that should never show the first-run hint. */
const SKIP_COMMANDS = new Set(["init", "quickstart", "dashboard", "help", "version"]);

interface StateFile {
  firstRunComplete: boolean;
}

function resolveHome(p: string): string {
  return p.replace(/^~/, process.env.HOME ?? "~");
}

function statePath(clawhqDir: string): string {
  return join(resolveHome(clawhqDir), "state.json");
}

async function readState(clawhqDir: string): Promise<StateFile> {
  try {
    const raw = await readFile(statePath(clawhqDir), "utf-8");
    return JSON.parse(raw) as StateFile;
  } catch {
    return { firstRunComplete: false };
  }
}

/**
 * Register a Commander preAction hook that prints a quickstart hint
 * when no OpenClaw config exists and the first run hasn't been completed.
 */
export function checkFirstRun(
  program: Command,
  options?: { clawhqDir?: string; openclawHome?: string },
): void {
  const clawhqDir = options?.clawhqDir ?? "~/.clawhq";
  const openclawHome = options?.openclawHome ?? "~/.openclaw";

  program.hook("preAction", async (_thisCommand, actionCommand) => {
    // Skip in non-TTY environments
    if (!process.stdout.isTTY) return;

    // Skip if CI
    if (process.env.CI) return;

    // Skip if --json flag is present
    const rawArgs = process.argv.slice(2);
    if (rawArgs.includes("--json")) return;

    // Skip for exempt commands
    const cmdName = actionCommand.name();
    if (SKIP_COMMANDS.has(cmdName)) return;

    // Skip if OpenClaw config already exists
    const configPath = join(resolveHome(openclawHome), "openclaw.json");
    if (existsSync(configPath)) return;

    // Skip if first run already completed
    const state = await readState(clawhqDir);
    if (state.firstRunComplete) return;

    console.log(chalk.yellow("Run `clawhq quickstart` to set up your agent."));
    console.log("");
  });
}

/**
 * Mark the first-run experience as complete by writing state.json.
 */
export async function markFirstRunComplete(clawhqDir: string): Promise<void> {
  const filePath = statePath(clawhqDir);
  await mkdir(dirname(filePath), { recursive: true });
  const state: StateFile = { firstRunComplete: true };
  await writeFile(filePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
}
