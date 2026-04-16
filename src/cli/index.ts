#!/usr/bin/env node

/**
 * ClawHQ CLI entry point.
 *
 * Flat command structure (AD-01): `clawhq doctor`, not `clawhq operate doctor`.
 * Modules are internal source organization, never user-facing.
 *
 * Commands grouped by lifecycle phase for --help display only.
 */

import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

import { Command } from "commander";

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

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string; description: string };

const DEFAULT_DEPLOY_DIR = join(homedir(), ".clawhq");

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
