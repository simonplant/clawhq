import type { Command } from "commander";

import chalk from "chalk";
import ora from "ora";

import type { TrustMode } from "../../config/types.js";
import {
  connectCloud,
  disconnectCloud,
  formatCloudStatus,
  formatCloudStatusJson,
  formatDisconnectResult,
  formatFleetDoctor,
  formatFleetDoctorJson,
  formatFleetHealth,
  formatFleetHealthJson,
  formatFleetList,
  formatFleetListJson,
  formatSwitchResult,
  getFleetHealth,
  readFleetRegistry,
  readHeartbeatState,
  readQueueState,
  readTrustModeState,
  registerAgent,
  runFleetDoctor,
  sendHeartbeat,
  switchTrustMode,
  unregisterAgent,
} from "../../cloud/index.js";

import { CommandError } from "../errors.js";
import { ensureInstalled } from "../ux.js";

export function registerCloudCommands(program: Command, defaultDeployDir: string): void {
  const cloud = program.command("cloud").description("Remote monitoring and managed hosting (optional)");

  cloud
    .command("connect")
    .description("Link to clawhq.com for remote monitoring")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("-t, --token <token>", "Cloud authentication token")
    .option("-m, --mode <mode>", "Trust mode (zero-trust or managed)", "zero-trust")
    .action(async (opts: { deployDir: string; token?: string; mode: string }) => {
      ensureInstalled(opts.deployDir);

      const mode = opts.mode as TrustMode;
      if (mode !== "zero-trust" && mode !== "managed") {
        console.error(chalk.red("Trust mode must be 'zero-trust' or 'managed'. Paranoid mode disables cloud."));
        throw new CommandError("", 1);
      }

      const current = readTrustModeState(opts.deployDir);
      if (current.mode !== mode) {
        const switchResult = switchTrustMode(opts.deployDir, mode);
        if (!switchResult.success) {
          console.error(chalk.red(formatSwitchResult(switchResult)));
          throw new CommandError("", 1);
        }
        console.log(chalk.dim(formatSwitchResult(switchResult)));
      }

      const result = connectCloud(opts.deployDir, opts.token ?? "");
      if (result.success) {
        console.log(chalk.green("Connected to cloud."));
        console.log(chalk.dim(`  Trust mode: ${mode}`));
        console.log(chalk.dim("  Disconnect anytime: clawhq cloud disconnect"));
      } else {
        console.error(chalk.red(result.error ?? "Failed to connect."));
        throw new CommandError("", 1);
      }
    });

  cloud
    .command("status")
    .description("Cloud connection status and health")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; json?: boolean }) => {
      ensureInstalled(opts.deployDir);

      const snapshot = {
        trustMode: readTrustModeState(opts.deployDir),
        heartbeat: readHeartbeatState(opts.deployDir),
        queue: readQueueState(opts.deployDir),
      };

      if (opts.json) {
        console.log(formatCloudStatusJson(snapshot));
      } else {
        console.log(formatCloudStatus(snapshot));
      }
    });

  cloud
    .command("disconnect")
    .description("Disconnect from cloud — immediate, no confirmation")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (opts: { deployDir: string }) => {
      ensureInstalled(opts.deployDir);

      const result = disconnectCloud(opts.deployDir);
      console.log(formatDisconnectResult(result));
    });

  cloud
    .command("trust-mode")
    .description("View or switch trust mode (paranoid, zero-trust, managed)")
    .argument("[mode]", "New trust mode to switch to")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (mode: string | undefined, opts: { deployDir: string }) => {
      ensureInstalled(opts.deployDir);

      if (!mode) {
        const state = readTrustModeState(opts.deployDir);
        console.log(`Trust mode: ${state.mode}`);
        console.log(chalk.dim(`  Connected: ${state.connected ? "yes" : "no"}`));
        return;
      }

      const validModes: TrustMode[] = ["paranoid", "zero-trust", "managed"];
      if (!validModes.includes(mode as TrustMode)) {
        console.error(chalk.red(`Invalid mode: ${mode}. Must be one of: ${validModes.join(", ")}`));
        throw new CommandError("", 1);
      }

      const result = switchTrustMode(opts.deployDir, mode as TrustMode);
      if (result.success) {
        console.log(chalk.green(formatSwitchResult(result)));
      } else {
        console.error(chalk.red(formatSwitchResult(result)));
        throw new CommandError("", 1);
      }
    });

  cloud
    .command("heartbeat")
    .description("Send a health heartbeat to the cloud")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output report as JSON")
    .action(async (opts: { deployDir: string; json?: boolean }) => {
      ensureInstalled(opts.deployDir);

      const state = readTrustModeState(opts.deployDir);
      if (state.mode === "paranoid") {
        console.error(chalk.red("Heartbeat is disabled in paranoid mode."));
        throw new CommandError("", 1);
      }

      if (!state.connected) {
        console.error(chalk.red("Not connected to cloud. Run: clawhq cloud connect"));
        throw new CommandError("", 1);
      }

      const spinner = ora("Sending heartbeat…");
      if (!opts.json) spinner.start();

      try {
        const result = await sendHeartbeat(opts.deployDir, state.mode);

        if (!opts.json) spinner.stop();

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.success) {
          console.log(chalk.green("Heartbeat sent."));
        } else {
          console.error(chalk.red(`Heartbeat failed: ${result.error}`));
          throw new CommandError("", 1);
        }
      } finally {
        spinner.stop();
      }
    });

  // ── Fleet Management ───────────────────────────────────────────────────────

  const fleet = cloud.command("fleet").description("Multi-agent fleet management");

  fleet
    .command("list")
    .description("List all registered agents")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; json?: boolean }) => {
      const registry = readFleetRegistry(opts.deployDir);

      if (opts.json) {
        console.log(formatFleetListJson(registry));
      } else {
        console.log(formatFleetList(registry));
      }
    });

  fleet
    .command("add")
    .description("Register an agent in the fleet")
    .argument("<name>", "Human-readable label for the agent")
    .argument("<path>", "Absolute path to the agent's deployment directory")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (name: string, agentPath: string, opts: { deployDir: string }) => {
      const agent = registerAgent(opts.deployDir, name, agentPath);
      console.log(chalk.green(`Agent registered: ${agent.name} → ${agent.deployDir}`));
    });

  fleet
    .command("remove")
    .description("Remove an agent from the fleet")
    .argument("<name-or-path>", "Agent name or deployment path to remove")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (nameOrPath: string, opts: { deployDir: string }) => {
      const removed = unregisterAgent(opts.deployDir, nameOrPath);
      if (removed) {
        console.log(chalk.green(`Agent removed: ${nameOrPath}`));
      } else {
        console.error(chalk.red(`Agent not found: ${nameOrPath}`));
        throw new CommandError("", 1);
      }
    });

  fleet
    .command("status")
    .description("Fleet health — aggregate status across all agents")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; json?: boolean }) => {
      const health = getFleetHealth(opts.deployDir);

      if (opts.json) {
        console.log(formatFleetHealthJson(health));
      } else {
        console.log(formatFleetHealth(health));
      }
    });

  fleet
    .command("doctor")
    .description("Fleet-wide doctor — surface issues across all agents")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; json?: boolean }) => {
      const spinner = ora("Running fleet-wide doctor checks…");
      if (!opts.json) spinner.start();

      try {
        const report = await runFleetDoctor(opts.deployDir);

        if (!opts.json) spinner.stop();

        if (opts.json) {
          console.log(formatFleetDoctorJson(report));
        } else {
          console.log(formatFleetDoctor(report));
        }

        if (!report.allHealthy) {
          throw new CommandError("", 1);
        }
      } finally {
        spinner.stop();
      }
    });
}
