#!/usr/bin/env node

import { createRequire } from "node:module";

import { Command } from "commander";

import { createAgentCommand } from "./agent.js";
import { createAlertsCommand } from "./alerts.js";
import { createBackupCommands } from "./backup.js";
import { createBuildCommand } from "./build.js";
import { createConnectCommand } from "./connect.js";
import { createDashboardCommand } from "./dashboard.js";
import { createDecommissionCommands } from "./decommission.js";
import { checkFirstRun } from "./first-run.js";
import { createDeployCommands } from "./deploy.js";
import { createDigestApprovalCommands } from "./digest-approval.js";
import { createEvolveCommand } from "./evolve.js";
import { createFleetCommand } from "./fleet.js";
import { createIntegrateCommand } from "./integrate.js";
import { createMemoryCommand } from "./memory.js";
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

// Plan phase
program.commandsGroup("Plan:");
program.addCommand(createQuickstartCommand());
createPlanCommands(program);

// Build phase
program.commandsGroup("Build:");
program.addCommand(createBuildCommand());

// Secure phase
program.commandsGroup("Secure:");
createSecureCommands(program);
program.addCommand(createSecretsCommand());

// Deploy phase
program.commandsGroup("Deploy:");
createDeployCommands(program);
program.addCommand(createSmokeCommand());
program.addCommand(createConnectCommand());

// Operate phase
program.commandsGroup("Operate:");
createOperateCommands(program);
program.addCommand(createMemoryCommand());
program.addCommand(createDashboardCommand());
program.addCommand(createRepairCommand());
program.addCommand(createAlertsCommand());
createBackupCommands(program);
createDigestApprovalCommands(program);

// Evolve phase
program.commandsGroup("Evolve:");
program.addCommand(createAgentCommand());
program.addCommand(createEvolveCommand());
registerToolCommand(program);
program.addCommand(createSkillCommand());
program.addCommand(createIntegrateCommand());
program.addCommand(createProviderCommand());

// Fleet phase
program.commandsGroup("Fleet:");
program.addCommand(createFleetCommand());

// Decommission phase
program.commandsGroup("Decommission:");
createDecommissionCommands(program);

// Migrate phase
program.commandsGroup("Migrate:");
program.addCommand(createMigrateCommand());
program.addCommand(createTraceCommand());

checkFirstRun(program);

program.parse();

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
