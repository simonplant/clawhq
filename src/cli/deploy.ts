/**
 * `clawhq up`, `clawhq down`, and `clawhq restart` commands — Deploy phase.
 */

import chalk from "chalk";
import { Command } from "commander";

import { deployDown, deployRestart, deployUp } from "../build/launcher/deploy.js";
import { formatStepResult, formatSummary } from "../build/launcher/format.js";

import { spinner, status } from "./ui.js";

/**
 * Register Deploy-phase commands (up, down, restart) on the program.
 */
export function createDeployCommands(program: Command): void {
  program
    .command("up")
    .description("Deploy agent container with pre-flight checks, firewall, and health verification")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--config <path>", "Path to openclaw.json", "~/.openclaw/openclaw.json")
    .option("--compose <path>", "Path to docker-compose.yml")
    .option("--env <path>", "Path to .env file")
    .option("--image-tag <tag>", "Expected agent image tag", "openclaw:custom")
    .option("--base-tag <tag>", "Expected base image tag", "openclaw:local")
    .option("--health-timeout <ms>", "Health poll timeout in ms", "60000")
    .option("--gateway-host <host>", "Gateway host", "127.0.0.1")
    .option("--gateway-port <port>", "Gateway port", "18789")
    .option("--providers <list>", "Comma-separated cloud providers for firewall allowlist")
    .option("--bridge <iface>", "Docker bridge interface for firewall", "docker0")
    .action(async (opts: {
      home: string;
      config: string;
      compose?: string;
      env?: string;
      imageTag: string;
      baseTag: string;
      healthTimeout: string;
      gatewayHost: string;
      gatewayPort: string;
      providers?: string;
      bridge: string;
    }) => {
      const homePath = opts.home.replace(/^~/, process.env.HOME ?? "~");
      const configPath = opts.config.replace(/^~/, process.env.HOME ?? "~");
      const envPath = opts.env?.replace(/^~/, process.env.HOME ?? "~");

      const deploySpinner = spinner(`${chalk.green("Deploy")} Starting deployment...`);
      deploySpinner.start();

      const result = await deployUp({
        openclawHome: homePath,
        configPath,
        composePath: opts.compose,
        envPath,
        imageTag: opts.imageTag,
        baseTag: opts.baseTag,
        healthTimeoutMs: parseInt(opts.healthTimeout, 10),
        gatewayHost: opts.gatewayHost,
        gatewayPort: parseInt(opts.gatewayPort, 10),
        enabledProviders: opts.providers?.split(",").map((p) => p.trim()),
        bridgeInterface: opts.bridge,
      });

      if (result.success) {
        deploySpinner.succeed(`${chalk.green("Deploy")} ${status.pass} Deployment complete`);
      } else {
        deploySpinner.fail(`${chalk.green("Deploy")} ${status.fail} Deployment failed`);
      }

      for (let i = 0; i < result.steps.length; i++) {
        console.log(formatStepResult(i + 1, result.steps.length, result.steps[i]));
      }

      console.log(formatSummary("Deployment", result.steps, result.success));

      if (result.containerId) {
        console.log(`Container: ${result.containerId}`);
      }

      if (!result.success) {
        // Show pre-flight details if that was the failure
        const preflightStep = result.steps.find((s) => s.name === "Pre-flight checks");
        if (preflightStep?.status === "failed") {
          console.log("");
          console.log("Run `clawhq doctor` for detailed diagnostics.");
        }
        process.exitCode = 1;
      }
    });

  program
    .command("down")
    .description("Stop agent container gracefully, preserving workspace state")
    .option("--compose <path>", "Path to docker-compose.yml")
    .action(async (opts: { compose?: string }) => {
      const downSpinner = spinner(`${chalk.green("Deploy")} Stopping deployment...`);
      downSpinner.start();

      const result = await deployDown({ composePath: opts.compose });

      if (result.success) {
        downSpinner.succeed(`${chalk.green("Deploy")} ${status.pass} Shutdown complete`);
      } else {
        downSpinner.fail(`${chalk.green("Deploy")} ${status.fail} Shutdown failed`);
      }

      for (let i = 0; i < result.steps.length; i++) {
        console.log(formatStepResult(i + 1, result.steps.length, result.steps[i]));
      }

      console.log(formatSummary("Shutdown", result.steps, result.success));

      if (!result.success) {
        process.exitCode = 1;
      }
    });

  program
    .command("restart")
    .description("Restart agent container with firewall reapply and health re-verify")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--compose <path>", "Path to docker-compose.yml")
    .option("--health-timeout <ms>", "Health poll timeout in ms", "60000")
    .option("--gateway-host <host>", "Gateway host", "127.0.0.1")
    .option("--gateway-port <port>", "Gateway port", "18789")
    .option("--providers <list>", "Comma-separated cloud providers for firewall allowlist")
    .option("--bridge <iface>", "Docker bridge interface for firewall", "docker0")
    .action(async (opts: {
      home: string;
      compose?: string;
      healthTimeout: string;
      gatewayHost: string;
      gatewayPort: string;
      providers?: string;
      bridge: string;
    }) => {
      const restartSpinner = spinner(`${chalk.green("Deploy")} Restarting deployment...`);
      restartSpinner.start();

      const result = await deployRestart({
        openclawHome: opts.home.replace(/^~/, process.env.HOME ?? "~"),
        composePath: opts.compose,
        healthTimeoutMs: parseInt(opts.healthTimeout, 10),
        gatewayHost: opts.gatewayHost,
        gatewayPort: parseInt(opts.gatewayPort, 10),
        enabledProviders: opts.providers?.split(",").map((p) => p.trim()),
        bridgeInterface: opts.bridge,
      });

      if (result.success) {
        restartSpinner.succeed(`${chalk.green("Deploy")} ${status.pass} Restart complete`);
      } else {
        restartSpinner.fail(`${chalk.green("Deploy")} ${status.fail} Restart failed`);
      }

      for (let i = 0; i < result.steps.length; i++) {
        console.log(formatStepResult(i + 1, result.steps.length, result.steps[i]));
      }

      console.log(formatSummary("Restart", result.steps, result.success));

      if (result.containerId) {
        console.log(`Container: ${result.containerId}`);
      }

      if (!result.success) {
        process.exitCode = 1;
      }
    });
}
