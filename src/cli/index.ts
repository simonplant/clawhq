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

import { Command } from "commander";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string; description: string };

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

// ── Commands are registered here as they're built ──
// Each command file exports a create*Command() function.
// Group labels use program.commandsGroup() for --help display.

if (!process.argv.slice(2).length) {
  program.outputHelp();
} else {
  program.parseAsync(process.argv).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  });
}
