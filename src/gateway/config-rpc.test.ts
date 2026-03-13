import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigRpcClient, SlidingWindowRateLimiter } from "./config-rpc.js";
import { RateLimitError } from "./websocket.js";
import type { GatewayClient, RpcResponse } from "./websocket.js";

// --- Mock GatewayClient ---

function createMockGateway(options: {
  connected?: boolean;
  callResponse?: RpcResponse;
} = {}): GatewayClient {
  return {
    get connected() {
      return options.connected ?? false;
    },
    call: vi.fn().mockResolvedValue(
      options.callResponse ?? { id: "rpc-1", result: { ok: true } },
    ),
  } as unknown as GatewayClient;
}

// --- SlidingWindowRateLimiter ---

describe("SlidingWindowRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the limit", () => {
    const limiter = new SlidingWindowRateLimiter(3, 60_000);

    expect(limiter.canProceed()).toBe(true);
    limiter.record();
    expect(limiter.canProceed()).toBe(true);
    limiter.record();
    expect(limiter.canProceed()).toBe(true);
    limiter.record();
    expect(limiter.canProceed()).toBe(false);
  });

  it("allows requests after window expires", () => {
    const limiter = new SlidingWindowRateLimiter(3, 60_000);

    limiter.record();
    limiter.record();
    limiter.record();
    expect(limiter.canProceed()).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(61_000);
    expect(limiter.canProceed()).toBe(true);
  });

  it("reports correct retryAfterMs", () => {
    const limiter = new SlidingWindowRateLimiter(3, 60_000);

    expect(limiter.retryAfterMs()).toBe(0);

    limiter.record();
    limiter.record();
    limiter.record();

    const retryAfter = limiter.retryAfterMs();
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60_000);
  });

  it("uses sliding window — oldest request falls off", () => {
    const limiter = new SlidingWindowRateLimiter(3, 60_000);

    limiter.record(); // t=0
    vi.advanceTimersByTime(20_000);
    limiter.record(); // t=20s
    vi.advanceTimersByTime(20_000);
    limiter.record(); // t=40s

    expect(limiter.canProceed()).toBe(false);

    // Advance to t=61s — first request (t=0) falls out of the window
    vi.advanceTimersByTime(21_000);
    expect(limiter.canProceed()).toBe(true);
  });
});

// --- ConfigRpcClient ---

describe("ConfigRpcClient", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "clawhq-config-rpc-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  describe("patch via RPC", () => {
    it("sends config.patch through Gateway when connected", async () => {
      const gateway = createMockGateway({ connected: true });
      const client = new ConfigRpcClient(gateway, {
        configPath: join(tmpDir, "openclaw.json"),
      });

      const result = await client.patch({ gateway: { port: 9999 } });

      expect(result.method).toBe("rpc");
      expect(gateway.call).toHaveBeenCalledWith(
        "config.patch",
        { patch: { gateway: { port: 9999 } } },
        expect.objectContaining({}),
      );
    });

    it("returns RPC response", async () => {
      const response: RpcResponse = { id: "rpc-1", result: { applied: true } };
      const gateway = createMockGateway({ connected: true, callResponse: response });
      const client = new ConfigRpcClient(gateway, {
        configPath: join(tmpDir, "openclaw.json"),
      });

      const result = await client.patch({ port: 8080 });

      expect(result.response).toEqual(response);
    });

    it("throws RateLimitError when rate limit exceeded", async () => {
      const gateway = createMockGateway({ connected: true });
      const client = new ConfigRpcClient(gateway, {
        configPath: join(tmpDir, "openclaw.json"),
        maxRequests: 2,
        windowMs: 60_000,
      });

      await client.patch({ a: 1 });
      await client.patch({ b: 2 });

      await expect(client.patch({ c: 3 })).rejects.toThrow(RateLimitError);
    });
  });

  describe("apply via RPC", () => {
    it("sends config.apply through Gateway when connected", async () => {
      const gateway = createMockGateway({ connected: true });
      const client = new ConfigRpcClient(gateway, {
        configPath: join(tmpDir, "openclaw.json"),
      });

      const fullConfig = { gateway: { port: 18789 }, tools: { profile: "coding" } };
      const result = await client.apply(fullConfig);

      expect(result.method).toBe("rpc");
      expect(gateway.call).toHaveBeenCalledWith(
        "config.apply",
        { config: fullConfig },
        expect.objectContaining({}),
      );
    });
  });

  describe("filesystem fallback", () => {
    it("falls back to filesystem write when Gateway is disconnected", async () => {
      const configPath = join(tmpDir, "openclaw.json");
      await writeFile(configPath, JSON.stringify({ existing: true }), "utf-8");

      const gateway = createMockGateway({ connected: false });
      const client = new ConfigRpcClient(gateway, { configPath });

      const result = await client.patch({ newKey: "newValue" });

      expect(result.method).toBe("filesystem");
      expect(gateway.call).not.toHaveBeenCalled();

      const written = JSON.parse(await readFile(configPath, "utf-8")) as Record<string, unknown>;
      expect(written.existing).toBe(true);
      expect(written.newKey).toBe("newValue");
    });

    it("creates config file if it doesn't exist on patch", async () => {
      const configPath = join(tmpDir, "new-config.json");
      const gateway = createMockGateway({ connected: false });
      const client = new ConfigRpcClient(gateway, { configPath });

      await client.patch({ key: "value" });

      const written = JSON.parse(await readFile(configPath, "utf-8")) as Record<string, unknown>;
      expect(written.key).toBe("value");
    });

    it("writes full config on apply fallback", async () => {
      const configPath = join(tmpDir, "openclaw.json");
      const gateway = createMockGateway({ connected: false });
      const client = new ConfigRpcClient(gateway, { configPath });

      const fullConfig = { gateway: { port: 18789 } };
      const result = await client.apply(fullConfig);

      expect(result.method).toBe("filesystem");
      const written = JSON.parse(await readFile(configPath, "utf-8")) as Record<string, unknown>;
      expect(written).toEqual(fullConfig);
    });

    it("preserves existing keys during patch", async () => {
      const configPath = join(tmpDir, "openclaw.json");
      await writeFile(
        configPath,
        JSON.stringify({ a: 1, b: 2, c: 3 }),
        "utf-8",
      );

      const gateway = createMockGateway({ connected: false });
      const client = new ConfigRpcClient(gateway, { configPath });

      await client.patch({ b: 99 });

      const written = JSON.parse(await readFile(configPath, "utf-8")) as Record<string, unknown>;
      expect(written).toEqual({ a: 1, b: 99, c: 3 });
    });
  });

  describe("AbortSignal", () => {
    it("respects AbortSignal on patch", async () => {
      const gateway = createMockGateway({ connected: true });
      const client = new ConfigRpcClient(gateway, {
        configPath: join(tmpDir, "openclaw.json"),
      });

      const controller = new AbortController();
      controller.abort();

      await expect(
        client.patch({ key: "value" }, { signal: controller.signal }),
      ).rejects.toThrow();
    });

    it("respects AbortSignal on apply", async () => {
      const gateway = createMockGateway({ connected: true });
      const client = new ConfigRpcClient(gateway, {
        configPath: join(tmpDir, "openclaw.json"),
      });

      const controller = new AbortController();
      controller.abort();

      await expect(
        client.apply({ key: "value" }, { signal: controller.signal }),
      ).rejects.toThrow();
    });
  });
});
