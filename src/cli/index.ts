#!/usr/bin/env node

import { createRequire } from "node:module";

import { Command } from "commander";

import { createAgentCommand } from "./agent.js";
import { createAlertsCommand } from "./alerts.js";
import { createBackupCommands } from "./backup.js";
import { createBuildCommand } from "./build.js";
import { createConnectCommand } from "./connect.js";
import { createDecommissionCommands } from "./decommission.js";
import { createDeployCommands } from "./deploy.js";
import { createDigestApprovalCommands } from "./digest-approval.js";
import { createEvolveCommand } from "./evolve.js";
import { createFleetCommand } from "./fleet.js";
import { createIntegrateCommand } from "./integrate.js";
import { createMigrateCommand } from "./migrate.js";
import { createOperateCommands } from "./operate.js";
import { createPlanCommands } from "./plan.js";
import { createProviderCommand } from "./provider.js";
import { createQuickstartCommand } from "./quickstart.js";
import { createRepairCommand } from "./repair.js";
import { createSecretsCommand } from "./secrets.js";
import { createSecureCommands } from "./secure.js";
import { createSkillCommand } from "./skill.js";
import { createSmokeCommand } from "./smoke.js";
import { registerToolCommand } from "./tool.js";
import { createTraceCommand } from "./trace.js";

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

// Quickstart (orchestrates init → build → deploy → smoke)
program.addCommand(createQuickstartCommand());

// Plan phase
createPlanCommands(program);

// Build phase
program.addCommand(createBuildCommand());

// Secure phase
createSecureCommands(program);
program.addCommand(createSecretsCommand());
program.addCommand(createProviderCommand());
program.addCommand(createFleetCommand());
program.addCommand(createMigrateCommand());
program.addCommand(createTraceCommand());

// Deploy phase
createDeployCommands(program);

// Smoke test
program.addCommand(createSmokeCommand());

// Connect
program.addCommand(createConnectCommand());

// Operate phase
createOperateCommands(program);

// Repair
program.addCommand(createRepairCommand());

// Alerts
program.addCommand(createAlertsCommand());

// Backup & Update
createBackupCommands(program);

// Agent management
program.addCommand(createAgentCommand());

// Evolve phase (includes autonomy tuning)
program.addCommand(createEvolveCommand());

// CLI tool management
registerToolCommand(program);

// Skill management
program.addCommand(createSkillCommand());

// Integration management
program.addCommand(createIntegrateCommand());

// Decommission phase
createDecommissionCommands(program);

// Digest & Approval
createDigestApprovalCommands(program);

program.parse();

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
