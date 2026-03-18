import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readChannelEnv, readOpenClawChannels, writeChannelConfig, writeChannelEnv } from "./config.js";
import { collectChannelHealth, formatChannelSection, formatTestResult } from "./format.js";
import type { ChannelHealth, ChannelTestResult } from "./types.js";

describe("writeChannelEnv / readChannelEnv", () => {
  let tmpDir: string;
  let envPath: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-connect-env-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    envPath = join(tmpDir, ".env");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes and reads a new env var", async () => {
    await writeChannelEnv(envPath, "TELEGRAM_BOT_TOKEN", "123:ABC");
    const value = await readChannelEnv(envPath, "TELEGRAM_BOT_TOKEN");
    expect(value).toBe("123:ABC");
  });

  it("updates an existing env var", async () => {
    await writeFile(envPath, "TELEGRAM_BOT_TOKEN=old\nOTHER=value\n", "utf-8");
    await writeChannelEnv(envPath, "TELEGRAM_BOT_TOKEN", "new-token");
    const value = await readChannelEnv(envPath, "TELEGRAM_BOT_TOKEN");
    expect(value).toBe("new-token");

    // Verify other values are preserved
    const other = await readChannelEnv(envPath, "OTHER");
    expect(other).toBe("value");
  });

  it("returns undefined for missing env var", async () => {
    await writeFile(envPath, "OTHER=value\n", "utf-8");
    const value = await readChannelEnv(envPath, "TELEGRAM_BOT_TOKEN");
    expect(value).toBeUndefined();
  });

  it("returns undefined when .env file does not exist", async () => {
    const value = await readChannelEnv(join(tmpDir, "nonexistent", ".env"), "KEY");
    expect(value).toBeUndefined();
  });

  it("creates .env file if it does not exist", async () => {
    const newEnvPath = join(tmpDir, "new-dir", ".env");
    await mkdir(join(tmpDir, "new-dir"), { recursive: true });
    await writeChannelEnv(newEnvPath, "TOKEN", "value");

    const content = await readFile(newEnvPath, "utf-8");
    expect(content).toContain("TOKEN=value");
  });
});

describe("writeChannelConfig / readOpenClawChannels", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-connect-config-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    configPath = join(tmpDir, "openclaw.json");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes channel config to new file", async () => {
    await writeChannelConfig(configPath, "telegram", { enabled: true });
    const channels = await readOpenClawChannels(configPath);
    expect(channels?.telegram?.enabled).toBe(true);
  });

  it("preserves existing config when adding channel", async () => {
    await writeFile(configPath, JSON.stringify({ gateway: { port: 18789 } }), "utf-8");
    await writeChannelConfig(configPath, "telegram", { enabled: true });

    const content = JSON.parse(await readFile(configPath, "utf-8")) as Record<string, unknown>;
    expect((content.gateway as Record<string, unknown>).port).toBe(18789);
    expect((content.channels as Record<string, Record<string, unknown>>).telegram.enabled).toBe(true);
  });

  it("merges multiple channels", async () => {
    await writeChannelConfig(configPath, "telegram", { enabled: true });
    await writeChannelConfig(configPath, "whatsapp", { enabled: true });

    const channels = await readOpenClawChannels(configPath);
    expect(channels?.telegram?.enabled).toBe(true);
    expect(channels?.whatsapp?.enabled).toBe(true);
  });

  it("returns undefined when config file does not exist", async () => {
    const channels = await readOpenClawChannels(join(tmpDir, "nonexistent.json"));
    expect(channels).toBeUndefined();
  });
});

describe("formatChannelSection", () => {
  it("formats empty channel list", () => {
    const result = formatChannelSection([]);
    expect(result).toContain("No channels configured");
  });

  it("formats connected channels", () => {
    const channels: ChannelHealth[] = [
      { channel: "telegram", status: "connected", message: "Connected", displayName: "@mybot" },
    ];
    const result = formatChannelSection(channels);
    expect(result).toContain("telegram");
    expect(result).toContain("OK");
    expect(result).toContain("@mybot");
  });

  it("formats error channels", () => {
    const channels: ChannelHealth[] = [
      { channel: "whatsapp", status: "error", message: "Token expired" },
    ];
    const result = formatChannelSection(channels);
    expect(result).toContain("whatsapp");
    expect(result).toContain("ERR");
    expect(result).toContain("Token expired");
  });

  it("formats mixed status channels", () => {
    const channels: ChannelHealth[] = [
      { channel: "telegram", status: "connected", message: "Connected", displayName: "@bot" },
      { channel: "whatsapp", status: "disconnected", message: "Disabled in config" },
    ];
    const result = formatChannelSection(channels);
    expect(result).toContain("OK");
    expect(result).toContain("OFF");
  });
});

describe("formatTestResult", () => {
  it("formats passing test", () => {
    const result: ChannelTestResult = {
      channel: "telegram",
      success: true,
      steps: [
        { name: "Read bot token", passed: true, message: "Token found" },
        { name: "Validate token", passed: true, message: "Bot @test is valid" },
      ],
    };
    const output = formatTestResult(result);
    expect(output).toContain("telegram");
    expect(output).toContain("OK");
    expect(output).toContain("PASS");
  });

  it("formats failing test", () => {
    const result: ChannelTestResult = {
      channel: "telegram",
      success: false,
      steps: [
        { name: "Read bot token", passed: false, message: "Token not found" },
      ],
    };
    const output = formatTestResult(result);
    expect(output).toContain("FAIL");
  });
});

describe("collectChannelHealth", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `clawhq-test-connect-health-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when no channels are configured", async () => {
    const envPath = join(tmpDir, ".env");
    const configPath = join(tmpDir, "openclaw.json");
    await writeFile(envPath, "", "utf-8");
    await writeFile(configPath, "{}", "utf-8");

    const health = await collectChannelHealth({
      openclawHome: tmpDir,
      envPath,
      configPath,
    });

    // Unconfigured channels are filtered out
    expect(health.length).toBe(0);
  });

  it("reports disconnected when channel is in config but disabled", async () => {
    const envPath = join(tmpDir, ".env");
    const configPath = join(tmpDir, "openclaw.json");
    await writeFile(envPath, "TELEGRAM_BOT_TOKEN=fake-token\n", "utf-8");
    await writeFile(configPath, JSON.stringify({
      channels: { telegram: { enabled: false } },
    }), "utf-8");

    const health = await collectChannelHealth({
      openclawHome: tmpDir,
      envPath,
      configPath,
    });

    const telegram = health.find((h) => h.channel === "telegram");
    expect(telegram).toBeDefined();
    expect(telegram).toBeDefined();
    expect(telegram?.status).toBe("disconnected");
  });
});
