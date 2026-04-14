/**
 * Messaging channel connection — full lifecycle from token to talking.
 *
 * `clawhq connect` configures and verifies a messaging channel so the user
 * can talk to their agent. Supports Telegram and WhatsApp.
 *
 * Flow: validate token → write .env → update openclaw.json →
 * force-recreate container → wait for health → wait for channel connect.
 *
 * Docker only reads env_file at container creation time, so we must
 * force-recreate (not just restart) for .env changes to take effect.
 */

import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { GATEWAY_DEFAULT_PORT, GATEWAY_RPC_TIMEOUT_MS, TELEGRAM_API_BASE, WHATSAPP_API_BASE, WHATSAPP_API_VERSION } from "../../config/defaults.js";
import { GatewayClient } from "../../gateway/index.js";
import { readEnv, setEnvValue, writeEnvAtomic } from "../../secure/credentials/env-store.js";

import type { ConnectOptions, ConnectResult } from "./types.js";

const execFileAsync = promisify(execFile);

/** How long to wait for the channel to start polling after container recreation. */
const CHANNEL_CONNECT_TIMEOUT_MS = 30_000;

/** How long to wait for Gateway health after container recreation. */
const HEALTH_TIMEOUT_MS = 60_000;

// ── Constants ────────────────────────────────────────────────────────────────

const TELEGRAM_API = TELEGRAM_API_BASE;
const WHATSAPP_API = `${WHATSAPP_API_BASE}/${WHATSAPP_API_VERSION}`;

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
 * 3. Recreate container (force-recreate so new .env is loaded)
 * 4. Wait for Gateway health
 * 5. Wait for channel to connect (poll logs)
 *
 * Docker only reads env_file at container creation time, so a
 * `docker restart` is NOT enough — we must `docker compose up --force-recreate`.
 */
export async function connectChannel(options: ConnectOptions): Promise<ConnectResult> {
  const {
    deployDir,
    channel,
    credentials,
    gatewayToken,
    gatewayPort = GATEWAY_DEFAULT_PORT,
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

  // Step 3: Recreate container so new .env is picked up
  // Docker only reads env_file at container creation — restart is not enough.
  onProgress?.({ step: "recreate", status: "running", message: "Recreating container with new credentials…" });

  try {
    await recreateContainer(deployDir);
    onProgress?.({ step: "recreate", status: "done", message: "Container recreated" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onProgress?.({ step: "recreate", status: "failed", message: `Container recreate failed: ${message}` });
    return { success: false, channel, error: `Container recreate failed: ${message}. Credentials were saved — retry with: clawhq restart` };
  }

  // Step 4: Wait for Gateway health
  onProgress?.({ step: "health-ping", status: "running", message: "Waiting for Gateway…" });

  const healthResult = await waitForHealth(gatewayToken, gatewayPort);
  if (healthResult.healthy) {
    onProgress?.({ step: "health-ping", status: "done", message: `Gateway reachable (${healthResult.attempts} attempt(s))` });
  } else {
    onProgress?.({ step: "health-ping", status: "failed", message: `Gateway not reachable: ${healthResult.error}` });
    return { success: false, channel, error: `Gateway not reachable after recreate: ${healthResult.error}` };
  }

  // Step 5: Wait for channel to start polling (non-fatal timeout)
  onProgress?.({ step: "channel-wait", status: "running", message: `Waiting for ${channel} to connect…` });

  const channelUp = await waitForChannelConnect(channel, CHANNEL_CONNECT_TIMEOUT_MS, deployDir);
  if (channelUp) {
    onProgress?.({ step: "channel-wait", status: "done", message: `${channel} connected and polling` });
  } else {
    onProgress?.({ step: "channel-wait", status: "done", message: `${channel} starting — send a message to pair` });
  }

  return { success: true, channel, testMessageSent: false };
}

// ── Container Recreation ────────────────────────────────────────────────────

/**
 * Force-recreate the containers via docker compose.
 *
 * This is required because Docker only reads `env_file` at container creation
 * time. A `docker restart` does NOT reload `.env` — the container keeps the
 * old environment. `--force-recreate` destroys and recreates with fresh env.
 */
async function recreateContainer(deployDir: string): Promise<void> {
  const engineDir = join(deployDir, "engine");
  await execFileAsync(
    "docker",
    ["compose", "up", "-d", "--force-recreate", "--wait"],
    { cwd: engineDir, timeout: 120_000 },
  );
}

// ── Health Polling ──────────────────────────────────────────────────────────

/**
 * Poll Gateway health with exponential backoff until reachable.
 *
 * Uses HTTP /healthz instead of WebSocket RPC — simpler, no auth challenge,
 * and sufficient to confirm the Gateway is up and ready.
 */
async function waitForHealth(
  _token: string,
  port: number,
): Promise<{ healthy: boolean; attempts: number; error?: string }> {
  const start = Date.now();
  let attempts = 0;
  let interval = 2_000;

  while (Date.now() - start < HEALTH_TIMEOUT_MS) {
    attempts++;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return { healthy: true, attempts };
    } catch {
      // Not ready yet
    }
    await delay(interval);
    interval = Math.min(interval * 1.5, 10_000);
  }

  return { healthy: false, attempts, error: `Timed out after ${Math.round(HEALTH_TIMEOUT_MS / 1000)}s` };
}

// ── Channel Connect Detection ───────────────────────────────────────────────

/**
 * Poll docker logs looking for evidence the channel connected.
 *
 * For Telegram: looks for "starting provider" without a subsequent error,
 * or "polling" / "long-poll" which indicates successful connection.
 * Times out gracefully — the channel may still connect after we return.
 */
async function waitForChannelConnect(
  channel: string,
  timeoutMs: number,
  deployDir: string,
): Promise<boolean> {
  const start = Date.now();
  const engineDir = join(deployDir, "engine");

  while (Date.now() - start < timeoutMs) {
    try {
      const elapsed = Math.ceil((Date.now() - start) / 1000);
      const lookback = `${Math.max(30, elapsed + 10)}s`;
      const { stdout } = await execFileAsync(
        "docker",
        ["compose", "logs", "--no-color", "--since", lookback, "openclaw"],
        { timeout: 5_000, cwd: engineDir },
      );

      const lines = stdout.split("\n").filter((l) => l.includes(`[${channel}]`));
      const hasStarted = lines.some((l) => l.includes("starting provider"));
      const hasPolling = lines.some((l) =>
        l.includes("polling") || l.includes("long-poll") || l.includes("getUpdates"),
      );
      const hasFatalError = lines.some((l) =>
        l.includes("Unauthorized") || l.includes("channel exited"),
      );

      if (hasPolling) return true;
      if (hasFatalError) return false;
      if (hasStarted) {
        // Give it a bit more time to finish connecting
        await delay(3_000);
        continue;
      }
    } catch {
      // docker logs failed — container may still be starting
    }

    await delay(2_000);
  }

  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
