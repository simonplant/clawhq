import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DoctorContext } from "../types.js";

import { secretsScanCheck } from "./secrets-scan.js";

describe("secretsScanCheck", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "doctor-secrets-"));
  });

  afterEach(() => {
    // tmpDir cleanup handled by OS
  });

  function makeCtx(configPath: string): DoctorContext {
    return {
      openclawHome: tmpDir,
      configPath,
    };
  }

  it("passes when no secrets are in config", async () => {
    const configPath = join(tmpDir, "openclaw.json");
    await writeFile(configPath, JSON.stringify({
      dangerouslyDisableDeviceAuth: true,
      allowedOrigins: ["http://localhost:18789"],
    }));

    const result = await secretsScanCheck.run(makeCtx(configPath));

    expect(result.status).toBe("pass");
    expect(result.message).toContain("No secrets detected");
  });

  it("fails when Anthropic API key is found", async () => {
    const configPath = join(tmpDir, "openclaw.json");
    await writeFile(configPath, JSON.stringify({
      apiKey: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
    }));

    const result = await secretsScanCheck.run(makeCtx(configPath));

    expect(result.status).toBe("fail");
    expect(result.message).toContain("Anthropic API key");
  });

  it("fails when OpenAI API key is found", async () => {
    const configPath = join(tmpDir, "openclaw.json");
    await writeFile(configPath, JSON.stringify({
      apiKey: "sk-abcdefghijklmnopqrstuvwxyz1234567890",
    }));

    const result = await secretsScanCheck.run(makeCtx(configPath));

    expect(result.status).toBe("fail");
    expect(result.message).toContain("OpenAI API key");
  });

  it("fails when GitHub token is found", async () => {
    const configPath = join(tmpDir, "openclaw.json");
    await writeFile(configPath, JSON.stringify({
      token: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
    }));

    const result = await secretsScanCheck.run(makeCtx(configPath));

    expect(result.status).toBe("fail");
    expect(result.message).toContain("GitHub token");
  });

  it("warns when config file does not exist", async () => {
    const result = await secretsScanCheck.run(makeCtx("/nonexistent/openclaw.json"));

    expect(result.status).toBe("warn");
    expect(result.message).toContain("Cannot read");
  });

  it("detects multiple secret types", async () => {
    const configPath = join(tmpDir, "openclaw.json");
    await writeFile(configPath, JSON.stringify({
      anthropicKey: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
      awsKey: "AKIAIOSFODNN7EXAMPLE",
    }));

    const result = await secretsScanCheck.run(makeCtx(configPath));

    expect(result.status).toBe("fail");
    expect(result.message).toContain("Anthropic API key");
    expect(result.message).toContain("AWS access key");
  });
});
