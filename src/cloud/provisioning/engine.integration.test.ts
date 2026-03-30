/**
 * Integration tests for the provisioning engine.
 *
 * Unlike engine.test.ts (which mocks credentials, health, registry, and ssh-keyscan),
 * these tests exercise the full provisioning state machine with:
 * - Real filesystem for registry state (instances.json) and credentials
 * - Real TCP health polling against local test servers
 * - Real SSH keypair generation
 *
 * Only the cloud provider API adapter is mocked (can't create real VMs in CI).
 * ssh-keyscan is also mocked (requires a real SSH server binary).
 */

import { createServer, type Server } from "node:net";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderAdapter, ProvisionOptions } from "./types.js";

// ── Shared state for mocks (vi.hoisted so vi.mock factories can reference) ──

const shared = vi.hoisted(() => ({
  sshPort: 0,
  dashPort: 0,
  mockAdapter: undefined as ProviderAdapter | undefined,
  collectHostKeyResult: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIntegrationTestKey" as string | undefined,
}));

// ── Mocks ───────────────────────────────────────────────────────────────────
// Only the provider adapter (cloud API) and ssh-keyscan (external binary) are mocked.

vi.mock("./providers/digitalocean.js", () => ({
  createDigitalOceanAdapter: () => shared.mockAdapter,
}));

vi.mock("./ssh-keyscan.js", () => ({
  collectHostKey: () => Promise.resolve(shared.collectHostKeyResult),
}));

// Health polling: real TCP connections to local test servers.
// The only difference from the real health.ts is port redirection (port 22 requires
// root privileges). The actual TCP probe logic is identical — real net.createConnection.
vi.mock("./health.js", () => ({
  pollInstanceHealth: async (options: { ipAddress: string; signal?: AbortSignal }) => {
    const { createConnection } = await import("node:net");
    const start = Date.now();
    let attempts = 0;
    const maxAttempts = 30;
    const intervalMs = 100;

    const probe = (port: number): Promise<boolean> =>
      new Promise((resolve) => {
        if (options.signal?.aborted) { resolve(false); return; }
        const socket = createConnection({ host: "127.0.0.1", port, timeout: 2_000 });
        socket.on("connect", () => { socket.destroy(); resolve(true); });
        socket.on("error", () => { socket.destroy(); resolve(false); });
        socket.on("timeout", () => { socket.destroy(); resolve(false); });
      });

    while (attempts < maxAttempts) {
      if (options.signal?.aborted) {
        return { healthy: false, attempts, elapsedMs: Date.now() - start, error: "Aborted" };
      }
      attempts++;

      // Real TCP probe to SSH test server (redirected from port 22)
      const sshUp = await probe(shared.sshPort);
      if (!sshUp) {
        await new Promise<void>((r) => setTimeout(r, intervalMs));
        continue;
      }

      // Real TCP probe to dashboard test server (redirected from port 3737)
      const dashUp = await probe(shared.dashPort);
      if (dashUp) {
        return { healthy: true, attempts, elapsedMs: Date.now() - start };
      }

      if (attempts > 15) {
        return {
          healthy: false,
          attempts,
          elapsedMs: Date.now() - start,
          error: "Agent did not become reachable on dashboard port within the expected window.",
        };
      }

      await new Promise<void>((r) => setTimeout(r, intervalMs));
    }

    return { healthy: false, attempts, elapsedMs: Date.now() - start, error: "Timed out" };
  },
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

let testDir: string;

function writeRealCredentials(deployDir: string): void {
  const cloudDir = join(deployDir, "cloud");
  if (!existsSync(cloudDir)) {
    mkdirSync(cloudDir, { recursive: true });
  }
  writeFileSync(
    join(cloudDir, "credentials.json"),
    JSON.stringify({
      version: 1,
      providers: {
        digitalocean: {
          token: "integration-test-token",
          storedAt: new Date().toISOString(),
        },
      },
    }),
  );
}

function makeAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    provider: "digitalocean",
    createVm: vi.fn().mockResolvedValue({
      success: true,
      providerInstanceId: "do-vm-integration-1",
      ipAddress: "127.0.0.1",
    }),
    destroyVm: vi.fn().mockResolvedValue({ success: true, destroyed: true }),
    getVmStatus: vi.fn().mockResolvedValue({ state: "active", ipAddress: "127.0.0.1", monthlyCost: 24 }),
    validateToken: vi.fn().mockResolvedValue({ valid: true }),
    addSshKey: vi.fn().mockResolvedValue({ success: true }),
    listSshKeys: vi.fn().mockResolvedValue([]),
    createFirewall: vi.fn().mockResolvedValue({ success: true, firewallId: "fw-integration-1" }),
    createSnapshot: vi.fn().mockResolvedValue({ success: true }),
    createVmFromSnapshot: vi.fn().mockResolvedValue({ success: true }),
    verifyDestroyed: vi.fn().mockResolvedValue(true),
    getMonthlyCost: vi.fn().mockReturnValue(24),
    ...overrides,
  };
}

function opts(overrides: Partial<ProvisionOptions> = {}): ProvisionOptions {
  return {
    provider: "digitalocean",
    deployDir: testDir,
    name: "integration-agent",
    region: "nyc3",
    size: "s-2vcpu-4gb",
    ...overrides,
  };
}

function readRegistryFile(deployDir: string): { version: number; instances: unknown[] } {
  const path = join(deployDir, "cloud", "instances.json");
  if (!existsSync(path)) return { version: 1, instances: [] };
  return JSON.parse(readFileSync(path, "utf-8"));
}

function startTcpServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => socket.end());
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve({ server, port: addr.port });
      } else {
        reject(new Error("Failed to get server address"));
      }
    });
  });
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "engine-integration-"));
  shared.collectHostKeyResult = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIntegrationTestKey";
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ── Test Suite: Full State Machine ──────────────────────────────────────────

describe("integration: full provisioning state machine", () => {
  let sshServer: Server;
  let dashServer: Server;

  beforeAll(async () => {
    const ssh = await startTcpServer();
    const dash = await startTcpServer();
    sshServer = ssh.server;
    dashServer = dash.server;
    shared.sshPort = ssh.port;
    shared.dashPort = dash.port;
  });

  afterAll(() => {
    sshServer?.close();
    dashServer?.close();
  });

  it("provision → health check → register → status query → destroy → verify cleanup", async () => {
    // Arrange: real credentials on filesystem, mock adapter
    writeRealCredentials(testDir);
    shared.mockAdapter = makeAdapter();

    const progressSteps: Array<{ step: string; status: string }> = [];
    const { provision, destroyInstance, getInstanceStatus } = await import("./engine.js");

    // ── Step 1: Provision ──
    const result = await provision(opts({
      onProgress: (p) => progressSteps.push({ step: p.step, status: p.status }),
    }));

    expect(result.success).toBe(true);
    expect(result.instanceId).toBeDefined();
    expect(result.ipAddress).toBe("127.0.0.1");
    expect(result.healthy).toBe(true);
    expect(result.monthlyCost).toBe(24);

    // ── Step 2: Verify registry state by reading actual instances.json ──
    const registry = readRegistryFile(testDir);
    expect(registry.instances).toHaveLength(1);

    const instance = registry.instances[0] as Record<string, unknown>;
    expect(instance.id).toBe(result.instanceId);
    expect(instance.name).toBe("integration-agent");
    expect(instance.provider).toBe("digitalocean");
    expect(instance.providerInstanceId).toBe("do-vm-integration-1");
    expect(instance.ipAddress).toBe("127.0.0.1");
    expect(instance.status).toBe("active");
    expect(instance.sshHostKey).toBe("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIntegrationTestKey");
    expect(instance.sshKeyPath).toMatch(/\.pem$/);
    expect(instance.createdAt).toBeDefined();
    expect(instance.updatedAt).toBeDefined();

    // Verify SSH private key file actually exists on filesystem
    expect(existsSync(instance.sshKeyPath as string)).toBe(true);

    // ── Step 3: Query status ──
    const status = await getInstanceStatus({
      deployDir: testDir,
      instanceId: result.instanceId!,
    });
    expect(status.state).toBe("active");
    expect(status.monthlyCost).toBe(24);

    // ── Step 4: Destroy ──
    const destroyResult = await destroyInstance({
      deployDir: testDir,
      instanceId: result.instanceId!,
    });
    expect(destroyResult.success).toBe(true);
    expect(destroyResult.destroyed).toBe(true);

    // ── Step 5: Verify cleanup ──
    // Registry should be empty
    const postDestroyRegistry = readRegistryFile(testDir);
    expect(postDestroyRegistry.instances).toHaveLength(0);

    // SSH key file should be deleted
    expect(existsSync(instance.sshKeyPath as string)).toBe(false);

    // Progress callback should have reported all steps
    const stepNames = progressSteps.map((s) => s.step);
    expect(stepNames).toContain("credentials");
    expect(stepNames).toContain("create-vm");
    expect(stepNames).toContain("firewall");
    expect(stepNames).toContain("health-check");
    expect(stepNames).toContain("registry");
  });

  it("provisions with correct credentials read from filesystem", async () => {
    writeRealCredentials(testDir);
    shared.mockAdapter = makeAdapter();

    const { provision } = await import("./engine.js");
    const result = await provision(opts());

    expect(result.success).toBe(true);

    // Verify the adapter was called (credentials were resolved from filesystem)
    expect((shared.mockAdapter!.createVm as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });
});

// ── Test Suite: Error Paths ─────────────────────────────────────────────────

describe("integration: provision succeeds but health fails", () => {
  let sshServer: Server;
  // No dashboard server — health check will fail (dashboard unreachable)

  beforeAll(async () => {
    const ssh = await startTcpServer();
    sshServer = ssh.server;
    shared.sshPort = ssh.port;
    // Set dashboard port to a port with nothing listening
    shared.dashPort = ssh.port + 9999; // almost certainly nothing there
  });

  afterAll(() => {
    sshServer?.close();
  });

  it("marks instance as unhealthy when dashboard is unreachable", async () => {
    writeRealCredentials(testDir);
    shared.mockAdapter = makeAdapter();

    const { provision } = await import("./engine.js");
    const result = await provision(opts());

    // Provisioning still succeeds (VM was created) but health failed
    expect(result.success).toBe(true);
    expect(result.healthy).toBe(false);
    expect(result.instanceId).toBeDefined();

    // Verify registry: instance should be marked "unhealthy"
    const registry = readRegistryFile(testDir);
    expect(registry.instances).toHaveLength(1);

    const instance = registry.instances[0] as Record<string, unknown>;
    expect(instance.status).toBe("unhealthy");

    // SSH host key should NOT be stored when health check fails
    expect(instance.sshHostKey).toBeUndefined();
  });
});

describe("integration: destroy failure", () => {
  let sshServer: Server;
  let dashServer: Server;

  beforeAll(async () => {
    const ssh = await startTcpServer();
    const dash = await startTcpServer();
    sshServer = ssh.server;
    dashServer = dash.server;
    shared.sshPort = ssh.port;
    shared.dashPort = dash.port;
  });

  afterAll(() => {
    sshServer?.close();
    dashServer?.close();
  });

  it("marks instance as error when provider destroy fails", async () => {
    writeRealCredentials(testDir);
    shared.mockAdapter = makeAdapter();

    const { provision, destroyInstance } = await import("./engine.js");

    // First, provision successfully
    const provisionResult = await provision(opts());
    expect(provisionResult.success).toBe(true);

    // Now make destroy fail
    shared.mockAdapter = makeAdapter({
      destroyVm: vi.fn().mockResolvedValue({
        success: false,
        destroyed: false,
        error: "Provider API timeout",
      }),
    });

    const destroyResult = await destroyInstance({
      deployDir: testDir,
      instanceId: provisionResult.instanceId!,
    });

    expect(destroyResult.success).toBe(false);
    expect(destroyResult.error).toContain("Provider API timeout");

    // Verify registry: instance should be marked "error"
    const registry = readRegistryFile(testDir);
    expect(registry.instances).toHaveLength(1);

    const instance = registry.instances[0] as Record<string, unknown>;
    expect(instance.status).toBe("error");
  });
});

describe("integration: registry write failure", () => {
  let sshServer: Server;
  let dashServer: Server;

  beforeAll(async () => {
    const ssh = await startTcpServer();
    const dash = await startTcpServer();
    sshServer = ssh.server;
    dashServer = dash.server;
    shared.sshPort = ssh.port;
    shared.dashPort = dash.port;
  });

  afterAll(() => {
    sshServer?.close();
    dashServer?.close();
  });

  it("returns provider instance ID for manual cleanup when registry write fails", async () => {
    writeRealCredentials(testDir);
    shared.mockAdapter = makeAdapter();

    // Make the cloud directory read-only so registry write fails.
    // Use 0o555 (r-x) so existing files (credentials.json) can still be read,
    // but no new files (instances.json temp files) can be created.
    const cloudDir = join(testDir, "cloud");
    chmodSync(cloudDir, 0o555);

    const { provision } = await import("./engine.js");
    const result = await provision(opts());

    // Restore permissions for cleanup
    chmodSync(cloudDir, 0o755);

    expect(result.success).toBe(false);
    expect(result.error).toContain("do-vm-integration-1");
    expect(result.error).toContain("Provider instance ID");
    expect(result.error).toContain(".pem");
  });
});
