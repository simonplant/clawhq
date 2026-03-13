#!/usr/bin/env node

import { createRequire } from "node:module";

import { Command } from "commander";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string; description: string };

const program = new Command();

program
  .name("clawhq")
  .description(pkg.description)
  .version(pkg.version, "-v, --version", "Print version");

// Version subcommand
program
  .command("version")
  .description("Print version info")
  .action(() => {
    console.log(`clawhq v${pkg.version}`);
  });

// Plan phase
program.command("init").description("Initialize a new agent deployment");
program.command("template").description("Manage agent templates");

// Build phase
program.command("build").description("Build agent container image");

// Secure phase
program.command("scan").description("Scan for PII and leaked secrets");
program.command("creds").description("Check credential health");
program.command("audit").description("View audit logs");

// Deploy phase
program.command("up").description("Deploy agent container");
program.command("down").description("Stop agent container");
program.command("restart").description("Restart agent container");
program.command("connect").description("Connect messaging channel");

// Operate phase
program.command("doctor").description("Run preventive diagnostics");
program.command("status").description("Show agent status dashboard");
program.command("backup").description("Create encrypted backup");
program.command("update").description("Update OpenClaw upstream");
program.command("logs").description("Stream agent logs");

// Evolve phase
program.command("evolve").description("Manage agent capabilities");

// Decommission phase
program.command("export").description("Export portable agent bundle");
program.command("destroy").description("Verified agent destruction");

program.parse();

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
