import { join } from "node:path";

import type { Command } from "commander";

import chalk from "chalk";
import ora from "ora";

import { build, DEFAULT_POSTURE, formatHashMismatch, getPostureConfig, readCurrentPosture, verifyBinaryHashes } from "../../build/docker/index.js";
import type { BuildSecurityPosture, Stage1Config, Stage2Config } from "../../build/docker/index.js";
import { checkDocker } from "../../build/installer/index.js";
import { deploy, restart, shutdown } from "../../build/launcher/index.js";
import { GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";

import { existsSync, readdirSync } from "node:fs";

import { CommandError } from "../errors.js";
import { renderError, validatePort, ensureInstalled } from "../ux.js";
import { createConnectProgressHandler, createProgressHandler } from "./helpers.js";

// ── Tool Binary Mapping ─────────────────────────────────────────────────────

/**
 * Maps tool names to the binaries they require in the Docker image.
 * SHA256 hashes from the production clawdius Dockerfile (verified).
 */
const TOOL_BINARY_DEPS: Record<string, import("../../build/docker/index.js").BinaryInstall[]> = {
  email: [
    {
      name: "himalaya",
      url: "https://github.com/pimalaya/himalaya/releases/download/v1.2.0/himalaya.x86_64-linux.tgz",
      destPath: "/usr/local/bin/himalaya",
      sha256: "e04e6382e3e664ef34b01afa1a2216113194a2975d2859727647b22d9b36d4e4",
    },
  ],
};

/** Shared binaries that every profile gets (JSON processing, HTTP). */
const CORE_BINARIES: import("../../build/docker/index.js").BinaryInstall[] = [
  {
    name: "jq",
    url: "https://github.com/jqlang/jq/releases/download/jq-1.8.1/jq-linux-amd64",
    destPath: "/usr/local/bin/jq",
    sha256: "020468de7539ce70ef1bceaf7cde2e8c4f2ca6c3afb84642aabc5c97d9fc2a0d",
  },
];

/**
 * Determine which binaries are needed based on deployed workspace tools.
 * Reads the workspace directory to see which tools were deployed by init.
 */
function getRequiredBinaries(deployDir: string): import("../../build/docker/index.js").BinaryInstall[] {
  const workspaceDir = join(deployDir, "workspace");
  const seen = new Set<string>();
  const binaries: import("../../build/docker/index.js").BinaryInstall[] = [...CORE_BINARIES];

  // Mark core binaries as seen
  for (const b of CORE_BINARIES) seen.add(b.name);

  if (!existsSync(workspaceDir)) return binaries;

  // Check which tools are deployed
  try {
    const files = readdirSync(workspaceDir);
    for (const file of files) {
      const deps = TOOL_BINARY_DEPS[file];
      if (deps) {
        for (const dep of deps) {
          if (!seen.has(dep.name)) {
            seen.add(dep.name);
            binaries.push(dep);
          }
        }
      }
    }
  } catch {
    // Workspace not readable — return core only
  }

  return binaries;
}

export function registerBuildCommands(program: Command, defaultDeployDir: string): void {
  program
    .command("build")
    .description("Two-stage Docker build with change detection and manifests")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--no-cache", "Force rebuild without cache")
    .option("--verify-hashes", "Download binaries and verify SHA256 hashes against pinned values")
    .action(async (opts: { deployDir: string; cache: boolean; verifyHashes?: boolean }) => {
      ensureInstalled(opts.deployDir);

      const spinner = ora();

      // Check Docker is available
      spinner.start("Checking Docker…");
      const dockerCheck = await checkDocker();
      if (!dockerCheck.ok) {
        spinner.fail("Docker is not available");
        console.error(chalk.red(`  ${dockerCheck.detail}`));
        console.log(chalk.dim("\n  Install Docker and ensure the daemon is running."));
        console.log(chalk.dim("  Then re-run: clawhq build"));
        throw new CommandError("", 1);
      }
      spinner.succeed("Docker available");

      // Read security posture from deploy dir (or use default)
      const posture: BuildSecurityPosture = readCurrentPosture(opts.deployDir) ?? DEFAULT_POSTURE;

      const stage1: Stage1Config = {
        baseImage: "node:24-slim",
        aptPackages: [],
      };

      // Populate Stage 2 binaries based on deployed tools
      const stage2Binaries = getRequiredBinaries(opts.deployDir);

      const stage2: Stage2Config = {
        binaries: stage2Binaries,
        workspaceTools: [],
        skills: [],
      };

      // --verify-hashes: download and check binaries against pinned SHA256
      if (opts.verifyHashes) {
        if (stage2.binaries.length === 0) {
          console.log(chalk.dim("  No binaries to verify."));
        } else {
          spinner.start("Verifying binary hashes…");
          const report = await verifyBinaryHashes(stage2.binaries, (name, status) => {
            if (status === "downloading") spinner.text = `Downloading ${name}…`;
            else if (status === "verifying") spinner.text = `Verifying ${name}…`;
          });

          if (report.allPassed) {
            spinner.succeed(`All ${report.results.length} binary hashes verified`);
            for (const r of report.results) {
              console.log(chalk.dim(`  ${chalk.green("✔")} ${r.name}: ${r.expected.slice(0, 16)}…`));
            }
          } else {
            spinner.fail("Binary hash verification failed");
            for (const r of report.results) {
              if (r.ok) {
                console.log(chalk.dim(`  ${chalk.green("✔")} ${r.name}: ${r.expected.slice(0, 16)}…`));
              } else {
                console.error(chalk.red(`  ${formatHashMismatch(r)}`));
              }
            }
            throw new CommandError("", 1);
          }
        }
        return;
      }

      // Show binary verification status in build output
      if (stage2.binaries.length > 0) {
        console.log(chalk.bold("\nBinary SHA256 verification:"));
        for (const binary of stage2.binaries) {
          console.log(chalk.dim(`  ${chalk.green("✔")} ${binary.name}: ${binary.sha256.slice(0, 16)}… (pinned)`));
        }
        console.log("");
      }

      spinner.start("Generating Dockerfile…");

      try {
        const result = await build({
          deployDir: opts.deployDir,
          stage1,
          stage2,
          posture,
          noCache: !opts.cache,
        });

        if (!result.success) {
          spinner.fail("Docker build failed");
          console.error(chalk.red(`  ${result.error}`));
          console.log(chalk.dim("\n  Fix the issue and re-run: clawhq build"));
          throw new CommandError("", 1);
        }

        const cacheInfo = result.cacheHit.stage1 && result.cacheHit.stage2
          ? " (cached)"
          : "";
        spinner.succeed(`Docker image built${cacheInfo}`);

        if (result.manifest) {
          console.log(chalk.dim(`  Image:    ${result.manifest.imageTag}`));
          console.log(chalk.dim(`  Posture:  ${result.manifest.posture}`));
          console.log(chalk.dim(`  Manifest: written`));
        }
      } catch (error) {
        if (error instanceof CommandError) throw error;
        spinner.fail("Build failed");
        console.error(renderError(error));
        console.log(chalk.dim("\n  Fix the issue and re-run: clawhq build"));
        throw new CommandError("", 1);
      }
    });

  // ── Deploy Commands ─────────────────────────────────────────────────────────

  program
    .command("up")
    .description("Deploy agent with preflight checks, firewall, and health verify")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("-t, --token <token>", "Gateway auth token")
    .option("-p, --port <port>", "Gateway port", String(GATEWAY_DEFAULT_PORT))
    .option("--skip-preflight", "Skip preflight checks")
    .option("--skip-firewall", "Skip egress firewall setup")
    .option("--air-gap", "Air-gapped mode: block all egress traffic")
    .action(async (opts: {
      deployDir: string;
      token?: string;
      port: string;
      skipPreflight?: boolean;
      skipFirewall?: boolean;
      airGap?: boolean;
    }) => {
      ensureInstalled(opts.deployDir);

      // Resolve gateway token: CLI flag → env var → .env file (auto-generated by init)
      const { readEnvValue } = await import("../../secure/credentials/env-store.js");
      const token = opts.token
        ?? process.env["CLAWHQ_GATEWAY_TOKEN"]
        ?? readEnvValue(join(opts.deployDir, "engine", ".env"), "OPENCLAW_GATEWAY_TOKEN")
        ?? "";
      if (!token) {
        console.error(chalk.red("Error: Gateway token required. Use --token or set CLAWHQ_GATEWAY_TOKEN"));
        throw new CommandError("", 1);
      }

      const gatewayPort = validatePort(opts.port);

      if (opts.airGap) {
        console.log(chalk.yellow("⚠ Air-gapped mode: all outbound network traffic will be blocked"));
      }

      const ac = new AbortController();
      process.on("SIGINT", () => ac.abort());
      process.on("SIGTERM", () => ac.abort());

      const spinner = ora();
      const onProgress = createProgressHandler(spinner);

      try {
        // Read posture to bridge posture-level controls into deploy options
        const currentPosture = readCurrentPosture(opts.deployDir) ?? DEFAULT_POSTURE;
        const postureConfig = getPostureConfig(currentPosture);

        const result = await deploy({
          deployDir: opts.deployDir,
          gatewayToken: token,
          gatewayPort,
          skipPreflight: opts.skipPreflight,
          skipFirewall: opts.skipFirewall,
          airGap: opts.airGap || postureConfig.airGap,
          runtime: postureConfig.runtime,
          autoFirewall: postureConfig.autoFirewall,
          immutableIdentity: postureConfig.immutableIdentity,
          onProgress,
          signal: ac.signal,
        });

        spinner.stop();

        if (result.success) {
          console.log(chalk.green("\n✔ Agent is live and responding to messages"));
        } else {
          console.error(chalk.red(`\n✘ Deploy failed:\n${result.error}`));
          throw new CommandError("", 1);
        }
      } finally {
        spinner.stop();
      }
    });

  program
    .command("down")
    .description("Stop agent and remove firewall rules")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("-v, --volumes", "Remove volumes")
    .action(async (opts: { deployDir: string; volumes?: boolean }) => {
      ensureInstalled(opts.deployDir);

      const ac = new AbortController();
      process.on("SIGINT", () => ac.abort());
      process.on("SIGTERM", () => ac.abort());

      const spinner = ora();
      const onProgress = createProgressHandler(spinner);

      try {
        const result = await shutdown({
          deployDir: opts.deployDir,
          removeVolumes: opts.volumes,
          onProgress,
          signal: ac.signal,
        });

        spinner.stop();

        if (result.success) {
          console.log(chalk.green("\n✔ Agent stopped"));
        } else {
          console.error(chalk.red(`\n✘ Shutdown failed: ${result.error}`));
          throw new CommandError("", 1);
        }
      } finally {
        spinner.stop();
      }
    });

  program
    .command("restart")
    .description("Restart agent with firewall reapply")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("-t, --token <token>", "Gateway auth token")
    .option("-p, --port <port>", "Gateway port", String(GATEWAY_DEFAULT_PORT))
    .option("--skip-preflight", "Skip preflight checks")
    .option("--skip-firewall", "Skip egress firewall setup")
    .option("--air-gap", "Air-gapped mode: block all egress traffic")
    .action(async (opts: {
      deployDir: string;
      token?: string;
      port: string;
      skipPreflight?: boolean;
      skipFirewall?: boolean;
      airGap?: boolean;
    }) => {
      ensureInstalled(opts.deployDir);

      // Resolve gateway token: CLI flag → env var → .env file (auto-generated by init)
      const { readEnvValue } = await import("../../secure/credentials/env-store.js");
      const token = opts.token
        ?? process.env["CLAWHQ_GATEWAY_TOKEN"]
        ?? readEnvValue(join(opts.deployDir, "engine", ".env"), "OPENCLAW_GATEWAY_TOKEN")
        ?? "";
      if (!token) {
        console.error(chalk.red("Error: Gateway token required. Use --token or set CLAWHQ_GATEWAY_TOKEN"));
        throw new CommandError("", 1);
      }

      const gatewayPort = validatePort(opts.port);

      if (opts.airGap) {
        console.log(chalk.yellow("⚠ Air-gapped mode: all outbound network traffic will be blocked"));
      }

      const ac = new AbortController();
      process.on("SIGINT", () => ac.abort());
      process.on("SIGTERM", () => ac.abort());

      const spinner = ora();
      const onProgress = createProgressHandler(spinner);

      try {
        const result = await restart({
          deployDir: opts.deployDir,
          gatewayToken: token,
          gatewayPort,
          skipPreflight: opts.skipPreflight,
          skipFirewall: opts.skipFirewall,
          airGap: opts.airGap,
          onProgress,
          signal: ac.signal,
        });

        spinner.stop();

        if (result.success) {
          console.log(chalk.green("\n✔ Agent restarted and reachable"));
        } else {
          console.error(chalk.red(`\n✘ Restart failed: ${result.error}`));
          throw new CommandError("", 1);
        }
      } finally {
        spinner.stop();
      }
    });

  program
    .command("connect")
    .description("Connect messaging channel (Telegram, WhatsApp)")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("-t, --token <token>", "Gateway auth token")
    .option("-p, --port <port>", "Gateway port", String(GATEWAY_DEFAULT_PORT))
    .option("-c, --channel <channel>", "Channel to connect (telegram, whatsapp)")
    .action(async (opts: {
      deployDir: string;
      token?: string;
      port: string;
      channel?: string;
    }) => {
      ensureInstalled(opts.deployDir);

      try {
        const { select, input, password } = await import("@inquirer/prompts");
        const {
          connectChannel,
          validateTelegramToken,
          validateWhatsAppToken,
        } = await import("../../build/launcher/connect.js");
        const { readEnvValue } = await import("../../secure/credentials/env-store.js");

        console.log(chalk.bold("\nclawhq connect\n"));
        console.log(chalk.dim("Connect a messaging channel so you can talk to your agent.\n"));

        // Resolve gateway token
        const envPath = join(opts.deployDir, "engine", ".env");
        const gatewayToken = opts.token
          ?? process.env["CLAWHQ_GATEWAY_TOKEN"]
          ?? readEnvValue(envPath, "OPENCLAW_GATEWAY_TOKEN")
          ?? "";

        if (!gatewayToken) {
          console.error(chalk.red("Error: Gateway token required. Use --token or set CLAWHQ_GATEWAY_TOKEN"));
          throw new CommandError("", 1);
        }

        const gatewayPort = validatePort(opts.port);

        // Step 1: Select channel
        const channel = (opts.channel as "telegram" | "whatsapp") ?? await select({
          message: "Which messaging channel?",
          choices: [
            { name: "Telegram", value: "telegram" as const, description: "Bot token + chat ID" },
            { name: "WhatsApp", value: "whatsapp" as const, description: "Business API + phone number" },
          ],
        });

        if (channel !== "telegram" && channel !== "whatsapp") {
          console.error(chalk.red(`Unsupported channel: ${channel}. Use telegram or whatsapp.`));
          throw new CommandError("", 1);
        }

        // Step 2: Collect and validate credentials
        const vars: Record<string, string> = {};
        const spinner = ora();

        if (channel === "telegram") {
          console.log(chalk.dim("\nCreate a Telegram bot via @BotFather and paste the token below.\n"));

          const botToken = await password({ message: "Telegram bot token:", mask: "*" });
          if (!botToken) {
            console.error(chalk.red("Bot token is required."));
            throw new CommandError("", 1);
          }

          // Validate token
          spinner.start("Validating bot token…");
          try {
            const botUsername = await validateTelegramToken(botToken);
            spinner.succeed(`Bot verified: @${botUsername}`);
          } catch (err) {
            spinner.fail(`Token validation failed: ${err instanceof Error ? err.message : String(err)}`);
            throw new CommandError("", 1);
          }

          const chatId = await input({
            message: "Telegram chat ID (your user ID or group ID):",
          });
          if (!chatId) {
            console.error(chalk.red("Chat ID is required."));
            throw new CommandError("", 1);
          }

          vars["TELEGRAM_BOT_TOKEN"] = botToken;
          vars["TELEGRAM_CHAT_ID"] = chatId;
        } else {
          console.log(chalk.dim("\nYou need a WhatsApp Business API account. Enter your credentials below.\n"));

          const phoneNumberId = await input({ message: "Phone Number ID:" });
          const accessToken = await password({ message: "Access Token:", mask: "*" });
          if (!phoneNumberId || !accessToken) {
            console.error(chalk.red("Phone Number ID and Access Token are required."));
            throw new CommandError("", 1);
          }

          // Validate token
          spinner.start("Validating WhatsApp credentials…");
          try {
            const displayPhone = await validateWhatsAppToken(phoneNumberId, accessToken);
            spinner.succeed(`WhatsApp verified: ${displayPhone}`);
          } catch (err) {
            spinner.fail(`Validation failed: ${err instanceof Error ? err.message : String(err)}`);
            throw new CommandError("", 1);
          }

          const recipientPhone = await input({
            message: "Your phone number (for test message, with country code, e.g. 14155551234):",
          });
          if (!recipientPhone) {
            console.error(chalk.red("Recipient phone is required for test message."));
            throw new CommandError("", 1);
          }

          vars["WHATSAPP_PHONE_NUMBER_ID"] = phoneNumberId;
          vars["WHATSAPP_ACCESS_TOKEN"] = accessToken;
          vars["WHATSAPP_RECIPIENT_PHONE"] = recipientPhone;
        }

        // Step 3: Run connect flow
        console.log("");
        const connectSpinner = ora();
        const onProgress = createConnectProgressHandler(connectSpinner);

        const result = await connectChannel({
          deployDir: opts.deployDir,
          channel,
          credentials: { channel, vars },
          gatewayToken,
          gatewayPort,
          onProgress,
        });

        connectSpinner.stop();

        if (result.success) {
          console.log(chalk.green("\n✔ Channel connected"));
          if (result.testMessageSent) {
            console.log(chalk.green("✔ Test message sent — check your channel!"));
          } else if (result.error) {
            console.log(chalk.yellow(`⚠ ${result.error}`));
          }
          console.log(chalk.dim("\n  Your agent is now reachable. Send it a message!"));
        } else {
          console.error(chalk.red(`\n✘ ${result.error}`));
          throw new CommandError("", 1);
        }
      } catch (error) {
        if (error instanceof CommandError) throw error;
        if (error instanceof Error && error.name === "ExitPromptError") {
          console.log(chalk.yellow("\nSetup cancelled."));
          throw new CommandError("", 0);
        }
        console.error(renderError(error));
        throw new CommandError("", 1);
      }
    });

  // ── Service Commands ────────────────────────────────────────────────────────

  const service = program.command("service").description("Manage backing services (postgres, redis, qdrant)");

  service
    .command("add")
    .description("Add a backing service — configures container, network, credentials")
    .argument("<name>", "Service name (postgres, redis, qdrant)")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("-p, --port <port>", "Custom host port")
    .action(async (name: string, opts: { deployDir: string; port?: string }) => {
      ensureInstalled(opts.deployDir);

      const { addService, SUPPORTED_SERVICES } = await import("../../build/services/index.js");
      type ServiceName = import("../../build/services/index.js").ServiceName;

      if (!SUPPORTED_SERVICES.includes(name as ServiceName)) {
        console.error(chalk.red(`Unknown service: ${name}`));
        console.error(chalk.dim(`Supported: ${SUPPORTED_SERVICES.join(", ")}`));
        throw new CommandError("", 1);
      }

      const spinner = ora(`Adding ${name}…`);
      spinner.start();

      try {
        let port: number | undefined;
        if (opts.port) {
          port = validatePort(opts.port);
        }

        const result = await addService({
          deployDir: opts.deployDir,
          service: name as ServiceName,
          port,
        });

        spinner.stop();

        if (result.success) {
          console.log(chalk.green(`\n✔ Service "${name}" configured`));
          if (result.composePath) {
            console.log(chalk.dim(`  Compose: ${result.composePath}`));
          }
          if (result.envVarsAdded && result.envVarsAdded.length > 0) {
            console.log(chalk.dim(`  Env vars: ${result.envVarsAdded.join(", ")}`));
          }
          console.log(chalk.dim(`\n  Restart to activate: clawhq restart`));
        } else {
          console.error(chalk.red(`\n✘ Failed to add ${name}: ${result.error}`));
          throw new CommandError("", 1);
        }
      } finally {
        spinner.stop();
      }
    });

  service
    .command("list")
    .description("List configured backing services")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; json?: boolean }) => {
      ensureInstalled(opts.deployDir);

      const { listServices, SUPPORTED_SERVICES } = await import("../../build/services/index.js");

      const result = listServices({ deployDir: opts.deployDir });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.services.length === 0) {
        console.log(chalk.dim("No backing services configured."));
        console.log(chalk.dim(`  Add one: clawhq service add ${SUPPORTED_SERVICES[0]}`));
        return;
      }

      console.log(chalk.bold("\nBacking Services\n"));
      for (const svc of result.services) {
        console.log(`  ${chalk.cyan(svc.name)}  ${chalk.dim(svc.image)}  ${chalk.green(svc.status)}`);
      }
      console.log("");
    });
}
