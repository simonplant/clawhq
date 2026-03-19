/**
 * Messaging channel connection — guided setup, validation, and test message.
 *
 * `clawhq connect` configures and verifies a messaging channel so the user
 * can talk to their agent. Supports Telegram and WhatsApp.
 *
 * Flow: select channel → collect credentials → validate token → write .env →
 * update openclaw.json → Gateway health ping → send test message.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { GATEWAY_DEFAULT_PORT, WHATSAPP_API_BASE, WHATSAPP_API_VERSION } from "../../config/defaults.js";
import { GatewayClient } from "../../gateway/index.js";
import { readEnv, setEnvValue, writeEnvAtomic } from "../../secure/credentials/env-store.js";

import type { ConnectOptions, ConnectResult } from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const TELEGRAM_API = "https://api.telegram.org";
const WHATSAPP_API = `${WHATSAPP_API_BASE}/${WHATSAPP_API_VERSION}`;
const GATEWAY_RPC_TIMEOUT_MS = 10_000;

// ── Supported Channels ──────────────────────────────────────────────────────

export type ChannelName = "telegram" | "whatsapp";

export interface ChannelCredentials {
  readonly channel: ChannelName;
  readonly vars: Record<string, string>;
}

// ── Telegram Validation ──────────────────────────────────────────────────────

/**
 * Validate a Telegram bot token by calling the getMe API.
 * Returns the bot username on success, throws on failure.
 */
export async function validateTelegramToken(botToken: string): Promise<string> {
  const url = `${TELEGRAM_API}/bot${botToken}/getMe`;
  const response = await fetch(url, { method: "GET" });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram token validation failed (HTTP ${response.status}): ${body}`);
  }

  const data = (await response.json()) as { ok: boolean; result?: { username?: string } };
  if (!data.ok || !data.result?.username) {
    throw new Error("Telegram token validation failed: unexpected response");
  }

  return data.result.username;
}

/**
 * Send a test message via Telegram Bot API.
 */
export async function sendTelegramTestMessage(
  botToken: string,
  chatId: string,
  agentName: string,
): Promise<void> {
  const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;
  const text = `✅ ${agentName} is connected and ready. This is a test message from clawhq connect.`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Failed to send Telegram test message (HTTP ${response.status}): ${body}`);
  }
}

// ── WhatsApp Validation ──────────────────────────────────────────────────────

/**
 * Validate a WhatsApp Business API token by checking the phone number.
 * Returns the display phone number on success, throws on failure.
 */
export async function validateWhatsAppToken(
  phoneNumberId: string,
  accessToken: string,
): Promise<string> {
  const url = `${WHATSAPP_API}/${phoneNumberId}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`WhatsApp token validation failed (HTTP ${response.status}): ${body}`);
  }

  const data = (await response.json()) as { display_phone_number?: string };
  if (!data.display_phone_number) {
    throw new Error("WhatsApp token validation failed: unexpected response");
  }

  return data.display_phone_number;
}

/**
 * Send a test message via WhatsApp Business API.
 */
export async function sendWhatsAppTestMessage(
  phoneNumberId: string,
  accessToken: string,
  recipientPhone: string,
  agentName: string,
): Promise<void> {
  const url = `${WHATSAPP_API}/${phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: recipientPhone,
      type: "text",
      text: {
        body: `✅ ${agentName} is connected and ready. This is a test message from clawhq connect.`,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Failed to send WhatsApp test message (HTTP ${response.status}): ${body}`);
  }
}

// ── Config Update ────────────────────────────────────────────────────────────

/**
 * Read openclaw.json, enable the selected channel, and write back.
 */
export function updateChannelConfig(deployDir: string, channel: ChannelName): void {
  const configPath = join(deployDir, "engine", "openclaw.json");
  const raw = readFileSync(configPath, "utf-8");
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.warn("[connect] Failed to parse openclaw.json:", err);
    throw new Error("Failed to parse openclaw.json — file may be corrupted", { cause: err });
  }

  // Ensure channels object exists
  const channels = (config["channels"] ?? {}) as Record<string, Record<string, unknown>>;

  // Enable the selected channel with pairing DM policy
  channels[channel] = {
    ...channels[channel],
    enabled: true,
    dmPolicy: "pairing",
  };

  config["channels"] = channels;

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

// ── Gateway Health Ping ──────────────────────────────────────────────────────

/**
 * Verify the Gateway is reachable via WebSocket RPC.
 */
export async function pingGateway(
  token: string,
  port: number,
  host?: string,
): Promise<{ healthy: boolean; error?: string }> {
  const client = new GatewayClient({
    token,
    host: host ?? "127.0.0.1",
    port,
    timeoutMs: GATEWAY_RPC_TIMEOUT_MS,
  });

  try {
    await client.connect();
    await client.rpc("status", undefined, { timeoutMs: GATEWAY_RPC_TIMEOUT_MS });
    client.close();
    return { healthy: true };
  } catch (err) {
    client.close();
    const message = err instanceof Error ? err.message : String(err);
    return { healthy: false, error: message };
  }
}

// ── Main Connect Flow ────────────────────────────────────────────────────────

/**
 * Execute the full channel connection flow.
 *
 * 1. Write credentials to .env (atomic, 0600)
 * 2. Update openclaw.json channel config
 * 3. Verify Gateway health via WebSocket RPC
 * 4. Send test message via channel API
 */
export async function connectChannel(options: ConnectOptions): Promise<ConnectResult> {
  const {
    deployDir,
    channel,
    credentials,
    gatewayToken,
    gatewayPort = GATEWAY_DEFAULT_PORT,
    agentName = "Your agent",
    onProgress,
  } = options;

  const envPath = join(deployDir, "engine", ".env");

  // Step 1: Write credentials to .env
  onProgress?.({ step: "write-credentials", status: "running", message: "Writing channel credentials…" });

  try {
    let envFile = readEnv(envPath);
    for (const [key, value] of Object.entries(credentials.vars)) {
      envFile = setEnvValue(envFile, key, value);
    }
    writeEnvAtomic(envPath, envFile);
    onProgress?.({ step: "write-credentials", status: "done", message: "Credentials saved to .env (mode 0600)" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onProgress?.({ step: "write-credentials", status: "failed", message: `Failed to write credentials: ${message}` });
    return { success: false, channel, error: `Failed to write credentials: ${message}` };
  }

  // Step 2: Update openclaw.json
  onProgress?.({ step: "update-config", status: "running", message: "Updating channel config…" });

  try {
    updateChannelConfig(deployDir, channel);
    onProgress?.({ step: "update-config", status: "done", message: `Channel "${channel}" enabled in openclaw.json` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onProgress?.({ step: "update-config", status: "failed", message: `Failed to update config: ${message}` });
    return { success: false, channel, error: `Failed to update config: ${message}` };
  }

  // Step 3: Gateway health ping
  onProgress?.({ step: "health-ping", status: "running", message: "Verifying Gateway connection…" });

  const health = await pingGateway(gatewayToken, gatewayPort);
  if (health.healthy) {
    onProgress?.({ step: "health-ping", status: "done", message: "Gateway is reachable" });
  } else {
    onProgress?.({ step: "health-ping", status: "failed", message: `Gateway unreachable: ${health.error}` });
    // Non-fatal: credentials and config are saved, agent may not be running yet
    return {
      success: false,
      channel,
      error: `Channel configured but Gateway is unreachable: ${health.error}. Start agent with 'clawhq up' first.`,
    };
  }

  // Step 4: Send test message
  onProgress?.({ step: "test-message", status: "running", message: "Sending test message…" });

  try {
    if (channel === "telegram") {
      const botToken = credentials.vars["TELEGRAM_BOT_TOKEN"];
      const chatId = credentials.vars["TELEGRAM_CHAT_ID"];
      if (!botToken || !chatId) {
        throw new Error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
      }
      await sendTelegramTestMessage(botToken, chatId, agentName);
    } else if (channel === "whatsapp") {
      const phoneNumberId = credentials.vars["WHATSAPP_PHONE_NUMBER_ID"];
      const accessToken = credentials.vars["WHATSAPP_ACCESS_TOKEN"];
      const recipientPhone = credentials.vars["WHATSAPP_RECIPIENT_PHONE"];
      if (!phoneNumberId || !accessToken || !recipientPhone) {
        throw new Error("Missing WhatsApp credentials");
      }
      await sendWhatsAppTestMessage(phoneNumberId, accessToken, recipientPhone, agentName);
    }
    onProgress?.({ step: "test-message", status: "done", message: "Test message sent — check your channel!" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onProgress?.({ step: "test-message", status: "failed", message: `Test message failed: ${message}` });
    // Non-fatal: channel is configured even if test message fails
    return {
      success: true,
      channel,
      testMessageSent: false,
      error: `Channel connected but test message failed: ${message}`,
    };
  }

  return { success: true, channel, testMessageSent: true };
}
