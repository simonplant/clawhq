import { afterEach, describe, expect, it, vi } from "vitest";

import { firewallCheck } from "./firewall.js";
import type { FirewallCheckContext } from "./firewall.js";

// Mock the firewall module
vi.mock("../../../secure/firewall/index.js", () => ({
  checkPlatform: vi.fn(() => ({ supported: true, message: "Linux" })),
  chainExists: vi.fn(async () => true),
  buildConfig: vi.fn(async () => ({
    chainName: "CLAWHQ_FWD",
    bridgeInterface: "docker0",
    allowlist: [
      { domain: "registry-1.docker.io", ips: ["1.2.3.4"] },
    ],
  })),
  verify: vi.fn(async () => ({
    matches: true,
    currentRules: [],
    missingRules: [],
    extraRules: [],
    message: "Firewall rules match expected state",
  })),
}));

const mocks = await import("../../../secure/firewall/index.js") as unknown as {
  checkPlatform: ReturnType<typeof vi.fn>;
  chainExists: ReturnType<typeof vi.fn>;
  buildConfig: ReturnType<typeof vi.fn>;
  verify: ReturnType<typeof vi.fn>;
};

function makeCtx(overrides: Partial<FirewallCheckContext> = {}): FirewallCheckContext {
  return {
    openclawHome: "/tmp/openclaw",
    configPath: "/tmp/openclaw/openclaw.json",
    ...overrides,
  };
}

describe("firewallCheck", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes when firewall rules match", async () => {
    const result = await firewallCheck.run(makeCtx());

    expect(result.status).toBe("pass");
    expect(result.message).toContain("match expected state");
  });

  it("warns on unsupported platform", async () => {
    mocks.checkPlatform.mockReturnValue({
      supported: false,
      message: "macOS detected. Egress firewall requires Linux.",
    });

    const result = await firewallCheck.run(makeCtx());

    expect(result.status).toBe("warn");
    expect(result.message).toContain("macOS");
  });

  it("fails when chain does not exist", async () => {
    mocks.checkPlatform.mockReturnValue({ supported: true, message: "" });
    mocks.chainExists.mockResolvedValue(false);

    const result = await firewallCheck.run(makeCtx());

    expect(result.status).toBe("fail");
    expect(result.message).toContain("does not exist");
    expect(result.fix).toContain("clawhq up");
  });

  it("fails when rules don't match", async () => {
    mocks.checkPlatform.mockReturnValue({ supported: true, message: "" });
    mocks.chainExists.mockResolvedValue(true);
    mocks.verify.mockResolvedValue({
      matches: false,
      currentRules: [],
      missingRules: ["some rule"],
      extraRules: [],
      message: "1 missing, 0 unexpected rules",
    });

    const result = await firewallCheck.run(makeCtx());

    expect(result.status).toBe("fail");
    expect(result.message).toContain("mismatch");
  });

  it("fails gracefully on error", async () => {
    mocks.checkPlatform.mockReturnValue({ supported: true, message: "" });
    mocks.chainExists.mockRejectedValue(new Error("sudo required"));

    const result = await firewallCheck.run(makeCtx());

    expect(result.status).toBe("fail");
    expect(result.message).toContain("sudo required");
  });

  it("passes provider context through to buildConfig", async () => {
    mocks.checkPlatform.mockReturnValue({ supported: true, message: "" });
    mocks.chainExists.mockResolvedValue(true);
    mocks.verify.mockResolvedValue({
      matches: true,
      currentRules: [],
      missingRules: [],
      extraRules: [],
      message: "ok",
    });

    await firewallCheck.run(makeCtx({
      enabledProviders: ["anthropic"],
      bridgeInterface: "br-custom",
    }));

    expect(mocks.buildConfig).toHaveBeenCalledWith({
      enabledProviders: ["anthropic"],
      extraDomains: undefined,
      bridgeInterface: "br-custom",
    });
  });
});
