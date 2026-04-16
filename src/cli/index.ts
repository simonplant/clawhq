#!/usr/bin/env node

/**
 * ClawHQ CLI entry point.
 *
 * Flat command structure (AD-01): `clawhq doctor`, not `clawhq operate doctor`.
 * Modules are internal source organization, never user-facing.
 *
 * Commands grouped by lifecycle phase for --help display only.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "commander";

import { loadConfig } from "../config/loader.js";

import { registerApplyCommand } from "./commands/apply.js";
import { registerBuildCommands } from "./commands/build.js";
import { registerCloudCommands } from "./commands/cloud.js";
import { registerDemoCommand } from "./commands/demo.js";
import { registerDesignCommands } from "./commands/design.js";
import { registerEvolveCommands } from "./commands/evolve.js";
import { registerInstallCommands } from "./commands/install.js";
import { registerIntegrateCommands } from "./commands/integrate.js";
import { registerOperateCommands } from "./commands/operate.js";
import { registerPairingCommands } from "./commands/pairing.js";
import { registerProvisionCommands } from "./commands/provision.js";
import { registerQuickstartCommand } from "./commands/quickstart.js";
import { registerSecureCommands } from "./commands/secure.js";
import { CommandError } from "./errors.js";
import { renderError } from "./ux.js";

const pkg = JSON.parse(
  readFileSync(join(fileURLToPath(import.meta.url), "../../../package.json"), "utf-8"),
) as { version: string; description: string };

/**
 * Resolve the default deploy dir with git-style discovery.
 *
 * Order:
 * 1. $CLAWHQ_DEPLOY_DIR env var
 * 2. Walk up from cwd looking for clawhq.yaml; its paths.deployDir wins
 * 3. Fallback: ~/.clawhq
 *
 * Walking up is what sets this apart from loadConfig's own projectPath — a
 * user running clawhq from a subdir of their deploy still lands on the right
 * root. Parsing is delegated to loadConfig so there's one place that owns it.
 */
function resolveDefaultDeployDir(): string {
  const fallback = join(homedir(), ".clawhq");

  const envOverride = process.env["CLAWHQ_DEPLOY_DIR"];
  if (envOverride && envOverride.length > 0) return envOverride;

  let dir = resolve(process.cwd());
  const ceiling = resolve("/");
  for (let i = 0; i < 32 && dir !== ceiling; i++) {
    const candidate = join(dir, "clawhq.yaml");
    let raw: string | undefined;
    try {
      raw = readFileSync(candidate, "utf-8");
    } catch {
      // Not here — walk up.
    }
    if (raw !== undefined) {
      try {
        const cfg = loadConfig({ projectConfigPath: candidate });
        return cfg.paths?.deployDir ?? dir;
      } catch (err) {
        // Found a clawhq.yaml but it's malformed. Silent fallback would
        // re-create the very ghost-tree bug this function exists to prevent.
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`clawhq: warning — ignoring ${candidate}: ${msg}\n`);
        return dir;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return fallback;
}

const DEFAULT_DEPLOY_DIR = resolveDefaultDeployDir();

const program = new Command();

program
  .name("clawhq")
  .description(pkg.description)
  .version(pkg.version, "-v, --version", "Print version");

program
  .command("version")
  .description("Print version info")
  .action(() => {
    console.log(`clawhq v${pkg.version}`);
  });

// ── Register command groups ──────────────────────────────────────────────────

registerDemoCommand(program);
registerQuickstartCommand(program);
registerInstallCommands(program, DEFAULT_DEPLOY_DIR);
registerDesignCommands(program, DEFAULT_DEPLOY_DIR);
registerApplyCommand(program, DEFAULT_DEPLOY_DIR);
registerBuildCommands(program, DEFAULT_DEPLOY_DIR);
registerSecureCommands(program, DEFAULT_DEPLOY_DIR);
registerOperateCommands(program, DEFAULT_DEPLOY_DIR);
registerPairingCommands(program, DEFAULT_DEPLOY_DIR);
registerEvolveCommands(program, DEFAULT_DEPLOY_DIR);
registerIntegrateCommands(program, DEFAULT_DEPLOY_DIR);
registerCloudCommands(program, DEFAULT_DEPLOY_DIR);
registerProvisionCommands(program, DEFAULT_DEPLOY_DIR);

// ── Parse ────────────────────────────────────────────────────────────────────

if (!process.argv.slice(2).length) {
  program.outputHelp();
} else {
  program.parseAsync(process.argv).catch((err: unknown) => {
    if (err instanceof CommandError) {
      if (err.message) console.error(renderError(err));
      process.exit(err.exitCode);
    }
    console.error(renderError(err));
    process.exit(1);
  });
}
