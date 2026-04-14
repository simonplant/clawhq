import type { Command } from "commander";

import chalk from "chalk";
import ora from "ora";

import type { TrustMode } from "../../config/types.js";
import {
  connectCloud,
  connectSentinel,
  disconnectCloud,
  disconnectSentinel,
  formatAlerts,
  formatAlertsJson,
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
  generateFingerprint,
  getFleetHealth,
  getPricingUrl,
  readFleetRegistry,
  readHeartbeatState,
  readQueueState,
  readSentinelState,
  readTrustModeState,
  registerAgent,
  runFleetDoctor,
  runSentinelCheck,
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

      const result = connectCloud(opts.deployDir);
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
      const health = await getFleetHealth(opts.deployDir);

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

  // ── Sentinel Monitoring ─────────────────────────────────────────────────

  const sentinel = cloud.command("sentinel").description("Upstream intelligence monitoring (~$19/mo)");

  sentinel
    .command("connect")
    .description("Subscribe to Sentinel upstream monitoring")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("-t, --token <token>", "Sentinel API token (from clawhq.com/sentinel)")
    .option("-w, --webhook <url>", "Webhook URL for alert delivery")
    .option("-e, --email <email>", "Email address for alert delivery")
    .action(async (opts: { deployDir: string; token?: string; webhook?: string; email?: string }) => {
      ensureInstalled(opts.deployDir);

      const spinner = ora("Connecting to Sentinel…");
      spinner.start();

      try {
        const result = await connectSentinel(opts.deployDir, {
          token: opts.token,
          webhookUrl: opts.webhook,
          alertEmail: opts.email,
        });

        spinner.stop();

        if (result.success) {
          console.log(chalk.green("Sentinel monitoring activated."));
          console.log(chalk.dim(`  Tier: ${result.tier}`));
          if (!opts.token) {
            console.log(chalk.dim(`  Running in free tier (local checks only).`));
            console.log(chalk.dim(`  Upgrade: ${getPricingUrl()}`));
          }
          if (opts.webhook) console.log(chalk.dim(`  Webhook: ${opts.webhook}`));
          if (opts.email) console.log(chalk.dim(`  Email: ${opts.email}`));
          console.log(chalk.dim("  Disconnect anytime: clawhq cloud sentinel disconnect"));
        } else {
          console.error(chalk.red(result.error ?? "Failed to connect."));
          throw new CommandError("", 1);
        }
      } finally {
        spinner.stop();
      }
    });

  sentinel
    .command("status")
    .description("Sentinel subscription status and recent alerts")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; json?: boolean }) => {
      ensureInstalled(opts.deployDir);

      const state = readSentinelState(opts.deployDir);

      if (opts.json) {
        console.log(JSON.stringify(state, null, 2));
      } else {
        console.log(`Sentinel: ${state.active ? chalk.green("active") : chalk.dim("inactive")}`);
        console.log(chalk.dim(`  Tier: ${state.tier}`));
        if (state.lastCheckAt) console.log(chalk.dim(`  Last check: ${state.lastCheckAt}`));
        if (state.consecutiveFailures > 0) {
          console.log(chalk.yellow(`  Consecutive failures: ${state.consecutiveFailures}`));
        }
        if (state.lastError) console.log(chalk.red(`  Last error: ${state.lastError}`));
        if (!state.active) {
          console.log(chalk.dim(`\n  Activate: clawhq cloud sentinel connect`));
          console.log(chalk.dim(`  Pricing: ${getPricingUrl()}`));
        }
      }
    });

  sentinel
    .command("disconnect")
    .description("Stop Sentinel monitoring")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (opts: { deployDir: string }) => {
      ensureInstalled(opts.deployDir);

      const result = disconnectSentinel(opts.deployDir);
      if (result.wasActive) {
        console.log(chalk.green("Sentinel monitoring deactivated."));
      } else {
        console.log(chalk.dim("Sentinel was not active."));
      }
    });

  sentinel
    .command("check")
    .description("Run an upstream check — scan for config-breaking changes")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; json?: boolean }) => {
      ensureInstalled(opts.deployDir);

      const spinner = ora("Checking upstream for config-impacting changes…");
      if (!opts.json) spinner.start();

      try {
        const result = await runSentinelCheck(opts.deployDir);

        if (!opts.json) spinner.stop();

        if (!result.success) {
          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.error(chalk.red(result.error ?? "Sentinel check failed."));
          }
          throw new CommandError("", 1);
        }

        if (opts.json) {
          console.log(formatAlertsJson(result.alerts));
        } else if (result.alerts.length === 0) {
          console.log(chalk.green("No config-breaking changes detected upstream."));
          if (result.breakageReport) {
            console.log(chalk.dim(`  Commits analyzed: ${result.breakageReport.commitsAnalyzed}`));
          }
        } else {
          console.log(formatAlerts(result.alerts));
          if (result.breakageReport?.shouldHoldUpdate) {
            console.log(chalk.yellow("\n  Recommendation: Hold off on updating until you address the above."));
          }
        }
      } finally {
        spinner.stop();
      }
    });

  sentinel
    .command("fingerprint")
    .description("Show your config fingerprint (what Sentinel sees — never values)")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; json?: boolean }) => {
      ensureInstalled(opts.deployDir);

      const fingerprint = generateFingerprint(opts.deployDir);

      if (opts.json) {
        console.log(JSON.stringify(fingerprint, null, 2));
      } else {
        console.log("Config Fingerprint (privacy-safe — structural metadata only)");
        console.log(chalk.dim("─".repeat(60)));
        console.log(`  Agent ID:       ${fingerprint.agentId}`);
        console.log(`  OpenClaw:       ${fingerprint.openclawVersion}`);
        if (fingerprint.blueprintId) console.log(`  Blueprint:      ${fingerprint.blueprintId}`);
        console.log(`  Config keys:    ${fingerprint.configKeysSet.join(", ") || "(none)"}`);
        console.log(`  Tools:          ${fingerprint.toolsEnabled.join(", ") || "(none)"}`);
        console.log(`  Channels:       ${fingerprint.channelsConfigured.join(", ") || "(none)"}`);
        console.log(`  Cron jobs:      ${fingerprint.cronJobCount}`);
        console.log(`  Identity:       ${fingerprint.hasIdentityConfig ? "custom" : "default"}`);
        console.log(`  Gateway:        ${fingerprint.hasGatewayConfig ? "custom" : "default"}`);
        console.log(`  Multi-agent:    ${fingerprint.hasAgentsConfig ? "yes" : "no"}`);
        console.log(`  Landmines OK:   ${fingerprint.landminesPassed.join(", ") || "(none checked)"}`);
        console.log(chalk.dim("\n  This is what Sentinel uses to predict breakage."));
        console.log(chalk.dim("  No values, credentials, or content are ever shared."));
      }
    });

  sentinel
    .command("pricing")
    .description("Open the Sentinel pricing page for subscription signup")
    .action(async () => {
      const url = getPricingUrl();
      console.log(`Sentinel Upstream Monitoring — ~$19/mo`);
      console.log(chalk.dim("─".repeat(60)));
      console.log(`\n  What you get:`);
      console.log(`  - Pre-computed config breakage alerts before you update`);
      console.log(`  - CVE tracking mapped to your specific skill inventory`);
      console.log(`  - Skill dependency change notifications`);
      console.log(`  - Anonymized fleet health intelligence`);
      console.log(`\n  What a cron job can't do:`);
      console.log(`  - Cross-reference upstream commits against YOUR config`);
      console.log(`  - Map CVEs to YOUR installed skills and tools`);
      console.log(`  - Detect breaking changes before they hit you`);
      console.log(`  - Aggregate patterns across the fleet`);
      console.log(`\n  Sign up: ${chalk.cyan(url)}`);
      console.log(chalk.dim(`\n  Free tier: clawhq cloud sentinel connect (local checks only)`));
      console.log(chalk.dim(`  Pro tier:  clawhq cloud sentinel connect -t <your-token>`));
    });
}
