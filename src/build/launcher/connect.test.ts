import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";

import {
  connectChannel,
  pingGateway,
  updateChannelConfig,
} from "./connect.js";
import type { ConnectProgress } from "./types.js";

// ── Test Fixtures ───────────────────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `clawhq-connect-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(testDir, "engine"), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ── updateChannelConfig ──────────────────────────────────────────────────────

describe("updateChannelConfig", () => {
  it("enables telegram channel in openclaw.json", async () => {
    const configPath = join(testDir, "engine", "openclaw.json");
    await writeFile(configPath, JSON.stringify({
      gateway: { port: GATEWAY_DEFAULT_PORT },
      channels: { telegram: { enabled: false } },
    }, null, 2));

    await updateChannelConfig(testDir, "telegram");

    const updated = JSON.parse(await readFile(configPath, "utf-8"));
    expect(updated.channels.telegram.enabled).toBe(true);
    expect(updated.channels.telegram.dmPolicy).toBe("pairing");
    // Preserves existing config
    expect(updated.gateway.port).toBe(GATEWAY_DEFAULT_PORT);
  });

  it("creates channels object when missing", async () => {
    const configPath = join(testDir, "engine", "openclaw.json");
    await writeFile(configPath, JSON.stringify({ gateway: { port: GATEWAY_DEFAULT_PORT } }, null, 2));

    await updateChannelConfig(testDir, "whatsapp");

    const updated = JSON.parse(await readFile(configPath, "utf-8"));
    expect(updated.channels.whatsapp.enabled).toBe(true);
    expect(updated.channels.whatsapp.dmPolicy).toBe("pairing");
  });

  it("preserves other channel configs", async () => {
    const configPath = join(testDir, "engine", "openclaw.json");
    await writeFile(configPath, JSON.stringify({
      channels: {
        telegram: { enabled: true, dmPolicy: "open" },
        discord: { enabled: false },
      },
    }, null, 2));

    await updateChannelConfig(testDir, "whatsapp");

    const updated = JSON.parse(await readFile(configPath, "utf-8"));
    expect(updated.channels.telegram.enabled).toBe(true);
    expect(updated.channels.telegram.dmPolicy).toBe("open");
    expect(updated.channels.discord.enabled).toBe(false);
    expect(updated.channels.whatsapp.enabled).toBe(true);
  });
});

// ── pingGateway ──────────────────────────────────────────────────────────────

describe("pingGateway", () => {
  it("returns unhealthy when gateway is unreachable", async () => {
    // Use a port that's very unlikely to be in use
    const result = await pingGateway("test-token", 19999);
    expect(result.healthy).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ── connectChannel ───────────────────────────────────────────────────────────

describe("connectChannel", () => {
  it("writes credentials to .env and updates config", async () => {
    // Setup: create openclaw.json and .env
    const configPath = join(testDir, "engine", "openclaw.json");
    const envPath = join(testDir, "engine", ".env");
    await writeFile(configPath, JSON.stringify({ gateway: { port: GATEWAY_DEFAULT_PORT } }, null, 2));
    await writeFile(envPath, "GATEWAY_TOKEN=test-token\n", { mode: 0o600 });

    const events: ConnectProgress[] = [];

    // Mock: gateway won't be reachable, so connect will fail at health-ping step
    const result = await connectChannel({
      deployDir: testDir,
      channel: "telegram",
      credentials: {
        channel: "telegram",
        vars: {
          TELEGRAM_BOT_TOKEN: "123456:ABC-DEF",
          TELEGRAM_CHAT_ID: "987654",
        },
      },
      gatewayToken: "test-token",
      gatewayPort: 19999, // unreachable port
      onProgress: (event) => events.push(event),
    });

    // Credentials should be written even though gateway is unreachable
    const envContent = await readFile(envPath, "utf-8");
    expect(envContent).toContain("TELEGRAM_BOT_TOKEN=123456:ABC-DEF");
    expect(envContent).toContain("TELEGRAM_CHAT_ID=987654");
    expect(envContent).toContain("GATEWAY_TOKEN=test-token");

    // Config should be updated
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    expect(config.channels.telegram.enabled).toBe(true);

    // Should fail since there's no running container / gateway
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();

    // Progress events should include credential and config steps
    const stepNames = events.map((e) => e.step);
    expect(stepNames).toContain("write-credentials");
    expect(stepNames).toContain("update-config");
  });

  it("handles WhatsApp credential writing", async () => {
    const configPath = join(testDir, "engine", "openclaw.json");
    const envPath = join(testDir, "engine", ".env");
    await writeFile(configPath, JSON.stringify({}, null, 2));
    await writeFile(envPath, "", { mode: 0o600 });

    await connectChannel({
      deployDir: testDir,
      channel: "whatsapp",
      credentials: {
        channel: "whatsapp",
        vars: {
          WHATSAPP_PHONE_NUMBER_ID: "12345",
          WHATSAPP_ACCESS_TOKEN: "secret-token",
          WHATSAPP_RECIPIENT_PHONE: "14155551234",
        },
      },
      gatewayToken: "test-token",
      gatewayPort: 19999,
    });

    const envContent = await readFile(envPath, "utf-8");
    expect(envContent).toContain("WHATSAPP_PHONE_NUMBER_ID=12345");
    expect(envContent).toContain("WHATSAPP_ACCESS_TOKEN=secret-token");

    const config = JSON.parse(await readFile(configPath, "utf-8"));
    expect(config.channels.whatsapp.enabled).toBe(true);
    expect(config.channels.whatsapp.dmPolicy).toBe("pairing");
  });

  it("reports progress through all steps", async () => {
    const configPath = join(testDir, "engine", "openclaw.json");
    const envPath = join(testDir, "engine", ".env");
    await writeFile(configPath, JSON.stringify({}, null, 2));
    await writeFile(envPath, "", { mode: 0o600 });

    const events: ConnectProgress[] = [];

    await connectChannel({
      deployDir: testDir,
      channel: "telegram",
      credentials: {
        channel: "telegram",
        vars: { TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "123" },
      },
      gatewayToken: "test",
      gatewayPort: 19999,
      onProgress: (event) => events.push(event),
    });

    // Should have running + done for write-credentials and update-config
    expect(events.filter((e) => e.step === "write-credentials" && e.status === "done")).toHaveLength(1);
    expect(events.filter((e) => e.step === "update-config" && e.status === "done")).toHaveLength(1);
    // Should have a failure at some step (recreate or health-ping depending on Docker availability)
    expect(events.some((e) => e.status === "failed")).toBe(true);
  });
});
