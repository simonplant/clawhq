import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./runner.js", () => ({
  runRepair: vi.fn(),
}));

import { runRepair } from "./runner.js";
import type { RepairContext, RepairReport } from "./types.js";
import { startWatcher } from "./watcher.js";

function makeCtx(overrides: Partial<RepairContext> = {}): RepairContext {
  return {
    openclawHome: "/tmp/openclaw",
    configPath: "/tmp/openclaw/openclaw.json",
    ...overrides,
  };
}

const healthyReport: RepairReport = {
  issues: [],
  actions: [],
  allHealthy: true,
};

describe("startWatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs an initial repair cycle immediately", async () => {
    vi.mocked(runRepair).mockResolvedValue(healthyReport);

    const watcher = startWatcher({
      ctx: makeCtx(),
      intervalMs: 60_000,
    });

    // Let the first cycle complete
    await vi.advanceTimersByTimeAsync(0);

    expect(runRepair).toHaveBeenCalledOnce();

    watcher.stop();
    await watcher.done;
  });

  it("calls onCycle after each repair cycle", async () => {
    vi.mocked(runRepair).mockResolvedValue(healthyReport);
    const onCycle = vi.fn();

    const watcher = startWatcher({
      ctx: makeCtx(),
      intervalMs: 1_000,
      onCycle,
    });

    // First cycle
    await vi.advanceTimersByTimeAsync(0);
    expect(onCycle).toHaveBeenCalledOnce();
    expect(onCycle).toHaveBeenCalledWith(healthyReport);

    // Advance past interval for second cycle
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onCycle).toHaveBeenCalledTimes(2);

    watcher.stop();
    await watcher.done;
  });

  it("calls onError when runRepair throws", async () => {
    vi.mocked(runRepair).mockRejectedValue(new Error("Unexpected failure"));
    const onError = vi.fn();

    const watcher = startWatcher({
      ctx: makeCtx(),
      intervalMs: 1_000,
      onError,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].message).toBe("Unexpected failure");

    watcher.stop();
    await watcher.done;
  });

  it("stops when stop() is called", async () => {
    vi.mocked(runRepair).mockResolvedValue(healthyReport);

    const watcher = startWatcher({
      ctx: makeCtx(),
      intervalMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(runRepair).toHaveBeenCalledOnce();

    watcher.stop();
    await watcher.done;

    // No more cycles should run
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runRepair).toHaveBeenCalledOnce();
  });

  it("stops when caller AbortSignal fires", async () => {
    vi.mocked(runRepair).mockResolvedValue(healthyReport);
    const ac = new AbortController();

    const watcher = startWatcher({
      ctx: makeCtx({ signal: ac.signal }),
      intervalMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(runRepair).toHaveBeenCalledOnce();

    ac.abort();
    await watcher.done;

    await vi.advanceTimersByTimeAsync(5_000);
    expect(runRepair).toHaveBeenCalledOnce();
  });

  it("stops immediately when caller signal is already aborted", async () => {
    vi.mocked(runRepair).mockResolvedValue(healthyReport);
    const ac = new AbortController();
    ac.abort();

    const watcher = startWatcher({
      ctx: makeCtx({ signal: ac.signal }),
      intervalMs: 1_000,
    });

    await watcher.done;
    expect(runRepair).not.toHaveBeenCalled();
  });

  it("runs multiple cycles on interval", async () => {
    vi.mocked(runRepair).mockResolvedValue(healthyReport);

    const watcher = startWatcher({
      ctx: makeCtx(),
      intervalMs: 500,
    });

    // First cycle runs immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(runRepair).toHaveBeenCalledTimes(1);

    // Second cycle after interval
    await vi.advanceTimersByTimeAsync(500);
    expect(runRepair).toHaveBeenCalledTimes(2);

    // Third cycle
    await vi.advanceTimersByTimeAsync(500);
    expect(runRepair).toHaveBeenCalledTimes(3);

    watcher.stop();
    await watcher.done;
  });

  it("continues running after onError", async () => {
    vi.mocked(runRepair)
      .mockRejectedValueOnce(new Error("Transient failure"))
      .mockResolvedValue(healthyReport);
    const onError = vi.fn();
    const onCycle = vi.fn();

    const watcher = startWatcher({
      ctx: makeCtx(),
      intervalMs: 500,
      onCycle,
      onError,
    });

    // First cycle: error
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledOnce();
    expect(onCycle).not.toHaveBeenCalled();

    // Second cycle: success
    await vi.advanceTimersByTimeAsync(500);
    expect(onCycle).toHaveBeenCalledOnce();

    watcher.stop();
    await watcher.done;
  });
});
