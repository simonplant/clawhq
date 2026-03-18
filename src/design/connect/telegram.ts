/**
 * Telegram channel setup flow.
 *
 * Walks the user through BotFather token creation, validates the token
 * via the Telegram getMe API, and optionally configures a webhook.
 */

import type { WizardIO } from "../configure/types.js";

import { readChannelEnv, readOpenClawChannels, writeChannelConfig, writeChannelEnv } from "./config.js";
import type {
  ChannelHealth,
  ChannelSetupFlow,
  ChannelSetupResult,
  ChannelTestResult,
  ChannelTestStep,
  ConnectOptions,
} from "./types.js";

const TELEGRAM_API = "https://api.telegram.org";
const TIMEOUT_MS = 10_000;
const ENV_VAR = "TELEGRAM_BOT_TOKEN";

interface TelegramBotInfo {
  id: number;
  first_name: string;
  username: string;
  is_bot: boolean;
}

/**
 * Validate a Telegram bot token by calling getMe.
 * Returns bot info on success, or null on failure.
 */
export async function validateTelegramToken(token: string): Promise<{ valid: boolean; bot?: TelegramBotInfo; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(`${TELEGRAM_API}/bot${token}/getMe`, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (response.status === 200) {
      const data = (await response.json()) as { ok: boolean; result: TelegramBotInfo };
      if (data.ok && data.result) {
        return { valid: true, bot: data.result };
      }
      return { valid: false, error: "Unexpected response from Telegram API" };
    }

    if (response.status === 401) {
      return { valid: false, error: "Invalid bot token — check with @BotFather" };
    }

    return { valid: false, error: `Telegram API returned status ${response.status}` };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return { valid: false, error: "Request timed out — check network connectivity" };
    }
    return { valid: false, error: `Network error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Check for recent updates (incoming messages) to verify the bot can receive.
 */
async function checkUpdates(token: string): Promise<{ hasUpdates: boolean; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(`${TELEGRAM_API}/bot${token}/getUpdates?limit=1&timeout=0`, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (response.status === 200) {
      return { hasUpdates: true };
    }

    return { hasUpdates: false, error: `Status ${response.status}` };
  } catch (err: unknown) {
    return { hasUpdates: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const telegramFlow: ChannelSetupFlow = {
  channel: "telegram",

  async setup(io: WizardIO, options: ConnectOptions): Promise<ChannelSetupResult> {
    io.log("");
    io.log("Telegram Bot Setup");
    io.log("==================");
    io.log("");
    io.log("To connect Telegram, you need a bot token from @BotFather.");
    io.log("");
    io.log("Steps:");
    io.log("  1. Open Telegram and message @BotFather");
    io.log("  2. Send /newbot (or /token for an existing bot)");
    io.log("  3. Copy the bot token (format: 123456:ABC-DEF...)");
    io.log("");

    // Get the token
    const token = await io.prompt("Bot token");

    if (!token) {
      return {
        channel: "telegram",
        success: false,
        message: "No token provided",
        envVarsSet: [],
        configKeys: [],
      };
    }

    // Validate immediately
    io.log("");
    io.log("Validating token...");

    const result = await validateTelegramToken(token);

    if (!result.valid || !result.bot) {
      io.log(`  FAIL: ${result.error}`);
      io.log("");
      io.log("Token validation failed. Please check your token and try again.");
      return {
        channel: "telegram",
        success: false,
        message: `Validation failed: ${result.error}`,
        envVarsSet: [],
        configKeys: [],
      };
    }

    const bot = result.bot;
    io.log(`  OK: Bot @${bot.username} (${bot.first_name})`);
    io.log("");

    // Optional: configure webhook URL
    const configureWebhook = await io.confirm("Configure webhook URL?", false);
    let webhookUrl: string | undefined;

    if (configureWebhook) {
      io.log("");
      io.log("The webhook URL is where Telegram sends incoming messages.");
      io.log("Format: https://your-domain.com/webhook/telegram");
      webhookUrl = await io.prompt("Webhook URL");

      if (webhookUrl) {
        io.log("Webhook URL will be stored in config (set it up after deploy with `clawhq up`).");
      }
    }

    // Store credentials and config
    await writeChannelEnv(options.envPath, ENV_VAR, token);
    await writeChannelConfig(options.configPath, "telegram", {
      enabled: true,
      ...(webhookUrl ? { webhookUrl } : {}),
    });

    io.log("");
    io.log(`Telegram connected: @${bot.username}`);
    io.log(`  Token stored in .env as ${ENV_VAR}`);
    io.log("  Channel enabled in openclaw.json");

    return {
      channel: "telegram",
      success: true,
      message: `Connected @${bot.username}`,
      envVarsSet: [ENV_VAR],
      configKeys: ["channels.telegram"],
    };
  },

  async test(options: ConnectOptions): Promise<ChannelTestResult> {
    const steps: ChannelTestStep[] = [];

    // Step 1: Read token from .env
    const token = await readChannelEnv(options.envPath, ENV_VAR);
    if (!token) {
      steps.push({
        name: "Read bot token",
        passed: false,
        message: `${ENV_VAR} not found in .env — run \`clawhq connect telegram\` first`,
      });
      return { channel: "telegram", success: false, steps };
    }
    steps.push({ name: "Read bot token", passed: true, message: "Token found in .env" });

    // Step 2: Validate token (getMe)
    const validation = await validateTelegramToken(token);
    if (!validation.valid || !validation.bot) {
      steps.push({ name: "Validate token", passed: false, message: validation.error ?? "Invalid token" });
      return { channel: "telegram", success: false, steps };
    }
    steps.push({ name: "Validate token", passed: true, message: `Bot @${validation.bot.username} is valid` });

    // Step 3: Check getUpdates (bot can receive messages)
    const updates = await checkUpdates(token);
    if (!updates.hasUpdates && updates.error) {
      steps.push({ name: "Check receive capability", passed: false, message: updates.error });
      return { channel: "telegram", success: false, steps };
    }
    steps.push({ name: "Check receive capability", passed: true, message: "Bot can poll for updates" });

    // Step 4: Check channel config
    const channels = await readOpenClawChannels(options.configPath);
    const telegramConfig = channels?.telegram;
    if (!telegramConfig?.enabled) {
      steps.push({ name: "Check channel config", passed: false, message: "Telegram not enabled in openclaw.json" });
      return { channel: "telegram", success: false, steps };
    }
    steps.push({ name: "Check channel config", passed: true, message: "Telegram enabled in config" });

    return {
      channel: "telegram",
      success: steps.every((s) => s.passed),
      steps,
    };
  },

  async health(options: ConnectOptions): Promise<ChannelHealth> {
    const token = await readChannelEnv(options.envPath, ENV_VAR);
    if (!token) {
      return { channel: "telegram", status: "unconfigured", message: "Not configured" };
    }

    const channels = await readOpenClawChannels(options.configPath);
    if (!channels?.telegram?.enabled) {
      return { channel: "telegram", status: "disconnected", message: "Disabled in config" };
    }

    const result = await validateTelegramToken(token);
    if (!result.valid || !result.bot) {
      return { channel: "telegram", status: "error", message: result.error ?? "Invalid token" };
    }

    return {
      channel: "telegram",
      status: "connected",
      message: "Connected",
      displayName: `@${result.bot.username}`,
    };
  },
};
