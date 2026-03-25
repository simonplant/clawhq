import EventEmitter from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { pollInstanceHealth } from "./health.js";

// ── Mock node:net ────────────────────────────────────────────────────────────

/** Port → boolean map controlling which ports appear reachable. */
let portMap: Record<number, boolean> = {};

vi.mock("node:net", () => ({
  createConnection: (opts: { port: number }) => {
    const emitter = new EventEmitter();
    // Stub destroy so cleanup() doesn't throw
    (emitter as any).destroy = () => {};

    const reachable = portMap[opts.port] ?? false;
    // Emit asynchronously so the caller can attach listeners first
    setTimeout(() => {
      if (reachable) {
        emitter.emit("connect");
      } else {
        emitter.emit("error", new Error("ECONNREFUSED"));
      }
    }, 0);

    return emitter;
  },
}));

afterEach(() => {
  portMap = {};
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("pollInstanceHealth", () => {
  it("returns healthy:true when SSH (22) and dashboard (3737) are both reachable", async () => {
    portMap = { 22: true, 3737: true };

    const result = await pollInstanceHealth({
      ipAddress: "10.0.0.1",
      timeoutMs: 5_000,
      intervalMs: 10,
    });

    expect(result.healthy).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.attempts).toBeGreaterThanOrEqual(1);
  });

  it("returns healthy:false with SSH hint when SSH is open but port 3737 never opens after timeout", async () => {
    portMap = { 22: true, 3737: false };

    const result = await pollInstanceHealth({
      ipAddress: "10.0.0.1",
      timeoutMs: 30_000, // long enough so we hit 19 attempts before overall timeout
      intervalMs: 10,
    });

    expect(result.healthy).toBe(false);
    expect(result.attempts).toBeGreaterThan(18);
    expect(result.error).toContain("Agent did not become reachable on port 3737");
    expect(result.error).toContain("clawhq deploy update");
    expect(result.error).toContain("journalctl -u cloud-init");
  });

  it("returns healthy:false when neither SSH nor dashboard is reachable", async () => {
    portMap = { 22: false, 3737: false };

    const result = await pollInstanceHealth({
      ipAddress: "10.0.0.1",
      timeoutMs: 500,
      intervalMs: 10,
    });

    expect(result.healthy).toBe(false);
    expect(result.error).toContain("did not become healthy");
    expect(result.attempts).toBeGreaterThan(0);
  });

  it("returns healthy:false immediately when aborted", async () => {
    portMap = { 22: false, 3737: false };
    const controller = new AbortController();
    controller.abort();

    const result = await pollInstanceHealth({
      ipAddress: "10.0.0.1",
      timeoutMs: 10_000,
      intervalMs: 10,
      signal: controller.signal,
    });

    expect(result.healthy).toBe(false);
    expect(result.error).toBe("Health polling aborted");
  });
});
