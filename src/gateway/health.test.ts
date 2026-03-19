import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";

import { HealthPoller } from "./health.js";
import type { HealthState, RpcRequest } from "./types.js";

// ── Test Helpers ─────────────────────────────────────────────────────────────

function createHealthServer(): { wss: WebSocketServer; port: number } {
  const wss = new WebSocketServer({ port: 0 });
  const port = (wss.address() as AddressInfo).port;

  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const req = JSON.parse(String(raw)) as RpcRequest;
      ws.send(JSON.stringify({ id: req.id, result: { status: "ok" } }));
    });
  });

  return { wss, port };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("HealthPoller", () => {
  let wss: WebSocketServer | null = null;

  afterEach(() => {
    if (wss) {
      wss.close();
      wss = null;
    }
  });

  it("detects Gateway up state", async () => {
    const server = createHealthServer();
    wss = server.wss;

    const transitions: Array<{ state: HealthState; previous: HealthState }> = [];
    const poller = new HealthPoller(
      { token: "test", host: "127.0.0.1", port: server.port },
      (state, previous) => transitions.push({ state, previous }),
      { intervalMs: 100_000, timeoutMs: 2_000 },
    );

    poller.start();

    // Wait for first poll
    await vi.waitFor(() => expect(transitions.length).toBeGreaterThanOrEqual(1), { timeout: 3_000 });
    poller.stop();

    expect(transitions[0]).toEqual({ state: "up", previous: "unknown" });
  });

  it("detects Gateway down state", async () => {
    const transitions: Array<{ state: HealthState; previous: HealthState }> = [];
    const poller = new HealthPoller(
      { token: "test", host: "127.0.0.1", port: 19998 }, // nothing listening
      (state, previous) => transitions.push({ state, previous }),
      { intervalMs: 100_000, timeoutMs: 500 },
    );

    poller.start();

    await vi.waitFor(() => expect(transitions.length).toBeGreaterThanOrEqual(1), { timeout: 3_000 });
    poller.stop();

    expect(transitions[0]).toEqual({ state: "down", previous: "unknown" });
  });

  it("detects transition from up to down", async () => {
    const server = createHealthServer();
    wss = server.wss;

    const transitions: Array<{ state: HealthState; previous: HealthState }> = [];
    const poller = new HealthPoller(
      { token: "test", host: "127.0.0.1", port: server.port },
      (state, previous) => transitions.push({ state, previous }),
      { intervalMs: 100, timeoutMs: 500 },
    );

    poller.start();

    // Wait for "up" detection
    await vi.waitFor(() => expect(transitions.length).toBeGreaterThanOrEqual(1), { timeout: 3_000 });
    expect(transitions[0]?.state).toBe("up");

    // Kill the server
    server.wss.close();
    wss = null;

    // Wait for "down" detection
    await vi.waitFor(() => expect(transitions.length).toBeGreaterThanOrEqual(2), { timeout: 5_000 });
    poller.stop();

    expect(transitions[1]).toEqual({ state: "down", previous: "up" });
  });

  it("stops polling via AbortSignal", async () => {
    const ac = new AbortController();
    const transitions: Array<{ state: HealthState; previous: HealthState }> = [];
    const poller = new HealthPoller(
      { token: "test", host: "127.0.0.1", port: 19998 },
      (state, previous) => transitions.push({ state, previous }),
      { intervalMs: 50, timeoutMs: 200, signal: ac.signal },
    );

    poller.start();
    await vi.waitFor(() => expect(transitions.length).toBeGreaterThanOrEqual(1), { timeout: 3_000 });

    ac.abort();

    // After abort, currentState should still be readable
    expect(poller.currentState).toBe("down");
  });

  it("starts in unknown state", () => {
    const poller = new HealthPoller(
      { token: "test", host: "127.0.0.1", port: 19998 },
      () => {},
      { intervalMs: 100_000 },
    );

    expect(poller.currentState).toBe("unknown");
  });
});
