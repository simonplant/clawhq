/**
 * `clawhq quickstart` command — orchestrates init → build → up → smoke.
 *
 * No new business logic: calls existing functions with phase-labeled spinners.
 */

import { resolve } from "node:path";

import chalk from "chalk";
import { Command } from "commander";

import { deployUp } from "../deploy/deploy.js";
import { twoStageBuild } from "../docker/build.js";
import { DockerClient } from "../docker/client.js";
import { runSmartInit } from "../inference/index.js";
import { createReadlineIO, runWizard } from "../init/index.js";
import { runSmokeTest } from "../smoke/index.js";

import { markFirstRunComplete } from "./first-run.js";
import { formatError, spinner, status } from "./ui.js";

interface QuickstartOptions {
  template?: string;
  smart?: boolean;
  skipBuild?: boolean;
  skipDeploy?: boolean;
  home: string;
  ollamaHost: string;
  ollamaModel: string;
  context: string;
  baseTag: string;
  tag: string;
  gatewayHost: string;
  gatewayPort: string;
  healthTimeout: string;
}

/**
 * Create the `quickstart` command.
 */
export function createQuickstartCommand(): Command {
  return new Command("quickstart")
    .description("Set up and deploy an agent end-to-end (init → build → deploy → verify)")
    .option("--template <id>", "Template to use (default: personal-assistant)", "personal-assistant")
    .option("--smart", "Use AI-powered config inference via local Ollama model")
    .option("--skip-build", "Skip the build step")
    .option("--skip-deploy", "Skip the deploy step")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--ollama-host <url>", "Ollama API host", "http://localhost:11434")
    .option("--ollama-model <name>", "Ollama model to use", "llama3:8b")
    .option("--context <path>", "OpenClaw source directory for build", ".")
    .option("--base-tag <tag>", "Stage 1 base image tag", "openclaw:local")
    .option("--tag <tag>", "Stage 2 final image tag", "openclaw:custom")
    .option("--gateway-host <host>", "Gateway host", "127.0.0.1")
    .option("--gateway-port <port>", "Gateway port", "18789")
    .option("--health-timeout <ms>", "Health poll timeout in ms", "60000")
    .action(async (opts: QuickstartOptions) => {
      const homePath = opts.home.replace(/^~/, process.env.HOME ?? "~");
      const configPath = resolve(homePath, "openclaw.json");

      console.log("");
      console.log(chalk.bold("clawhq quickstart"));
      console.log("");

      // ── Step 1: Plan ──────────────────────────────────────────
      const planSpinner = spinner(`${chalk.cyan("Plan")}  Configuring agent...`);
      planSpinner.start();

      try {
        const { io, close } = createReadlineIO();
        try {
          if (opts.smart) {
            await runSmartInit({
              io,
              outputDir: homePath,
              ollamaHost: opts.ollamaHost,
              ollamaModel: opts.ollamaModel,
            });
          } else {
            await runWizard(io, homePath);
          }
        } finally {
          close();
        }
        planSpinner.succeed(`${chalk.cyan("Plan")}  ${status.pass} Agent configured`);
      } catch (err: unknown) {
        planSpinner.fail(`${chalk.cyan("Plan")}  ${status.fail} Configuration failed`);
        console.error(formatError(
          "QUICKSTART_PLAN",
          err instanceof Error ? err.message : String(err),
          "Run `clawhq init --guided` to configure manually.",
        ));
        process.exitCode = 1;
        return;
      }

      // ── Step 2: Build ─────────────────────────────────────────
      if (opts.skipBuild) {
        console.log(`${chalk.blue("Build")} skipped (--skip-build)`);
      } else {
        const buildSpinner = spinner(`${chalk.blue("Build")} Building container image...`);
        buildSpinner.start();

        try {
          const client = new DockerClient();
          await twoStageBuild(client, {
            context: resolve(opts.context),
            baseTag: opts.baseTag,
            finalTag: opts.tag,
          });
          buildSpinner.succeed(`${chalk.blue("Build")} ${status.pass} Container image built`);
        } catch (err: unknown) {
          buildSpinner.fail(`${chalk.blue("Build")} ${status.fail} Build failed`);
          console.error(formatError(
            "QUICKSTART_BUILD",
            err instanceof Error ? err.message : String(err),
            "Run `clawhq build` to build manually, or use --skip-build if image exists.",
          ));
          process.exitCode = 1;
          return;
        }
      }

      // ── Step 3: Deploy ────────────────────────────────────────
      if (opts.skipDeploy) {
        console.log(`${chalk.green("Deploy")} skipped (--skip-deploy)`);
      } else {
        const deploySpinner = spinner(`${chalk.green("Deploy")} Starting agent container...`);
        deploySpinner.start();

        try {
          const result = await deployUp({
            openclawHome: homePath,
            configPath,
            imageTag: opts.tag,
            baseTag: opts.baseTag,
            healthTimeoutMs: parseInt(opts.healthTimeout, 10),
            gatewayHost: opts.gatewayHost,
            gatewayPort: parseInt(opts.gatewayPort, 10),
          });

          if (!result.success) {
            const failedSteps = result.steps
              .filter((s) => s.status === "failed")
              .map((s) => s.name);
            throw new Error(`Deploy failed at: ${failedSteps.join(", ")}`);
          }

          deploySpinner.succeed(`${chalk.green("Deploy")} ${status.pass} Agent container running`);
        } catch (err: unknown) {
          deploySpinner.fail(`${chalk.green("Deploy")} ${status.fail} Deployment failed`);
          console.error(formatError(
            "QUICKSTART_DEPLOY",
            err instanceof Error ? err.message : String(err),
            "Run `clawhq doctor` for diagnostics, or `clawhq up` to deploy manually.",
          ));
          process.exitCode = 1;
          return;
        }
      }

      // ── Step 4: Verify ────────────────────────────────────────
      if (opts.skipDeploy) {
        console.log(`${chalk.magenta("Verify")} skipped (deploy was skipped)`);
      } else {
        const verifySpinner = spinner(`${chalk.magenta("Verify")} Running smoke tests...`);
        verifySpinner.start();

        try {
          const result = await runSmokeTest({
            openclawHome: homePath,
            configPath,
            gatewayHost: opts.gatewayHost,
            gatewayPort: parseInt(opts.gatewayPort, 10),
          });

          if (!result.passed) {
            const failedChecks = result.checks
              .filter((c) => c.status === "fail")
              .map((c) => c.name);
            throw new Error(`Smoke checks failed: ${failedChecks.join(", ")}`);
          }

          verifySpinner.succeed(`${chalk.magenta("Verify")} ${status.pass} All smoke tests passed`);
        } catch (err: unknown) {
          verifySpinner.fail(`${chalk.magenta("Verify")} ${status.fail} Verification failed`);
          console.error(formatError(
            "QUICKSTART_VERIFY",
            err instanceof Error ? err.message : String(err),
            "Run `clawhq smoke` for detailed results, or `clawhq doctor` for diagnostics.",
          ));
          process.exitCode = 1;
          return;
        }
      }

      // ── Mark first-run complete ──────────────────────────────
      await markFirstRunComplete("~/.clawhq");

      // ── Summary ───────────────────────────────────────────────
      console.log("");
      console.log(chalk.bold.green("Agent is ready!"));
      console.log("");
      console.log(`  ${chalk.dim("Status:")}   clawhq status`);
      console.log(`  ${chalk.dim("Logs:")}     clawhq logs`);
      console.log(`  ${chalk.dim("Health:")}   clawhq doctor`);
      console.log(`  ${chalk.dim("Connect:")} clawhq connect`);
      console.log("");
    });
}
