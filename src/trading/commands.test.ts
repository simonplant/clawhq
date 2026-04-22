import { describe, expect, it, vi } from "vitest";

import {
  dispatchCommand,
  parseCommand,
  renderHelp,
  renderPlan,
  renderPositions,
  renderStatus,
  type CommandContext,
  type SystemSnapshot,
} from "./commands.js";
import type { OrderBlock } from "./types.js";

function mkOrder(overrides: Partial<OrderBlock> = {}): OrderBlock {
  return {
    id: "mancini-ES-1",
    sequence: 1,
    source: "mancini",
    accounts: ["tos"],
    ticker: "ES",
    execAs: "/MES",
    direction: "LONG",
    setup: "FB",
    why: "",
    entry: 7090,
    entryOrderType: "LMT",
    stop: 7078,
    stopSource: "",
    t1: 7105,
    t1Source: "",
    t2: 7120,
    t2Source: "",
    runner: "",
    riskPerShare: 12,
    quantity: 2,
    totalRisk: 120,
    confirmation: "CONFIRMED",
    conviction: "HIGH",
    confluence: "none",
    caveat: "none",
    kills: [],
    activation: "immediate",
    verify: "none",
    status: "ACTIVE",
    ...overrides,
  };
}

function mkSnapshot(overrides: Partial<SystemSnapshot> = {}): SystemSnapshot {
  return {
    planLoaded: true,
    planPath: "/tmp/today.md",
    orders: [],
    lastPollMs: 0,
    lastAlertMs: null,
    alertsToday: 0,
    tradierPnl: 0,
    tradierPositions: [],
    manualHalt: false,
    nextHeartbeatMs: null,
    symbolCount: 0,
    ...overrides,
  };
}

describe("parseCommand", () => {
  it("recognizes direct verbs", () => {
    expect(parseCommand("status")?.command).toBe("status");
    expect(parseCommand("plan")?.command).toBe("plan");
    expect(parseCommand("positions")?.command).toBe("positions");
    expect(parseCommand("halt")?.command).toBe("halt");
    expect(parseCommand("resume")?.command).toBe("resume");
    expect(parseCommand("help")?.command).toBe("help");
    expect(parseCommand("?")?.command).toBe("help");
  });

  it("accepts aliases", () => {
    expect(parseCommand("state")?.command).toBe("status");
    expect(parseCommand("orders")?.command).toBe("plan");
    expect(parseCommand("pos")?.command).toBe("positions");
    expect(parseCommand("pause")?.command).toBe("halt");
    expect(parseCommand("go")?.command).toBe("resume");
  });

  it("is case-insensitive and tolerates whitespace", () => {
    expect(parseCommand("  STATUS  ")?.command).toBe("status");
    expect(parseCommand("Plan")?.command).toBe("plan");
  });

  it("returns the rest as args", () => {
    expect(parseCommand("halt market is weird")?.args).toBe("market is weird");
    expect(parseCommand("status")?.args).toBe("");
  });

  it("refuses reply-shaped inputs", () => {
    expect(parseCommand("YES-A7F3")).toBeNull();
    expect(parseCommand("HALF A7F3")).toBeNull();
  });

  it("returns null for unknown verbs", () => {
    expect(parseCommand("execute")).toBeNull();
    expect(parseCommand("")).toBeNull();
    expect(parseCommand("hello there")).toBeNull();
  });
});

describe("renderStatus", () => {
  it("shows never-polled state before first poll", () => {
    const out = renderStatus(
      mkSnapshot({ planLoaded: false, lastPollMs: null }),
      new Date(0),
    );
    expect(out).toMatch(/NOT LOADED/);
    expect(out).toMatch(/poll: never/);
  });

  it("shows MANUAL HALT banner when halted", () => {
    const out = renderStatus(mkSnapshot({ manualHalt: true }), new Date(0));
    expect(out).toMatch(/MANUAL HALT/);
  });

  it("includes next heartbeat countdown when known", () => {
    const now = new Date();
    const out = renderStatus(
      mkSnapshot({ nextHeartbeatMs: now.getTime() + 90_000 }),
      now,
    );
    expect(out).toMatch(/next heartbeat in 1m 30s/);
  });
});

describe("renderPlan", () => {
  it("reports not-loaded clearly", () => {
    expect(renderPlan(mkSnapshot({ planLoaded: false }))).toMatch(/NOT LOADED/);
  });

  it("reports empty-orders clearly", () => {
    const out = renderPlan(mkSnapshot({ orders: [] }));
    expect(out).toMatch(/no ORDER blocks/);
  });

  it("renders one line per order", () => {
    const out = renderPlan(mkSnapshot({ orders: [mkOrder()] }));
    expect(out).toMatch(/#1 mancini ES LONG/);
  });
});

describe("renderPositions", () => {
  it("annotates the TOS/IRA invisibility", () => {
    const out = renderPositions(mkSnapshot());
    expect(out).toMatch(/TOS \+ IRA positions not visible via API/);
  });

  it("lists Tradier positions when present", () => {
    const out = renderPositions(
      mkSnapshot({
        tradierPositions: [{ symbol: "AAPL", qty: 10, avgPrice: 170 }],
      }),
    );
    expect(out).toMatch(/AAPL\s+10/);
  });
});

describe("dispatchCommand", () => {
  function makeCtx(snap: SystemSnapshot, now = new Date()): CommandContext & { halts: number; resumes: number } {
    let halts = 0;
    let resumes = 0;
    return {
      now: () => now,
      snapshot: () => snap,
      emitManualHalt: vi.fn(() => {
        halts++;
      }) as unknown as (reason: string) => void,
      clearManualHalt: vi.fn(() => {
        resumes++;
      }) as unknown as () => void,
      get halts() {
        return halts;
      },
      get resumes() {
        return resumes;
      },
    };
  }

  it("fires emitManualHalt on halt and includes reason", () => {
    const ctx = makeCtx(mkSnapshot());
    const out = dispatchCommand(
      { command: "halt", args: "lunch break" },
      ctx,
    );
    expect(ctx.emitManualHalt).toHaveBeenCalledWith("lunch break");
    expect(out).toMatch(/Halt entered/);
  });

  it("fires clearManualHalt on resume", () => {
    const ctx = makeCtx(mkSnapshot({ manualHalt: true }));
    const out = dispatchCommand({ command: "resume", args: "" }, ctx);
    expect(ctx.clearManualHalt).toHaveBeenCalled();
    expect(out).toMatch(/Halt cleared/);
  });

  it("returns help on help command", () => {
    const ctx = makeCtx(mkSnapshot());
    const out = dispatchCommand({ command: "help", args: "" }, ctx);
    expect(out).toBe(renderHelp());
  });
});
