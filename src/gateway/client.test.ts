import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import { GatewayClient } from "./client.js";
import {
  AuthError,
  ConnectionError,
  GatewayError,
  RateLimitError,
  RpcTimeoutError,
} from "./errors.js";
import type { RpcRequest } from "./types.js";

// ── Test Helpers ─────────────────────────────────────────────────────────────

/** Spin up a WebSocket server that speaks our RPC protocol. */
function createTestServer(
  handler?: (req: RpcRequest, send: (data: unknown) => void) => void,
): { wss: WebSocketServer; port: number; url: string } {
  const wss = new WebSocketServer({ port: 0 });
  const port = (wss.address() as AddressInfo).port;

  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const req = JSON.parse(String(raw)) as RpcRequest;
      const send = (data: unknown) => ws.send(JSON.stringify(data));

      if (handler) {
        handler(req, send);
      } else {
        // Default: echo the method as result
        send({ id: req.id, result: { method: req.method, params: req.params } });
      }
    });
  });

  return { wss, port, url: `ws://127.0.0.1:${port}` };
}

function clientFor(port: number, overrides?: { timeoutMs?: number }): GatewayClient {
  return new GatewayClient({
    host: "127.0.0.1",
    port,
    token: "test-token",
    ...overrides,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GatewayClient", () => {
  let wss: WebSocketServer | null = null;

  afterEach(() => {
    if (wss) {
      wss.close();
      wss = null;
    }
  });

  // ── Connection ───────────────────────────────────────────────────────────

  describe("connect", () => {
    it("connects to a running Gateway", async () => {
      const server = createTestServer();
      wss = server.wss;
      const client = clientFor(server.port);

      await client.connect();
      expect(client.connected).toBe(true);
      client.close();
    });

    it("passes token as query parameter", async () => {
      let receivedUrl = "";
      const wsServer = new WebSocketServer({ port: 0 });
      wss = wsServer;
      const port = (wsServer.address() as AddressInfo).port;

      wsServer.on("connection", (_ws, req) => {
        receivedUrl = req.url ?? "";
      });

      const client = new GatewayClient({
        host: "127.0.0.1",
        port,
        token: "secret-123",
      });

      await client.connect();
      expect(receivedUrl).toContain("token=secret-123");
      client.close();
    });

    it("throws ConnectionError when Gateway is unreachable", async () => {
      const client = clientFor(19999); // nothing listening
      await expect(client.connect()).rejects.toThrow(ConnectionError);
    });

    it("is a no-op when already connected", async () => {
      const server = createTestServer();
      wss = server.wss;
      const client = clientFor(server.port);

      await client.connect();
      await client.connect(); // should not throw
      expect(client.connected).toBe(true);
      client.close();
    });

    it("supports AbortSignal cancellation", async () => {
      const ac = new AbortController();
      const client = clientFor(19999); // unreachable

      ac.abort();
      await expect(client.connect(ac.signal)).rejects.toThrow();
    });
  });

  // ── RPC Round-Trip ───────────────────────────────────────────────────────

  describe("rpc", () => {
    it("sends request and receives response", async () => {
      const server = createTestServer();
      wss = server.wss;
      const client = clientFor(server.port);

      await client.connect();
      const result = await client.rpc("status");
      expect(result).toEqual({ method: "status", params: undefined });
      client.close();
    });

    it("sends params in the request", async () => {
      const server = createTestServer();
      wss = server.wss;
      const client = clientFor(server.port);

      await client.connect();
      const result = await client.rpc("config.patch", { key: "value" });
      expect(result).toEqual({ method: "config.patch", params: { key: "value" } });
      client.close();
    });

    it("handles multiple concurrent RPC calls", async () => {
      const server = createTestServer((req, send) => {
        // Respond after a small delay to simulate async processing
        setTimeout(() => {
          send({ id: req.id, result: req.method });
        }, 10);
      });
      wss = server.wss;
      const client = clientFor(server.port);

      await client.connect();
      const [r1, r2, r3] = await Promise.all([
        client.rpc("method-a"),
        client.rpc("method-b"),
        client.rpc("method-c"),
      ]);
      expect(r1).toBe("method-a");
      expect(r2).toBe("method-b");
      expect(r3).toBe("method-c");
      client.close();
    });

    it("throws ConnectionError when not connected", async () => {
      const client = clientFor(19999);
      await expect(client.rpc("status")).rejects.toThrow(ConnectionError);
    });
  });

  // ── Timeout ──────────────────────────────────────────────────────────────

  describe("timeout", () => {
    it("throws RpcTimeoutError when Gateway does not respond", async () => {
      const server = createTestServer(() => {
        // Never respond
      });
      wss = server.wss;
      const client = clientFor(server.port, { timeoutMs: 50 });

      await client.connect();
      const err = await client.rpc("slow-method").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RpcTimeoutError);
      expect((err as RpcTimeoutError).method).toBe("slow-method");
      expect((err as RpcTimeoutError).timeoutMs).toBe(50);
      client.close();
    });

    it("allows per-call timeout override", async () => {
      const server = createTestServer(() => {
        // Never respond
      });
      wss = server.wss;
      const client = clientFor(server.port, { timeoutMs: 10_000 });

      await client.connect();
      const err = await client
        .rpc("slow", undefined, { timeoutMs: 30 })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RpcTimeoutError);
      expect((err as RpcTimeoutError).timeoutMs).toBe(30);
      client.close();
    });
  });

  // ── AbortSignal ──────────────────────────────────────────────────────────

  describe("abort signal", () => {
    it("aborts a pending RPC call", async () => {
      const server = createTestServer(() => {
        // Never respond — wait for abort
      });
      wss = server.wss;
      const client = clientFor(server.port, { timeoutMs: 10_000 });

      await client.connect();
      const ac = new AbortController();

      const promise = client.rpc("long-running", undefined, { signal: ac.signal });
      ac.abort();

      const err = await promise.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(GatewayError);
      expect((err as GatewayError).message).toContain("aborted");
      client.close();
    });

    it("rejects immediately if signal is already aborted", async () => {
      const server = createTestServer();
      wss = server.wss;
      const client = clientFor(server.port);

      await client.connect();
      const ac = new AbortController();
      ac.abort();

      await expect(
        client.rpc("method", undefined, { signal: ac.signal }),
      ).rejects.toThrow();
      client.close();
    });
  });

  // ── Typed Errors ─────────────────────────────────────────────────────────

  describe("typed errors", () => {
    it("returns AuthError for 401 responses", async () => {
      const server = createTestServer((req, send) => {
        send({ id: req.id, error: { code: 401, message: "Invalid token" } });
      });
      wss = server.wss;
      const client = clientFor(server.port);

      await client.connect();
      const err = await client.rpc("status").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).message).toBe("Invalid token");
      client.close();
    });

    it("returns RateLimitError for 429 responses", async () => {
      const server = createTestServer((req, send) => {
        send({ id: req.id, error: { code: 429, message: "Too many requests", data: 60000 } });
      });
      wss = server.wss;
      const client = clientFor(server.port);

      await client.connect();
      const err = await client.rpc("config.patch").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).retryAfterMs).toBe(60000);
      client.close();
    });

    it("returns GatewayError for other error codes", async () => {
      const server = createTestServer((req, send) => {
        send({ id: req.id, error: { code: 500, message: "Internal error" } });
      });
      wss = server.wss;
      const client = clientFor(server.port);

      await client.connect();
      const err = await client.rpc("status").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(GatewayError);
      expect((err as GatewayError).message).toBe("Internal error");
      client.close();
    });
  });

  // ── Close Behavior ───────────────────────────────────────────────────────

  describe("close", () => {
    it("sets connected to false after close", async () => {
      const server = createTestServer();
      wss = server.wss;
      const client = clientFor(server.port);

      await client.connect();
      expect(client.connected).toBe(true);
      client.close();
      expect(client.connected).toBe(false);
    });

    it("rejects pending requests when closed", async () => {
      const server = createTestServer(() => {
        // Never respond
      });
      wss = server.wss;
      const client = clientFor(server.port, { timeoutMs: 10_000 });

      await client.connect();
      const promise = client.rpc("method");
      client.close();

      const err = await promise.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConnectionError);
    });

    it("rejects pending requests when server disconnects", async () => {
      const server = createTestServer((_req, _send) => {
        // Close the server-side connection instead of responding
        for (const ws of server.wss.clients) {
          ws.close();
        }
      });
      wss = server.wss;
      const client = clientFor(server.port, { timeoutMs: 10_000 });

      await client.connect();
      const err = await client.rpc("method").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConnectionError);
    });
  });
});
