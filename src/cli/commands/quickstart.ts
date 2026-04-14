import { homedir } from "node:os";
import { join } from "node:path";

import type { Command } from "commander";

import chalk from "chalk";
import ora from "ora";

import type { BuildSecurityPosture, Stage1Config, Stage2Config } from "../../build/docker/index.js";
import { build, getPostureConfig, getRequiredBinaries } from "../../build/docker/index.js";
import { install } from "../../build/installer/index.js";
import { deploy } from "../../build/launcher/index.js";
import { GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";
import { validateBundle } from "../../config/validate.js";
import {
  createInquirerPrompter,
  generateBundle,
  runSmartInference,
  runWizard,
  SmartInferenceAbortError,
  WizardAbortError,
  writeBundle,
} from "../../design/configure/index.js";
import {
  formatDoctorTable,
  runDoctor,
} from "../../operate/doctor/index.js";

import { CommandError } from "../errors.js";
import { renderError, validatePort, ensureInstalled } from "../ux.js";
import { bundleToFiles, createConnectProgressHandler, createProgressHandler, formatPrereqCheck } from "./helpers.js";

const DEFAULT_DEPLOY_DIR = join(homedir(), ".clawhq");

export function registerQuickstartCommand(program: Command): void {
  program
    .command("quickstart")
    .description("Zero to running agent — install, configure, build, deploy, connect, verify")
    .option("-b, --blueprint <name>", "Blueprint to use (e.g. email-manager)")
    .option("--smart", "AI-powered config inference via local Ollama")
    .option("-d, --deploy-dir <path>", "Deployment directory", DEFAULT_DEPLOY_DIR)
    .option("--from-source", "Zero-trust: install from source")
    .option("-p, --port <port>", "Gateway port", String(GATEWAY_DEFAULT_PORT))
    .option("--ollama-model <model>", "Ollama model for --smart inference")
    .action(async (opts: {
      blueprint?: string;
      smart?: boolean;
      deployDir: string;
      fromSource?: boolean;
      port: string;
      ollamaModel?: string;
    }) => {
      const ac = new AbortController();
      process.on("SIGINT", () => ac.abort());
      process.on("SIGTERM", () => ac.abort());

      const spinner = ora();
      const deployDir = opts.deployDir;
      const phase = (name: string) => chalk.dim(`[${name}]`);

      console.log(chalk.bold("\nclawhq quickstart\n"));
      console.log(chalk.dim("From zero to a running, reachable agent.\n"));

      // ── Phase 1: Install ──────────────────────────────────────────────────

      spinner.start(`${phase("install")} Checking prerequisites and scaffolding…`);

      try {
        const installResult = await install({
          deployDir,
          fromSource: opts.fromSource,
        });

        if (!installResult.success || !installResult.prereqs.passed) {
          spinner.fail(`${phase("install")} Prerequisites not met`);
          console.log("");
          for (const check of installResult.prereqs.checks) {
            formatPrereqCheck(check);
          }
          console.log(chalk.dim("\n  Fix the issues above and re-run: clawhq quickstart"));
          throw new CommandError("", 1);
        }

        spinner.succeed(`${phase("install")} Platform installed at ${deployDir}`);
      } catch (error) {
        if (error instanceof CommandError) throw error;
        spinner.fail(`${phase("install")} Install failed`);
        console.error(renderError(error));
        console.log(chalk.dim("\n  Fix the issue and re-run: clawhq quickstart"));
        throw new CommandError("", 1);
      }

      if (ac.signal.aborted) throw new CommandError("", 1);

      // ── Phase 2: Init ─────────────────────────────────────────────────────

      console.log("");
      let answers: import("../../design/configure/types.js").WizardAnswers;

      try {
        const prompter = await createInquirerPrompter();

        if (opts.smart) {
          console.log(chalk.dim("  AI-powered inference mode — describe what you need.\n"));
          answers = await runSmartInference(prompter, {
            deployDir,
            ollamaModel: opts.ollamaModel,
          });
        } else {
          console.log(chalk.dim("  Guided setup — choose a blueprint and configure your agent.\n"));
          answers = await runWizard(prompter, {
            blueprintName: opts.blueprint,
            deployDir,
          });
        }

        spinner.start(`${phase("init")} Generating config…`);

        const bundle = generateBundle(answers);

        const report = validateBundle(bundle);
        if (!report.valid) {
          spinner.fail(`${phase("init")} Config validation failed`);
          for (const err of report.errors) {
            console.error(chalk.red(`  ✘ ${err.rule}: ${err.message}`));
          }
          console.log(chalk.dim("\n  Fix the issues and re-run: clawhq init --guided"));
          throw new CommandError("", 1);
        }

        const files = bundleToFiles(bundle, answers.blueprint, answers.customizationAnswers, Object.keys(answers.integrations));
        writeBundle(answers.deployDir, files);

        spinner.succeed(`${phase("init")} Agent forged — all 14 landmine rules passed`);
      } catch (error) {
        if (error instanceof CommandError) throw error;
        if (error instanceof WizardAbortError || error instanceof SmartInferenceAbortError) {
          spinner.stop();
          console.log(chalk.yellow("\nSetup cancelled."));
          throw new CommandError("", 0);
        }
        spinner.fail(`${phase("init")} Init failed`);
        console.error(renderError(error));
        console.log(chalk.dim("\n  Re-run: clawhq init --guided"));
        throw new CommandError("", 1);
      }

      if (ac.signal.aborted) throw new CommandError("", 1);

      // ── Phase 3: Build ────────────────────────────────────────────────────

      const bp = answers.blueprint;
      const posture = (bp.security_posture.posture === "under-attack"
        ? "under-attack"
        : "hardened") as BuildSecurityPosture;

      spinner.start(`${phase("build")} Building Docker image…`);

      try {

        const stage1: Stage1Config = {
          baseImage: "node:24-slim",
          aptPackages: [],
        };
        const stage2: Stage2Config = {
          binaries: getRequiredBinaries(deployDir),
          workspaceTools: [],
          skills: [],
        };

        const buildResult = await build({ deployDir, stage1, stage2, posture });

        if (!buildResult.success) {
          spinner.fail(`${phase("build")} Build failed`);
          console.error(chalk.red(`  ${buildResult.error}`));
          console.log(chalk.dim("\n  Fix the issue and run: clawhq build"));
          console.log(chalk.dim("  Then resume with: clawhq up"));
          throw new CommandError("", 1);
        }

        const cacheInfo = buildResult.cacheHit.stage1 && buildResult.cacheHit.stage2
          ? " (cached)"
          : "";
        spinner.succeed(`${phase("build")} Docker image built${cacheInfo}`);
      } catch (error) {
        if (error instanceof CommandError) throw error;
        spinner.fail(`${phase("build")} Build failed`);
        console.error(renderError(error));
        console.log(chalk.dim("\n  Fix the issue and run: clawhq build"));
        console.log(chalk.dim("  Then resume with: clawhq up"));
        throw new CommandError("", 1);
      }

      if (ac.signal.aborted) throw new CommandError("", 1);

      // ── Phase 4: Deploy ───────────────────────────────────────────────────

      // Read the generated gateway token from .env
      const { readEnvValue } = await import("../../secure/credentials/env-store.js");
      const envPath = join(deployDir, "engine", ".env");
      const gatewayToken = readEnvValue(envPath, "OPENCLAW_GATEWAY_TOKEN") ?? "";

      if (!gatewayToken) {
        spinner.fail(`${phase("deploy")} No gateway token found in .env`);
        console.log(chalk.dim("  Re-run: clawhq init --guided"));
        throw new CommandError("", 1);
      }

      const gatewayPort = validatePort(opts.port);
      const deploySpinner = ora();
      const onDeployProgress = createProgressHandler(deploySpinner);

      const postureConfig = getPostureConfig(posture);
      const deployResult = await deploy({
        deployDir,
        gatewayToken,
        gatewayPort,
        runtime: postureConfig.runtime,
        autoFirewall: postureConfig.autoFirewall,
        immutableIdentity: postureConfig.immutableIdentity,
        airGap: postureConfig.airGap,
        onProgress: onDeployProgress,
        signal: ac.signal,
      });

      deploySpinner.stop();

      if (!deployResult.success) {
        console.error(chalk.red(`\n✘ ${phase("deploy")} Deploy failed:\n${deployResult.error}`));
        console.log(chalk.dim("\n  Diagnose with: clawhq doctor --fix"));
        console.log(chalk.dim("  Then retry: clawhq up"));
        throw new CommandError("", 1);
      }

      console.log(chalk.green(`  ${phase("deploy")} Agent is live and responding`));

      if (ac.signal.aborted) throw new CommandError("", 1);

      // ── Phase 5: Connect ──────────────────────────────────────────────────
      // Connect is non-fatal — the agent is already running. Failures here
      // should not prevent reaching verify or showing the completion summary.

      console.log("");
      let channelConnected = false;

      try {
        const { select, input, password } = await import("@inquirer/prompts");
        const {
          connectChannel,
          validateTelegramToken,
          validateWhatsAppToken,
        } = await import("../../build/launcher/connect.js");

        console.log(chalk.bold("Connect a messaging channel\n"));
        console.log(chalk.dim("Connect Telegram or WhatsApp so you can talk to your agent.\n"));

        const channel = await select({
          message: "Which messaging channel?",
          choices: [
            { name: "Telegram", value: "telegram" as const, description: "Bot token + chat ID" },
            { name: "WhatsApp", value: "whatsapp" as const, description: "Business API + phone number" },
          ],
        });

        let vars: Record<string, string> | undefined;

        if (channel === "telegram") {
          console.log(chalk.dim("\nCreate a Telegram bot via @BotFather and paste the token below.\n"));

          const botToken = await password({ message: "Telegram bot token:", mask: "*" });
          if (!botToken) {
            console.log(chalk.yellow("  Bot token is required. Skipping channel setup."));
            console.log(chalk.dim("  Connect later with: clawhq connect"));
          } else {
            const connectValidateSpinner = ora();
            connectValidateSpinner.start("Validating bot token…");
            try {
              const botUsername = await validateTelegramToken(botToken);
              connectValidateSpinner.succeed(`Bot verified: @${botUsername}`);

              const chatId = await input({
                message: "Telegram chat ID (your user ID or group ID):",
              });
              if (chatId) {
                vars = {
                  TELEGRAM_BOT_TOKEN: botToken,
                  TELEGRAM_CHAT_ID: chatId,
                };
              } else {
                console.log(chalk.yellow("  Chat ID is required. Skipping channel setup."));
                console.log(chalk.dim("  Connect later with: clawhq connect"));
              }
            } catch (err) {
              connectValidateSpinner.fail(`Token validation failed: ${err instanceof Error ? err.message : String(err)}`);
              console.log(chalk.dim("  Connect later with: clawhq connect"));
            }
          }
        } else if (channel === "whatsapp") {
          console.log(chalk.dim("\nYou need a WhatsApp Business API account. Enter your credentials below.\n"));

          const phoneNumberId = await input({ message: "Phone Number ID:" });
          const accessToken = await password({ message: "Access Token:", mask: "*" });
          if (!phoneNumberId || !accessToken) {
            console.log(chalk.yellow("  Phone Number ID and Access Token are required. Skipping channel setup."));
            console.log(chalk.dim("  Connect later with: clawhq connect"));
          } else {
            const connectValidateSpinner = ora();
            connectValidateSpinner.start("Validating WhatsApp credentials…");
            try {
              const displayPhone = await validateWhatsAppToken(phoneNumberId, accessToken);
              connectValidateSpinner.succeed(`WhatsApp verified: ${displayPhone}`);

              const recipientPhone = await input({
                message: "Your phone number (for test message, with country code, e.g. 14155551234):",
              });
              if (recipientPhone) {
                vars = {
                  WHATSAPP_PHONE_NUMBER_ID: phoneNumberId,
                  WHATSAPP_ACCESS_TOKEN: accessToken,
                  WHATSAPP_RECIPIENT_PHONE: recipientPhone,
                };
              } else {
                console.log(chalk.yellow("  Recipient phone is required. Skipping channel setup."));
                console.log(chalk.dim("  Connect later with: clawhq connect"));
              }
            } catch (err) {
              connectValidateSpinner.fail(`Validation failed: ${err instanceof Error ? err.message : String(err)}`);
              console.log(chalk.dim("  Connect later with: clawhq connect"));
            }
          }
        } else {
          console.log(chalk.yellow(`  Unsupported channel: ${channel}. Skipping.`));
          console.log(chalk.dim("  Connect later with: clawhq connect"));
        }

        if (vars && (channel === "telegram" || channel === "whatsapp")) {
          console.log("");
          const connectSpinner = ora();
          const onConnectProgress = createConnectProgressHandler(connectSpinner);

          const connectResult = await connectChannel({
            deployDir,
            channel,
            credentials: { channel, vars },
            gatewayToken,
            gatewayPort,
            onProgress: onConnectProgress,
          });

          connectSpinner.stop();

          if (connectResult.success) {
            channelConnected = true;
            console.log(chalk.green(`  ${phase("connect")} Channel connected`));
            if (connectResult.testMessageSent) {
              console.log(chalk.green("  ✔ Test message sent — check your channel!"));
            } else if (connectResult.error) {
              console.log(chalk.yellow(`  ⚠ ${connectResult.error}`));
            }
          } else {
            console.log(chalk.yellow(`  ${phase("connect")} ${connectResult.error}`));
            console.log(chalk.dim("  Connect later with: clawhq connect"));
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === "ExitPromptError") {
          console.log(chalk.yellow("\nChannel setup skipped."));
          console.log(chalk.dim("  Connect later with: clawhq connect"));
        } else {
          console.log(chalk.yellow(`  ${phase("connect")} Channel connection failed`));
          console.error(renderError(error));
          console.log(chalk.dim("  Connect later with: clawhq connect"));
        }
      }

      // ── Phase 6: Verify ───────────────────────────────────────────────────

      console.log("");
      spinner.start(`${phase("verify")} Running diagnostics…`);

      try {
        const doctorReport = await runDoctor({
          deployDir,
          format: "table",
          signal: ac.signal,
        });

        spinner.stop();

        if (doctorReport.healthy) {
          spinner.succeed(`${phase("verify")} All ${doctorReport.passed.length} checks passed`);
        } else {
          spinner.warn(`${phase("verify")} ${doctorReport.errors.length} issue(s) found`);
          console.log(formatDoctorTable(doctorReport));
          console.log(chalk.dim("  Auto-fix with: clawhq doctor --fix"));
        }
      } catch (error) {
        spinner.fail(`${phase("verify")} Diagnostics failed`);
        console.error(renderError(error));
        console.log(chalk.dim("  Run manually: clawhq doctor"));
      }

      // ── Done ──────────────────────────────────────────────────────────────

      console.log(chalk.bold.green("\n✔ Quickstart complete\n"));
      console.log(`  Your agent is running at ${chalk.bold(`localhost:${opts.port}`)}`);
      console.log(chalk.dim(`  Deployment: ${deployDir}`));
      if (!channelConnected) {
        console.log(chalk.dim(`\n  Connect a channel: clawhq connect`));
      }
      console.log(chalk.dim(`\n  Useful commands:`));
      console.log(chalk.dim(`    clawhq status     — dashboard`));
      console.log(chalk.dim(`    clawhq doctor     — diagnostics`));
      console.log(chalk.dim(`    clawhq logs -f    — stream logs`));
      console.log(chalk.dim(`    clawhq down       — stop agent`));
      console.log("");
    });
}
