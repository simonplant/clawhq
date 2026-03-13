import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkHealth, HealthPollTimeout, pollGatewayHealth } from "./health.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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

describe("checkHealth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 'up' when healthz responds 200", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
    });

    const result = await checkHealth();

    expect(result.status).toBe("up");
    expect(result.statusCode).toBe(200);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:18789/healthz",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns 'degraded' when healthz responds non-200", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    const result = await checkHealth();

    expect(result.status).toBe("degraded");
    expect(result.statusCode).toBe(503);
  });

  it("returns 'down' when fetch fails (connection refused)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("fetch failed"));

    const result = await checkHealth();

    expect(result.status).toBe("down");
    expect(result.error).toBe("fetch failed");
  });

  it("uses custom host and port", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await checkHealth({ host: "192.168.1.10", port: 9999 });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://192.168.1.10:9999/healthz",
      expect.any(Object),
    );
  });

  it("passes AbortSignal to fetch", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    const controller = new AbortController();

    await checkHealth({ signal: controller.signal });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("rethrows AbortError", async () => {
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";
    mockFetch.mockRejectedValueOnce(abortError);

    const err = await captureRejection(checkHealth());
    expect((err as Error).message).toBe("Aborted");
  });
});

describe("pollGatewayHealth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns immediately when gateway is up", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    const result = await pollGatewayHealth({ timeoutMs: 5000, intervalMs: 100 });

    expect(result.status).toBe("up");
  });

  it("polls until gateway becomes available", async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount >= 3) {
        return Promise.resolve({ ok: true, status: 200 });
      }
      return Promise.reject(new Error("Connection refused"));
    });

    const pollPromise = pollGatewayHealth({ timeoutMs: 5000, intervalMs: 100 });

    await vi.advanceTimersByTimeAsync(250);

    const result = await pollPromise;
    expect(result.status).toBe("up");
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("throws HealthPollTimeout when timeout expires", async () => {
    mockFetch.mockRejectedValue(new Error("Connection refused"));

    const errPromise = captureRejection(
      pollGatewayHealth({ timeoutMs: 300, intervalMs: 100 }),
    );
    await vi.advanceTimersByTimeAsync(500);

    const err = await errPromise;
    expect(err).toBeInstanceOf(HealthPollTimeout);
  });

  it("includes last status in timeout error", async () => {
    mockFetch.mockRejectedValue(new Error("Connection refused"));

    const errPromise = captureRejection(
      pollGatewayHealth({ timeoutMs: 300, intervalMs: 100 }),
    );
    await vi.advanceTimersByTimeAsync(500);

    const err = await errPromise;
    expect(err).toBeInstanceOf(HealthPollTimeout);
    const timeout = err as HealthPollTimeout;
    expect(timeout.lastStatus).toBe("down");
    expect(timeout.timeoutMs).toBe(300);
  });

  it("respects AbortSignal", async () => {
    mockFetch.mockRejectedValue(new Error("Connection refused"));
    const controller = new AbortController();

    // Pre-abort the signal before starting the poll
    controller.abort();

    const err = await captureRejection(
      pollGatewayHealth({
        timeoutMs: 10000,
        intervalMs: 100,
        signal: controller.signal,
      }),
    );
    expect(err).toBeDefined();
  });
});
