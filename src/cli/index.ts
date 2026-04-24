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
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "commander";

import { migrateLegacyRegistries, migrateOpsState } from "../cloud/instances/index.js";

import { registerApplyCommand } from "./commands/apply.js";
import { registerBuildCommands } from "./commands/build.js";
import { registerCloudCommands } from "./commands/cloud.js";
import { registerConfigCommands } from "./commands/config.js";
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
import {
  DeployDirAmbiguousError,
  InstanceNotFoundError,
  InstanceSelectorRequiredError,
  resolveDeployDirFromContext,
} from "./resolve-deploy-dir.js";
import { renderError } from "./ux.js";

const pkg = JSON.parse(
  readFileSync(join(fileURLToPath(import.meta.url), "../../../package.json"), "utf-8"),
) as { version: string; description: string };

/**
 * Resolve the target deployDir for this invocation.
 *
 * Fold legacy registries (no-op on fresh installs), then ask the context
 * resolver to map (argv, env, cwd, registry) → deployDir. Errors the user
 * should see — ambiguous multi-instance, unknown --agent, unreachable cloud
 * instance — print to stderr and exit non-zero here, since everything
 * downstream assumes a valid deployDir string.
 */
function resolveDefaultDeployDir(): string {
  migrateLegacyRegistries();
  migrateOpsState();

  try {
    const result = resolveDeployDirFromContext();
    if (result.warning) {
      process.stderr.write(`clawhq: ${result.warning}\n`);
    }
    return result.deployDir;
  } catch (err) {
    if (err instanceof DeployDirAmbiguousError) {
      process.stderr.write(`clawhq: ${err.message}\n`);
      process.exit(1);
    }
    if (err instanceof InstanceNotFoundError) {
      process.stderr.write(`clawhq: ${err.message}\n`);
      process.exit(1);
    }
    if (err instanceof InstanceSelectorRequiredError) {
      process.stderr.write(`clawhq: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

const DEFAULT_DEPLOY_DIR = resolveDefaultDeployDir();

const program = new Command();

program
  .name("clawhq")
  .description(pkg.description)
  .version(pkg.version, "-v, --version", "Print version")
  .option(
    "--agent <name>",
    "Target a specific managed agent by name or id-prefix (see `clawhq cloud fleet list`)",
  );

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
registerConfigCommands(program, DEFAULT_DEPLOY_DIR);
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
