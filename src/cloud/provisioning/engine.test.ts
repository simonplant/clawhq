import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderAdapter, ProvisionOptions } from "./types.js";

// ── Module-level mocks ─────────────────────────────────────────────────────

let mockAdapter: ProviderAdapter;

vi.mock("./credentials.js", () => ({
  getProviderCredential: () => ({ token: "test-token", storedAt: new Date().toISOString() }),
}));

vi.mock("./providers/digitalocean.js", () => ({
  createDigitalOceanAdapter: () => mockAdapter,
}));

vi.mock("./health.js", () => ({
  pollInstanceHealth: () => Promise.resolve({ healthy: true, attempts: 1, elapsedMs: 100 }),
}));

// Registry mock — allows per-test override of addInstance to simulate write failures
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let addInstanceOverride: ((...args: any[]) => any) | undefined;

vi.mock("./registry.js", async () => {
  const actual = await vi.importActual<typeof import("./registry.js")>("./registry.js");
  return {
    ...actual,
    addInstance: (...args: unknown[]) => {
      if (addInstanceOverride) return addInstanceOverride(...args);
      return (actual.addInstance as (...a: unknown[]) => unknown)(...args);
    },
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "engine-test-"));
});

afterEach(() => {
  addInstanceOverride = undefined;
  rmSync(testDir, { recursive: true, force: true });
});

function makeAdapterWith(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    provider: "digitalocean",
    createVm: vi.fn().mockResolvedValue({
      success: true,
      providerInstanceId: "vm-123",
      ipAddress: "1.2.3.4",
    }),
    destroyVm: vi.fn().mockResolvedValue({ success: true, destroyed: true }),
    getVmStatus: vi.fn().mockResolvedValue({ state: "active", ipAddress: "1.2.3.4" }),
    validateToken: vi.fn().mockResolvedValue({ valid: true }),
    addSshKey: vi.fn().mockResolvedValue({ success: true }),
    listSshKeys: vi.fn().mockResolvedValue([]),
    createFirewall: vi.fn().mockResolvedValue({ success: true, firewallId: "fw-1" }),
    createSnapshot: vi.fn().mockResolvedValue({ success: true }),
    createVmFromSnapshot: vi.fn().mockResolvedValue({ success: true }),
    verifyDestroyed: vi.fn().mockResolvedValue(true),
    getMonthlyCost: vi.fn().mockReturnValue(12),
    ...overrides,
  };
}

function opts(overrides: Partial<ProvisionOptions> = {}): ProvisionOptions {
  return {
    provider: "digitalocean",
    deployDir: testDir,
    name: "test-agent",
    region: "nyc3",
    size: "s-2vcpu-4gb",
    ...overrides,
  };
}

function pemFilesIn(dir: string): string[] {
  const keysDir = join(dir, "keys");
  if (!existsSync(keysDir)) return [];
  return readdirSync(keysDir).filter((f) => f.endsWith(".pem"));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("provision — SSH key cleanup on failure", () => {
  it("AC1: deletes SSH private key after firewall creation failure", async () => {
    mockAdapter = makeAdapterWith({
      createFirewall: vi.fn().mockResolvedValue({ success: false, error: "API rate limited" }),
    });

    const { provision } = await import("./engine.js");
    const result = await provision(opts());

    expect(result.success).toBe(false);
    expect(result.error).toContain("Firewall creation failed");
    expect(pemFilesIn(testDir)).toHaveLength(0);
  });

  it("AC1: deletes SSH private key when firewall fails AND VM destroy also fails", async () => {
    mockAdapter = makeAdapterWith({
      createFirewall: vi.fn().mockResolvedValue({ success: false, error: "API rate limited" }),
      destroyVm: vi.fn().mockResolvedValue({ success: false, destroyed: false, error: "timeout" }),
    });

    const { provision } = await import("./engine.js");
    const result = await provision(opts());

    expect(result.success).toBe(false);
    expect(result.error).toContain("VM cleanup also failed");
    expect(pemFilesIn(testDir)).toHaveLength(0);
  });

  it("AC2: successful provisioning retains the key file", async () => {
    mockAdapter = makeAdapterWith();

    const { provision } = await import("./engine.js");
    const result = await provision(opts());

    expect(result.success).toBe(true);
    expect(pemFilesIn(testDir)).toHaveLength(1);
  });

  it("AC3: no-IP path retains the key and registers instance", async () => {
    mockAdapter = makeAdapterWith({
      createVm: vi.fn().mockResolvedValue({
        success: true,
        providerInstanceId: "vm-456",
        ipAddress: undefined,
      }),
      getVmStatus: vi.fn().mockResolvedValue({ state: "new", ipAddress: undefined }),
    });

    const { provision } = await import("./engine.js");
    const result = await provision(opts());

    expect(result.success).toBe(false);
    expect(result.instanceId).toBeDefined();
    expect(result.error).toContain("no IP address");
    expect(pemFilesIn(testDir)).toHaveLength(1);
  });

  it("deletes SSH private key when VM creation fails", async () => {
    mockAdapter = makeAdapterWith({
      createVm: vi.fn().mockResolvedValue({
        success: false,
        error: "Insufficient funds",
      }),
    });

    const { provision } = await import("./engine.js");
    const result = await provision(opts());

    expect(result.success).toBe(false);
    expect(result.error).toContain("Insufficient funds");
    expect(pemFilesIn(testDir)).toHaveLength(0);
  });
});

describe("provision — registry write failure after VM creation (BUG-110)", () => {
  it("returns success:false with provider instance ID when addInstance throws", async () => {
    mockAdapter = makeAdapterWith();

    // Simulate registry write failure (e.g. disk full, permissions error)
    addInstanceOverride = () => {
      throw new Error("ENOSPC: no space left on device");
    };

    const { provision } = await import("./engine.js");
    const result = await provision(opts());

    expect(result.success).toBe(false);
    expect(result.error).toContain("vm-123");
    expect(result.error).toContain("Provider instance ID");
    expect(result.error).toContain("destroy it via your digitalocean console");
  });

  it("includes SSH key path in the error output", async () => {
    mockAdapter = makeAdapterWith();

    addInstanceOverride = () => {
      throw new Error("EACCES: permission denied");
    };

    const { provision } = await import("./engine.js");
    const result = await provision(opts());

    expect(result.success).toBe(false);
    expect(result.error).toContain("SSH key path:");
    expect(result.error).toContain(".pem");
  });
});
