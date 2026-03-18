/**
 * `clawhq connect` command — messaging channel setup.
 */

import chalk from "chalk";
import { Command } from "commander";

import type { ChannelSetupFlow } from "../design/connect/index.js";
import { formatTestResult, readOpenClawChannels, telegramFlow, whatsappFlow } from "../design/connect/index.js";
import { createReadlineIO } from "../design/configure/index.js";

import { spinner, status } from "./ui.js";

const CHANNEL_FLOWS: Record<string, ChannelSetupFlow> = {
  telegram: telegramFlow,
  whatsapp: whatsappFlow,
};

async function runConnectAction(
  channelName: string,
  opts: { home: string; config: string; env: string; test?: boolean },
) {
  const homePath = opts.home.replace(/^~/, process.env.HOME ?? "~");
  const configPath = opts.config.replace(/^~/, process.env.HOME ?? "~");
  const envPath = opts.env.replace(/^~/, process.env.HOME ?? "~");
  const connectOpts = { openclawHome: homePath, configPath, envPath };

  const flow = CHANNEL_FLOWS[channelName];
  if (!flow) {
    console.error(`Unknown channel: ${channelName}`);
    console.error(`Supported channels: ${Object.keys(CHANNEL_FLOWS).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  // Warn if the channel is not in the template's supported channels
  const existingChannels = await readOpenClawChannels(configPath);
  if (existingChannels && !(channelName in existingChannels)) {
    const configured = Object.keys(existingChannels).join(", ");
    console.warn(
      `Warning: "${channelName}" is not in this deployment's configured channels (${configured}).`,
    );
    console.warn(
      "This channel may not be supported by the current template. Proceeding anyway.",
    );
    console.warn("");
  }

  if (opts.test) {
    const testSpinner = spinner(`${chalk.green("Deploy")} Testing ${channelName} connection...`);
    testSpinner.start();
    const result = await flow.test(connectOpts);
    if (result.success) {
      testSpinner.succeed(`${chalk.green("Deploy")} ${status.pass} ${channelName} connection verified`);
    } else {
      testSpinner.fail(`${chalk.green("Deploy")} ${status.fail} ${channelName} connection failed`);
    }
    console.log(formatTestResult(result));
    if (!result.success) {
      process.exitCode = 1;
    }
    return;
  }

  // Interactive setup
  const { io, close } = createReadlineIO();
  try {
    const result = await flow.setup(io, connectOpts);
    if (!result.success) {
      process.exitCode = 1;
    }
  } finally {
    close();
  }
}

/**
 * Create the `connect` command.
 */
export function createConnectCommand(): Command {
  const connectCmd = new Command("connect")
    .description("Connect messaging channel")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--config <path>", "Path to openclaw.json", "~/.openclaw/openclaw.json")
    .option("--env <path>", "Path to .env file", "~/.openclaw/.env")
    .option("--test", "Test existing channel connection (bidirectional)");

  connectCmd
    .command("telegram")
    .description("Connect Telegram bot via BotFather token")
    .action(async () => {
      const parentOpts = connectCmd.opts() as { home: string; config: string; env: string; test?: boolean };
      await runConnectAction("telegram", parentOpts);
    });

  connectCmd
    .command("whatsapp")
    .description("Connect WhatsApp Business API")
    .action(async () => {
      const parentOpts = connectCmd.opts() as { home: string; config: string; env: string; test?: boolean };
      await runConnectAction("whatsapp", parentOpts);
    });

  return connectCmd;
}
