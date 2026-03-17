import { afterEach, describe, expect, it, vi } from "vitest";

import { buildExpectedRules } from "./iptables.js";
import type { AllowlistEntry } from "./types.js";
import { BASE_DOMAINS, CHAIN_NAME, PROVIDER_DOMAINS } from "./types.js";

// --- Mock iptables (all operations need sudo, can't run in CI) ---
vi.mock("./iptables.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./iptables.js")>();
  return {
    ...original,
    // Keep pure functions, mock side-effectful ones
    iptablesExec: vi.fn(),
    chainExists: vi.fn(),
    createChain: vi.fn(),
    flushChain: vi.fn(),
    deleteChain: vi.fn(),
    insertForwardJump: vi.fn(),
    removeForwardJump: vi.fn(),
    applyRules: vi.fn(),
    listRules: vi.fn(),
    checkPlatform: vi.fn(() => ({ supported: true, message: "Linux detected" })),
  };
});

vi.mock("./resolver.js", () => ({
  resolveDomain: vi.fn(async (domain: string) => [`1.2.3.${domain.length}`]),
  resolveAllowlist: vi.fn(async (domains: string[]) =>
    domains.map((d) => ({ domain: d, ips: [`1.2.3.${d.length}`] })),
  ),
}));

const iptablesMocks = await import("./iptables.js") as unknown as {
  chainExists: ReturnType<typeof vi.fn>;
  createChain: ReturnType<typeof vi.fn>;
  flushChain: ReturnType<typeof vi.fn>;
  deleteChain: ReturnType<typeof vi.fn>;
  insertForwardJump: ReturnType<typeof vi.fn>;
  removeForwardJump: ReturnType<typeof vi.fn>;
  applyRules: ReturnType<typeof vi.fn>;
  listRules: ReturnType<typeof vi.fn>;
  checkPlatform: ReturnType<typeof vi.fn>;
  buildExpectedRules: typeof buildExpectedRules;
};

const { apply, buildAirGappedConfig, buildConfig, deriveAllowlist, remove, verify } = await import("./firewall.js");

afterEach(() => {
  vi.restoreAllMocks();
});

// --- deriveAllowlist ---

describe("deriveAllowlist", () => {
  it("includes base domains by default", () => {
    const result = deriveAllowlist();
    for (const domain of BASE_DOMAINS) {
      expect(result).toContain(domain);
    }
  });

  it("adds provider domains for opted-in providers", () => {
    const result = deriveAllowlist(["anthropic"]);
    expect(result).toContain("api.anthropic.com");
  });

  it("adds multiple provider domains", () => {
    const result = deriveAllowlist(["anthropic", "openai"]);
    expect(result).toContain("api.anthropic.com");
    expect(result).toContain("api.openai.com");
  });

  it("ignores unknown providers", () => {
    const result = deriveAllowlist(["nonexistent"]);
    expect(result).toEqual(expect.arrayContaining(BASE_DOMAINS));
    expect(result).toHaveLength(BASE_DOMAINS.length);
  });

  it("includes extra domains", () => {
    const result = deriveAllowlist([], ["custom.example.com"]);
    expect(result).toContain("custom.example.com");
  });

  it("deduplicates domains", () => {
    const result = deriveAllowlist([], [BASE_DOMAINS[0]]);
    const occurrences = result.filter((d) => d === BASE_DOMAINS[0]);
    expect(occurrences).toHaveLength(1);
  });

  it("adds no extra domains for ollama (localhost only)", () => {
    const result = deriveAllowlist(["ollama"]);
    expect(result).toHaveLength(BASE_DOMAINS.length);
  });
});

// --- buildConfig ---

describe("buildConfig", () => {
  it("builds config with default bridge interface", async () => {
    const config = await buildConfig({});
    expect(config.chainName).toBe(CHAIN_NAME);
    expect(config.bridgeInterface).toBe("docker0");
    expect(config.allowlist.length).toBeGreaterThanOrEqual(BASE_DOMAINS.length);
  });

  it("uses custom bridge interface", async () => {
    const config = await buildConfig({ bridgeInterface: "br-custom" });
    expect(config.bridgeInterface).toBe("br-custom");
  });

  it("includes provider domains in allowlist", async () => {
    const config = await buildConfig({ enabledProviders: ["anthropic"] });
    const domains = config.allowlist.map((e) => e.domain);
    expect(domains).toContain("api.anthropic.com");
  });
});

// --- buildExpectedRules (pure function, not mocked) ---

describe("buildExpectedRules", () => {
  const allowlist: AllowlistEntry[] = [
    { domain: "api.anthropic.com", ips: ["1.2.3.4"] },
    { domain: "api.openai.com", ips: ["5.6.7.8", "9.10.11.12"] },
  ];

  it("starts with ESTABLISHED/RELATED rule", () => {
    const rules = buildExpectedRules("CLAWHQ_FWD", allowlist);
    expect(rules[0]).toContain("ESTABLISHED,RELATED");
    expect(rules[0]).toContain("ACCEPT");
  });

  it("includes DNS rules for UDP and TCP", () => {
    const rules = buildExpectedRules("CLAWHQ_FWD", allowlist);
    const dnsRules = rules.filter((r) => r.includes("--dport 53"));
    expect(dnsRules).toHaveLength(2);
    expect(dnsRules.some((r) => r.includes("-p udp"))).toBe(true);
    expect(dnsRules.some((r) => r.includes("-p tcp"))).toBe(true);
  });

  it("includes HTTPS rules for each allowlisted IP", () => {
    const rules = buildExpectedRules("CLAWHQ_FWD", allowlist);
    const httpsRules = rules.filter((r) => r.includes("--dport 443"));
    // 1 IP for anthropic + 2 IPs for openai = 3
    expect(httpsRules).toHaveLength(3);
    expect(httpsRules.some((r) => r.includes("1.2.3.4"))).toBe(true);
    expect(httpsRules.some((r) => r.includes("5.6.7.8"))).toBe(true);
    expect(httpsRules.some((r) => r.includes("9.10.11.12"))).toBe(true);
  });

  it("ends with LOG then DROP", () => {
    const rules = buildExpectedRules("CLAWHQ_FWD", allowlist);
    const lastTwo = rules.slice(-2);
    expect(lastTwo[0]).toContain("LOG");
    expect(lastTwo[0]).toContain("CLAWHQ_DROP");
    expect(lastTwo[1]).toContain("DROP");
  });

  it("preserves correct rule order", () => {
    const rules = buildExpectedRules("CLAWHQ_FWD", allowlist);
    // Order: ESTABLISHED > DNS > HTTPS > LOG > DROP
    const estIdx = rules.findIndex((r) => r.includes("ESTABLISHED"));
    const dnsIdx = rules.findIndex((r) => r.includes("--dport 53"));
    const httpsIdx = rules.findIndex((r) => r.includes("--dport 443"));
    const logIdx = rules.findIndex((r) => r.includes("LOG"));
    const dropIdx = rules.findIndex((r) => r.includes("-j DROP"));

    expect(estIdx).toBeLessThan(dnsIdx);
    expect(dnsIdx).toBeLessThan(httpsIdx);
    expect(httpsIdx).toBeLessThan(logIdx);
    expect(logIdx).toBeLessThan(dropIdx);
  });
});

// --- apply ---

describe("apply", () => {
  it("creates chain, flushes, applies rules, and inserts jump", async () => {
    iptablesMocks.createChain.mockResolvedValue(undefined);
    iptablesMocks.flushChain.mockResolvedValue(undefined);
    iptablesMocks.applyRules.mockResolvedValue(undefined);
    iptablesMocks.insertForwardJump.mockResolvedValue(undefined);

    const config = await buildConfig({ enabledProviders: ["anthropic"] });
    const result = await apply(config);

    expect(result.success).toBe(true);
    expect(result.message).toContain("Firewall applied");
    expect(iptablesMocks.createChain).toHaveBeenCalledWith(CHAIN_NAME);
    expect(iptablesMocks.flushChain).toHaveBeenCalledWith(CHAIN_NAME);
    expect(iptablesMocks.applyRules).toHaveBeenCalledWith(CHAIN_NAME, config.allowlist);
    expect(iptablesMocks.insertForwardJump).toHaveBeenCalledWith(CHAIN_NAME, "docker0");
  });

  it("is idempotent (flush + reapply)", async () => {
    iptablesMocks.createChain.mockResolvedValue(undefined);
    iptablesMocks.flushChain.mockResolvedValue(undefined);
    iptablesMocks.applyRules.mockResolvedValue(undefined);
    iptablesMocks.insertForwardJump.mockResolvedValue(undefined);

    const config = await buildConfig({});
    const callsBefore = iptablesMocks.flushChain.mock.calls.length;

    const result1 = await apply(config);
    const result2 = await apply(config);

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    // Should have flushed twice (once per apply call)
    expect(iptablesMocks.flushChain.mock.calls.length - callsBefore).toBe(2);
  });

  it("fails on unsupported platform", async () => {
    iptablesMocks.checkPlatform.mockReturnValue({
      supported: false,
      message: "macOS detected",
    });

    const config = await buildConfig({});
    const result = await apply(config);

    expect(result.success).toBe(false);
    expect(result.message).toContain("macOS");
  });

  it("fails gracefully on iptables error", async () => {
    iptablesMocks.checkPlatform.mockReturnValue({ supported: true, message: "" });
    iptablesMocks.createChain.mockRejectedValue(new Error("Permission denied"));

    const config = await buildConfig({});
    const result = await apply(config);

    expect(result.success).toBe(false);
    expect(result.message).toContain("Permission denied");
  });
});

// --- remove ---

describe("remove", () => {
  it("removes forward jump and deletes chain", async () => {
    iptablesMocks.checkPlatform.mockReturnValue({ supported: true, message: "" });
    iptablesMocks.chainExists.mockResolvedValue(true);
    iptablesMocks.removeForwardJump.mockResolvedValue(undefined);
    iptablesMocks.deleteChain.mockResolvedValue(undefined);

    const config = await buildConfig({});
    const result = await remove(config);

    expect(result.success).toBe(true);
    expect(result.message).toBe("Firewall removed");
    expect(iptablesMocks.removeForwardJump).toHaveBeenCalled();
    expect(iptablesMocks.deleteChain).toHaveBeenCalled();
  });

  it("succeeds when chain doesn't exist", async () => {
    iptablesMocks.checkPlatform.mockReturnValue({ supported: true, message: "" });
    iptablesMocks.chainExists.mockResolvedValue(false);

    const config = await buildConfig({});
    const result = await remove(config);

    expect(result.success).toBe(true);
    expect(result.message).toContain("does not exist");
  });

  it("fails on unsupported platform", async () => {
    iptablesMocks.checkPlatform.mockReturnValue({
      supported: false,
      message: "macOS detected",
    });

    const config = await buildConfig({});
    const result = await remove(config);

    expect(result.success).toBe(false);
  });
});

// --- verify ---

describe("verify", () => {
  it("returns matches=true when rules match", async () => {
    iptablesMocks.checkPlatform.mockReturnValue({ supported: true, message: "" });
    iptablesMocks.chainExists.mockResolvedValue(true);

    const config = await buildConfig({ enabledProviders: ["anthropic"] });
    const expected = buildExpectedRules(CHAIN_NAME, config.allowlist);
    iptablesMocks.listRules.mockResolvedValue(expected);

    const result = await verify(config);

    expect(result.matches).toBe(true);
    expect(result.missingRules).toHaveLength(0);
    expect(result.extraRules).toHaveLength(0);
  });

  it("returns matches=false when chain doesn't exist", async () => {
    iptablesMocks.checkPlatform.mockReturnValue({ supported: true, message: "" });
    iptablesMocks.chainExists.mockResolvedValue(false);

    const config = await buildConfig({});
    const result = await verify(config);

    expect(result.matches).toBe(false);
    expect(result.message).toContain("does not exist");
  });

  it("detects missing rules", async () => {
    iptablesMocks.checkPlatform.mockReturnValue({ supported: true, message: "" });
    iptablesMocks.chainExists.mockResolvedValue(true);

    const config = await buildConfig({});
    // Return only the DROP rule — everything else is missing
    iptablesMocks.listRules.mockResolvedValue([`-A ${CHAIN_NAME} -j DROP`]);

    const result = await verify(config);

    expect(result.matches).toBe(false);
    expect(result.missingRules.length).toBeGreaterThan(0);
  });

  it("detects extra rules", async () => {
    iptablesMocks.checkPlatform.mockReturnValue({ supported: true, message: "" });
    iptablesMocks.chainExists.mockResolvedValue(true);

    const config = await buildConfig({});
    const expected = buildExpectedRules(CHAIN_NAME, config.allowlist);
    iptablesMocks.listRules.mockResolvedValue([
      ...expected,
      `-A ${CHAIN_NAME} -d 99.99.99.99/32 -p tcp -m tcp --dport 443 -j ACCEPT`,
    ]);

    const result = await verify(config);

    expect(result.matches).toBe(false);
    expect(result.extraRules.length).toBeGreaterThan(0);
  });

  it("fails on unsupported platform", async () => {
    iptablesMocks.checkPlatform.mockReturnValue({
      supported: false,
      message: "macOS detected",
    });

    const config = await buildConfig({});
    const result = await verify(config);

    expect(result.matches).toBe(false);
  });

  it("handles iptables errors gracefully", async () => {
    iptablesMocks.checkPlatform.mockReturnValue({ supported: true, message: "" });
    iptablesMocks.chainExists.mockRejectedValue(new Error("sudo required"));

    const config = await buildConfig({});
    const result = await verify(config);

    expect(result.matches).toBe(false);
    expect(result.message).toContain("sudo required");
  });
});

// --- buildAirGappedConfig ---

describe("buildAirGappedConfig", () => {
  it("returns empty allowlist", async () => {
    const config = await buildAirGappedConfig();
    expect(config.allowlist).toHaveLength(0);
  });

  it("uses default bridge interface", async () => {
    const config = await buildAirGappedConfig();
    expect(config.bridgeInterface).toBe("docker0");
  });

  it("uses custom bridge interface", async () => {
    const config = await buildAirGappedConfig({ bridgeInterface: "br-custom" });
    expect(config.bridgeInterface).toBe("br-custom");
  });

  it("uses CLAWHQ_FWD chain name", async () => {
    const config = await buildAirGappedConfig();
    expect(config.chainName).toBe(CHAIN_NAME);
  });

  it("generates rules that block all HTTPS when applied", async () => {
    const config = await buildAirGappedConfig();
    const rules = buildExpectedRules(config.chainName, config.allowlist);

    // Should have: ESTABLISHED, DNS (x2), LOG, DROP — no HTTPS rules
    const httpsRules = rules.filter((r) => r.includes("--dport 443"));
    expect(httpsRules).toHaveLength(0);

    // Should still have DROP at end
    expect(rules[rules.length - 1]).toContain("DROP");
  });
});

// --- PROVIDER_DOMAINS completeness ---

describe("PROVIDER_DOMAINS", () => {
  it("has entries for known providers", () => {
    expect(PROVIDER_DOMAINS).toHaveProperty("anthropic");
    expect(PROVIDER_DOMAINS).toHaveProperty("openai");
    expect(PROVIDER_DOMAINS).toHaveProperty("google");
    expect(PROVIDER_DOMAINS).toHaveProperty("ollama");
  });

  it("ollama has no external domains", () => {
    expect(PROVIDER_DOMAINS.ollama).toHaveLength(0);
  });
});
