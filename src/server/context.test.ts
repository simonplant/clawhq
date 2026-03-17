import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { resolveConfig } from "./context.js";

describe("resolveConfig", () => {
  beforeEach(() => {
    vi.stubEnv("OPENCLAW_HOME", "");
    vi.stubEnv("CLAWHQ_TOKEN", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns defaults when no overrides provided", () => {
    delete process.env["OPENCLAW_HOME"];
    delete process.env["CLAWHQ_TOKEN"];
    const config = resolveConfig();
    expect(config.port).toBe(18790);
    expect(config.host).toBe("127.0.0.1");
    expect(config.token).toBeUndefined();
    expect(config.openclawHome).toContain(".openclaw");
  });

  it("uses overrides when provided", () => {
    const config = resolveConfig({
      port: 9999,
      host: "0.0.0.0",
      token: "test-token",
      openclawHome: "/tmp/oc",
    });
    expect(config.port).toBe(9999);
    expect(config.host).toBe("0.0.0.0");
    expect(config.token).toBe("test-token");
    expect(config.openclawHome).toBe("/tmp/oc");
  });

  it("reads OPENCLAW_HOME from env", () => {
    vi.stubEnv("OPENCLAW_HOME", "/custom/home");
    const config = resolveConfig();
    expect(config.openclawHome).toBe("/custom/home");
  });

  it("reads CLAWHQ_TOKEN from env", () => {
    vi.stubEnv("CLAWHQ_TOKEN", "env-token");
    const config = resolveConfig();
    expect(config.token).toBe("env-token");
  });
});
