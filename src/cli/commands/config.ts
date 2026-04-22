/**
 * Config commands — get/set values in the golden openclaw.json.
 *
 * The golden at `<deployDir>/openclaw.json` is the user-editable source of
 * truth for OpenClaw runtime config. `clawhq restart` / `clawhq apply` sync
 * it into `engine/openclaw.json` (the mounted copy). Editing the golden is
 * the clawhq-managed flow for settings the structured config doesn't model
 * (e.g. agents.defaults.compaction.reserveTokensFloor).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import chalk from "chalk";
import type { Command } from "commander";

import { loadRuntimeConfig, saveRuntimeConfig } from "../../openclaw/runtime-config.js";
import { CommandError } from "../errors.js";
import { ensureInstalled } from "../ux.js";

// ── Dot-path helpers ────────────────────────────────────────────────────────

function splitPath(path: string): string[] {
  const parts = path.split(".").filter((p) => p.length > 0);
  if (parts.length === 0) {
    throw new CommandError("Path is empty");
  }
  return parts;
}

function getAtPath(obj: unknown, parts: readonly string[]): unknown {
  let cur: unknown = obj;
  for (const key of parts) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Mutate `obj` so that `parts` resolves to `value`. Creates intermediate objects. */
function setAtPath(obj: Record<string, unknown>, parts: readonly string[], value: unknown): void {
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const next = cur[key];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Coerce a CLI-provided string into a JSON value. Tries JSON.parse first
 * (handles numbers, booleans, null, quoted strings, arrays, objects); on
 * parse failure, treats the raw string as a plain string value.
 */
function coerceValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function formatValue(value: unknown): string {
  if (value === undefined) return chalk.dim("(unset)");
  return JSON.stringify(value, null, 2);
}

// ── Command ─────────────────────────────────────────────────────────────────

export function registerConfigCommands(program: Command, defaultDeployDir: string): void {
  const config = program
    .command("config")
    .description("Get or set OpenClaw runtime config values (golden openclaw.json)");

  config
    .command("get")
    .description("Read a config value by dot-path (e.g. agents.defaults.model.primary)")
    .argument("<path>", "Dot-path into openclaw.json")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action((path: string, opts: { deployDir: string }) => {
      ensureInstalled(opts.deployDir);
      const goldenPath = join(opts.deployDir, "openclaw.json");
      if (!existsSync(goldenPath)) {
        console.error(chalk.red(`No golden config at ${goldenPath}`));
        throw new CommandError("", 1);
      }
      const cfg = loadRuntimeConfig(goldenPath);
      const parts = splitPath(path);
      const value = getAtPath(cfg, parts);
      console.log(formatValue(value));
    });

  config
    .command("set")
    .description("Set a config value by dot-path. Writes the golden; run `clawhq restart` to sync to the engine.")
    .argument("<path>", "Dot-path into openclaw.json")
    .argument("<value>", "Value (parsed as JSON if valid, else as a string)")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action((path: string, rawValue: string, opts: { deployDir: string }) => {
      ensureInstalled(opts.deployDir);
      const goldenPath = join(opts.deployDir, "openclaw.json");
      if (!existsSync(goldenPath)) {
        console.error(chalk.red(`No golden config at ${goldenPath}`));
        throw new CommandError("", 1);
      }

      const cfg = loadRuntimeConfig(goldenPath);
      const parts = splitPath(path);
      const prior = getAtPath(cfg, parts);
      const value = coerceValue(rawValue);
      setAtPath(cfg, parts, value);
      saveRuntimeConfig(goldenPath, cfg);

      console.log(chalk.green("✔ Golden config updated"));
      console.log(chalk.dim(`  ${path}: ${formatValue(prior)} → ${formatValue(value)}`));
      console.log(chalk.dim("  Run: clawhq restart    (sync golden → engine)"));
    });

  config
    .command("unset")
    .description("Remove a config value by dot-path. Writes the golden; run `clawhq restart` to sync.")
    .argument("<path>", "Dot-path into openclaw.json")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action((path: string, opts: { deployDir: string }) => {
      ensureInstalled(opts.deployDir);
      const goldenPath = join(opts.deployDir, "openclaw.json");
      if (!existsSync(goldenPath)) {
        console.error(chalk.red(`No golden config at ${goldenPath}`));
        throw new CommandError("", 1);
      }

      const cfg = loadRuntimeConfig(goldenPath);
      const parts = splitPath(path);
      const prior = getAtPath(cfg, parts);
      if (prior === undefined) {
        console.log(chalk.dim(`${path} was already unset`));
        return;
      }

      // Walk to parent, delete leaf key
      let cur: unknown = cfg;
      for (let i = 0; i < parts.length - 1; i++) {
        if (cur === null || typeof cur !== "object" || Array.isArray(cur)) {
          console.log(chalk.dim(`${path} was already unset`));
          return;
        }
        cur = (cur as Record<string, unknown>)[parts[i]];
      }
      if (cur !== null && typeof cur === "object" && !Array.isArray(cur)) {
        delete (cur as Record<string, unknown>)[parts[parts.length - 1]];
      }
      saveRuntimeConfig(goldenPath, cfg);

      console.log(chalk.green("✔ Golden config updated"));
      console.log(chalk.dim(`  ${path}: ${formatValue(prior)} → (unset)`));
      console.log(chalk.dim("  Run: clawhq restart    (sync golden → engine)"));
    });
}
