import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AuthError,
  ConnectionError,
  GatewayClient,
  RateLimitError,
  RpcTimeoutError,
} from "./websocket.js";
import type { RpcRequest, WebSocketLike } from "./websocket.js";

// --- Mock WebSocket ---

type WsListener = (event: Record<string, unknown>) => void;

class MockWebSocket implements WebSocketLike {
  readyState = 0; // CONNECTING
  private listeners = new Map<string, WsListener[]>();
  readonly sentMessages: string[] = [];

  /** Auto-respond to RPC calls via queueMicrotask (avoids fake timer issues). */
  autoResponder?: (request: RpcRequest) => Record<string, unknown>;

  send(data: string): void {
    this.sentMessages.push(data);

    if (this.autoResponder) {
      const request = JSON.parse(data) as RpcRequest;
      const response = this.autoResponder(request);
      queueMicrotask(() => this.emit("message", { data: JSON.stringify(response) }));
    }
  }

  close(_code?: number, _reason?: string): void {
    this.readyState = 3; // CLOSED
  }

  addEventListener(type: string, listener: WsListener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: WsListener): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((l) => l !== listener),
    );
  }

  emit(type: string, event: Record<string, unknown> = {}): void {
    const list = this.listeners.get(type) ?? [];
    for (const listener of list) {
      listener(event);
    }
  }

  simulateOpen(): void {
    this.readyState = 1; // OPEN
    this.emit("open");
  }

  simulateError(message = "Connection failed"): void {
    this.emit("error", { message });
  }

  simulateClose(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.emit("close", { code, reason });
  }

  simulateMessage(data: string): void {
    this.emit("message", { data });
  }
}

// --- Helpers ---

let lastMockWs: MockWebSocket;

function createMockFactory() {
  return (_url: string): WebSocketLike => {
    lastMockWs = new MockWebSocket();
    return lastMockWs;
  };
}

function createClient(options: { token?: string; rpcTimeoutMs?: number } = {}): GatewayClient {
  return new GatewayClient({
    host: "127.0.0.1",
    port: 18789,
    createWebSocket: createMockFactory(),
    rpcTimeoutMs: options.rpcTimeoutMs ?? 5000,
    token: options.token,
  });
}

/**
 * Capture a promise rejection without leaving it unhandled.
 * Returns a promise that resolves with the caught error.
 */
function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("Expected promise to reject");
    },
    (err: unknown) => err,
  );
}

// --- Tests ---

describe("GatewayClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("connect", () => {
    it("connects to the Gateway WebSocket", async () => {
      const client = createClient();
      const connectPromise = client.connect();

      lastMockWs.simulateOpen();
      await connectPromise;

      expect(client.connected).toBe(true);
    });

    it("is a no-op when already connected", async () => {
      const client = createClient();
      const connectPromise = client.connect();
      lastMockWs.simulateOpen();
      await connectPromise;

      await client.connect();
      expect(client.connected).toBe(true);
    });

    it("throws ConnectionError when WebSocket fails", async () => {
      const client = createClient();
      const errPromise = captureRejection(client.connect());

      lastMockWs.simulateError("Connection refused");

      const err = await errPromise;
      expect(err).toBeInstanceOf(ConnectionError);
    });

    it("authenticates with token on connect", async () => {
      lastMockWs = new MockWebSocket();
      lastMockWs.autoResponder = (req) => ({
        id: req.id,
        result: { authenticated: true },
      });

      const tokenClient = new GatewayClient({
        token: "test-token",
        createWebSocket: () => lastMockWs,
        rpcTimeoutMs: 5000,
      });

      const connectPromise = tokenClient.connect();
      lastMockWs.simulateOpen();

      await vi.advanceTimersByTimeAsync(0);
      await connectPromise;

      expect(tokenClient.connected).toBe(true);
      expect(lastMockWs.sentMessages).toHaveLength(1);
      const authMsg = JSON.parse(lastMockWs.sentMessages[0]) as RpcRequest;
      expect(authMsg.method).toBe("auth");
      expect(authMsg.params).toEqual({ token: "test-token" });
    });

    it("throws AuthError when authentication fails", async () => {
      lastMockWs = new MockWebSocket();
      lastMockWs.autoResponder = (req) => ({
        id: req.id,
        error: { code: 401, message: "Invalid token" },
      });

      const client = new GatewayClient({
        token: "bad-token",
        createWebSocket: () => lastMockWs,
        rpcTimeoutMs: 5000,
      });

      const errPromise = captureRejection(client.connect());
      lastMockWs.simulateOpen();

      await vi.advanceTimersByTimeAsync(0);

      const err = await errPromise;
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).message).toBe("Invalid token");
      expect(client.connected).toBe(false);
    });

    it("respects AbortSignal during connect", async () => {
      const client = createClient();
      const controller = new AbortController();

      const errPromise = captureRejection(client.connect({ signal: controller.signal }));
      controller.abort();

      const err = await errPromise;
      expect(err).toBeDefined();
    });
  });

  describe("call", () => {
    it("sends RPC request and receives response", async () => {
      const client = createClient();
      const connectPromise = client.connect();
      lastMockWs.simulateOpen();
      await connectPromise;

      const callPromise = client.call("config.get");

      const sent = JSON.parse(lastMockWs.sentMessages[0]) as RpcRequest;
      expect(sent.method).toBe("config.get");

      lastMockWs.simulateMessage(
        JSON.stringify({ id: sent.id, result: { port: 18789 } }),
      );

      const response = await callPromise;
      expect(response.result).toEqual({ port: 18789 });
      expect(response.error).toBeUndefined();
    });

    it("sends params in RPC request", async () => {
      const client = createClient();
      const connectPromise = client.connect();
      lastMockWs.simulateOpen();
      await connectPromise;

      const callPromise = client.call("config.patch", { patch: { port: 8080 } });

      const sent = JSON.parse(lastMockWs.sentMessages[0]) as RpcRequest;
      expect(sent.params).toEqual({ patch: { port: 8080 } });

      lastMockWs.simulateMessage(
        JSON.stringify({ id: sent.id, result: { ok: true } }),
      );

      const response = await callPromise;
      expect(response.result).toEqual({ ok: true });
    });

    it("returns error responses without throwing", async () => {
      const client = createClient();
      const connectPromise = client.connect();
      lastMockWs.simulateOpen();
      await connectPromise;

      const callPromise = client.call("config.patch", { patch: {} });
      const sent = JSON.parse(lastMockWs.sentMessages[0]) as RpcRequest;

      lastMockWs.simulateMessage(
        JSON.stringify({
          id: sent.id,
          error: { code: 400, message: "Invalid patch" },
        }),
      );

      const response = await callPromise;
      expect(response.error).toEqual({ code: 400, message: "Invalid patch" });
    });

    it("throws RpcTimeoutError when response is not received", async () => {
      const client = createClient({ rpcTimeoutMs: 100 });
      const connectPromise = client.connect();
      lastMockWs.simulateOpen();
      await connectPromise;

      const errPromise = captureRejection(client.call("config.get"));
      await vi.advanceTimersByTimeAsync(150);

      const err = await errPromise;
      expect(err).toBeInstanceOf(RpcTimeoutError);
      expect((err as RpcTimeoutError).method).toBe("config.get");
      expect((err as RpcTimeoutError).timeoutMs).toBe(100);
    });

    it("throws ConnectionError when not connected", async () => {
      const client = createClient();
      const err = await captureRejection(client.call("config.get"));
      expect(err).toBeInstanceOf(ConnectionError);
    });

    it("generates unique message IDs", async () => {
      const client = createClient();
      const connectPromise = client.connect();
      lastMockWs.simulateOpen();
      await connectPromise;

      lastMockWs.autoResponder = (req) => ({ id: req.id, result: {} });

      const p1 = client.call("method1");
      await vi.advanceTimersByTimeAsync(0);
      const p2 = client.call("method2");
      await vi.advanceTimersByTimeAsync(0);

      await Promise.all([p1, p2]);

      const ids = lastMockWs.sentMessages.map((m) => (JSON.parse(m) as RpcRequest).id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("respects AbortSignal for individual calls", async () => {
      const client = createClient();
      const connectPromise = client.connect();
      lastMockWs.simulateOpen();
      await connectPromise;

      const controller = new AbortController();
      const errPromise = captureRejection(
        client.call("config.get", undefined, { signal: controller.signal }),
      );

      controller.abort();

      const err = await errPromise;
      expect(err).toBeDefined();
    });

    it("allows custom timeout per call", async () => {
      const client = createClient({ rpcTimeoutMs: 10000 });
      const connectPromise = client.connect();
      lastMockWs.simulateOpen();
      await connectPromise;

      const errPromise = captureRejection(
        client.call("slow.method", undefined, { timeoutMs: 50 }),
      );
      await vi.advanceTimersByTimeAsync(100);

      const err = await errPromise;
      expect(err).toBeInstanceOf(RpcTimeoutError);
      expect((err as RpcTimeoutError).method).toBe("slow.method");
    });
  });

  describe("disconnect", () => {
    it("closes the WebSocket connection", async () => {
      const client = createClient();
      const connectPromise = client.connect();
      lastMockWs.simulateOpen();
      await connectPromise;

      expect(client.connected).toBe(true);
      client.disconnect();
      expect(client.connected).toBe(false);
    });

    it("resolves pending RPCs with error on disconnect", async () => {
      const client = createClient();
      const connectPromise = client.connect();
      lastMockWs.simulateOpen();
      await connectPromise;

      const callPromise = client.call("config.get");
      client.disconnect();

      const response = await callPromise;
      expect(response.error).toBeDefined();
      expect(response.error?.message).toBe("Client disconnected");
    });

    it("is safe to call when not connected", () => {
      const client = createClient();
      expect(() => client.disconnect()).not.toThrow();
    });
  });

  describe("connection close handling", () => {
    it("resolves pending RPCs when connection drops", async () => {
      const client = createClient();
      const connectPromise = client.connect();
      lastMockWs.simulateOpen();
      await connectPromise;

      const callPromise = client.call("config.get");
      lastMockWs.simulateClose(1006, "Connection lost");

      const response = await callPromise;
      expect(response.error).toBeDefined();
      expect(response.error?.message).toBe("Connection closed");
    });

    it("emits close event", async () => {
      const client = createClient();
      const connectPromise = client.connect();
      lastMockWs.simulateOpen();
      await connectPromise;

      const closeHandler = vi.fn();
      client.on("close", closeHandler);

      lastMockWs.simulateClose(1000, "Normal");
      expect(closeHandler).toHaveBeenCalledWith(1000, "Normal");
    });

    it("sets connected to false on close", async () => {
      const client = createClient();
      const connectPromise = client.connect();
      lastMockWs.simulateOpen();
      await connectPromise;

      expect(client.connected).toBe(true);
      lastMockWs.simulateClose();
      expect(client.connected).toBe(false);
    });
  });

  describe("message handling", () => {
    it("ignores non-JSON messages", async () => {
      const client = createClient();
      const connectPromise = client.connect();
      lastMockWs.simulateOpen();
      await connectPromise;

      lastMockWs.simulateMessage("not json");
      lastMockWs.simulateMessage("{invalid");
    });

    it("ignores messages without matching request id", async () => {
      const client = createClient();
      const connectPromise = client.connect();
      lastMockWs.simulateOpen();
      await connectPromise;

      lastMockWs.simulateMessage(JSON.stringify({ id: "unknown-id", result: {} }));
    });
  });
});

describe("RateLimitError", () => {
  it("includes retry after duration", () => {
    const err = new RateLimitError(5000);
    expect(err.retryAfterMs).toBe(5000);
    expect(err.message).toContain("5000ms");
    expect(err.name).toBe("RateLimitError");
  });
});

describe("RpcTimeoutError", () => {
  it("includes method and timeout", () => {
    const err = new RpcTimeoutError("config.patch", 10000);
    expect(err.method).toBe("config.patch");
    expect(err.timeoutMs).toBe(10000);
    expect(err.message).toContain("config.patch");
    expect(err.message).toContain("10000ms");
  });
});
