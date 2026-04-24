import { describe, expect, it } from "vitest";

import {
  VTF_DEDUP_TTL_MS,
  classifyAction,
  formatVtfMessage,
  makeDedupKey,
  makeVtfDedup,
  matchPlanOrders,
  normalizeTicker,
  parseVtfInput,
  vtfIcon,
  vtfShouldQuiet,
} from "./vtf.js";
import type { OrderBlock } from "./types.js";

const T0 = 1_700_000_000_000;

function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    seq: 42,
    user: "Kira",
    time: "9:47am",
    ticker: "$AMD",
    action: "long 5/1 90 calls",
    capturedAt: "2026-04-23T16:47:03.123Z",
    ...overrides,
  };
}

describe("parseVtfInput", () => {
  it("parses a well-formed payload into a VtfAlert", () => {
    const res = parseVtfInput(validInput(), T0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.alert.user).toBe("Kira");
    expect(res.alert.time).toBe("9:47am");
    expect(res.alert.ticker).toBe("AMD");
    expect(res.alert.action).toBe("long 5/1 90 calls");
    expect(res.alert.actionClass).toBe("long");
    expect(res.alert.seq).toBe(42);
    expect(res.alert.receivedMs).toBe(T0);
    expect(res.alert.dedupKey).toBe("kira|9:47am|AMD|long 5/1 90 calls");
  });

  it("rejects non-object bodies", () => {
    const res = parseVtfInput("not an object", T0);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/object/);
  });

  it("rejects null body", () => {
    const res = parseVtfInput(null, T0);
    expect(res.ok).toBe(false);
  });

  it("rejects unsupported payload versions", () => {
    const res = parseVtfInput(validInput({ v: 2 }), T0);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/version/);
  });

  it.each(["user", "time", "ticker", "action", "capturedAt"])(
    "rejects missing '%s'",
    (field) => {
      const body = validInput();
      delete body[field];
      const res = parseVtfInput(body, T0);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toMatch(new RegExp(field));
    },
  );

  it.each(["user", "time", "ticker", "action", "capturedAt"])(
    "rejects empty '%s'",
    (field) => {
      const res = parseVtfInput(validInput({ [field]: "   " }), T0);
      expect(res.ok).toBe(false);
    },
  );

  it("treats missing seq as undefined, not error", () => {
    const body = validInput();
    delete body.seq;
    const res = parseVtfInput(body, T0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.alert.seq).toBeUndefined();
  });
});

describe("normalizeTicker", () => {
  it("strips $ prefix", () => {
    expect(normalizeTicker("$AMD")).toBe("AMD");
    expect(normalizeTicker("AMD")).toBe("AMD");
  });
  it("upper-cases", () => {
    expect(normalizeTicker("amd")).toBe("AMD");
    expect(normalizeTicker("$amd")).toBe("AMD");
  });
  it("trims whitespace", () => {
    expect(normalizeTicker("  $AMD  ")).toBe("AMD");
  });
});

describe("classifyAction", () => {
  const cases: Array<[string, string]> = [
    ["long 5/1 90 calls", "long"],
    ["long TSLA", "long"],
    ["buying AAPL", "long"],
    ["bought AMD", "long"],
    ["short NVDA", "short"],
    ["shorting QQQ", "short"],
    ["sold short SPY", "short"],
    ["flat", "flat"],
    ["flat AMD", "flat"],
    ["closed", "flat"],
    ["closed AAPL", "flat"],
    ["sold TSLA", "flat"],
    ["out of NVDA", "flat"],
    ["stopped", "stopped"],
    ["stopped out", "flat"], // "out" wins (flat takes priority as an exit)
    ["trimmed 1/2", "trimmed"],
    ["trimmed 1/4 AAPL", "trimmed"],
    ["trim 1/3", "trimmed"],
    ["added 1/2", "added"],
    ["added to NVDA", "added"],
    ["add AAPL", "added"],
    ["watching AMD", "other"],
    ["thoughts on SPY?", "other"],
  ];
  it.each(cases)("classifies %s → %s", (action, want) => {
    expect(classifyAction(action)).toBe(want);
  });
});

describe("makeDedupKey", () => {
  it("collapses whitespace and lowercases action", () => {
    const k1 = makeDedupKey({
      user: "Kira",
      time: "9:47am",
      ticker: "AMD",
      action: "Long  5/1  90 Calls",
    });
    const k2 = makeDedupKey({
      user: "Kira",
      time: "9:47am",
      ticker: "AMD",
      action: "long 5/1 90 calls",
    });
    expect(k1).toBe(k2);
  });
  it("preserves ticker case in the key (ticker is already normalized upstream)", () => {
    expect(
      makeDedupKey({
        user: "Kira",
        time: "9:47am",
        ticker: "AMD",
        action: "long",
      }),
    ).toContain("|AMD|");
  });
});

describe("makeVtfDedup", () => {
  it("flags repeat within TTL as duplicate", () => {
    const d = makeVtfDedup({ ttlMs: 1000 });
    expect(d.check("k1", 0)).toBe("new");
    expect(d.check("k1", 500)).toBe("duplicate");
  });
  it("allows the key again after TTL expires", () => {
    const d = makeVtfDedup({ ttlMs: 1000 });
    expect(d.check("k1", 0)).toBe("new");
    expect(d.check("k1", 1500)).toBe("new");
  });
  it("treats different keys independently", () => {
    const d = makeVtfDedup({ ttlMs: 1000 });
    expect(d.check("a", 0)).toBe("new");
    expect(d.check("b", 100)).toBe("new");
    expect(d.check("a", 200)).toBe("duplicate");
  });
  it("uses the configured default TTL when unset", () => {
    const d = makeVtfDedup();
    d.check("x", 0);
    expect(d.check("x", VTF_DEDUP_TTL_MS - 1)).toBe("duplicate");
    expect(d.check("x", VTF_DEDUP_TTL_MS + 1)).toBe("new");
  });
  it("clear() empties the dedup table", () => {
    const d = makeVtfDedup({ ttlMs: 1000 });
    d.check("x", 0);
    d.clear();
    expect(d.size()).toBe(0);
    expect(d.check("x", 0)).toBe("new");
  });
});

describe("formatVtfMessage", () => {
  function alertOf(overrides: Record<string, unknown> = {}) {
    const res = parseVtfInput(validInput(overrides), T0);
    if (!res.ok) throw new Error("bad fixture");
    return res.alert;
  }

  it("renders a compact one-liner with icon + moderator + ticker + action", () => {
    const msg = formatVtfMessage(alertOf());
    expect(msg).toMatch(/^🟢 VTF Kira — AMD long 5\/1 90 calls/);
    expect(msg).toContain("time 9:47am");
  });

  it("uses the right icon per action class", () => {
    expect(formatVtfMessage(alertOf({ action: "short NVDA" }))).toMatch(/^🔴/);
    expect(formatVtfMessage(alertOf({ action: "flat" }))).toMatch(/^⚪/);
    expect(formatVtfMessage(alertOf({ action: "trimmed 1/2" }))).toMatch(/^✂️/);
    expect(formatVtfMessage(alertOf({ action: "added 1/2" }))).toMatch(/^➕/);
    expect(formatVtfMessage(alertOf({ action: "stopped" }))).toMatch(/^🛑/);
  });

  it("annotates active ticker-scoped blackouts", () => {
    const msg = formatVtfMessage(alertOf({ ticker: "NVDA", action: "long NVDA" }), {
      activeBlackouts: [
        {
          scope: { ticker: "NVDA" },
          name: "NVDA earnings",
          reason: "AMC today",
        },
      ],
    });
    expect(msg).toMatch(/⚠ blackout: NVDA earnings/);
  });

  it("annotates 'all' scope blackouts", () => {
    const msg = formatVtfMessage(alertOf(), {
      activeBlackouts: [
        { scope: "all", name: "FOMC", reason: "2pm decision" },
      ],
    });
    expect(msg).toMatch(/⚠ blackout: FOMC/);
  });

  it("ignores blackouts for unrelated tickers", () => {
    const msg = formatVtfMessage(alertOf({ ticker: "AMD" }), {
      activeBlackouts: [
        { scope: { ticker: "NVDA" }, name: "NVDA earnings", reason: "AMC" },
      ],
    });
    expect(msg).not.toMatch(/blackout/);
  });
});

function mkOrder(overrides: Partial<OrderBlock> = {}): OrderBlock {
  return {
    id: "dp-AMZN-abcd1234",
    sequence: 2,
    source: "dp",
    accounts: ["tos"],
    ticker: "AMZN",
    execAs: "AMZN",
    direction: "LONG",
    setup: "",
    why: "",
    entry: 241.5,
    entryOrderType: "LMT",
    stop: 236.5,
    stopSource: "",
    t1: 248,
    t1Source: "",
    t2: 254,
    t2Source: "",
    runner: "",
    riskPerShare: 5,
    quantity: 100,
    totalRisk: 500,
    confirmation: "PENDING_TA",
    conviction: "MEDIUM",
    confluence: "none",
    caveat: "none",
    kills: [],
    activation: "immediate",
    verify: "none",
    status: "ACTIVE",
    ...overrides,
  };
}

describe("matchPlanOrders", () => {
  it("matches by uppercased ticker", () => {
    const orders = [mkOrder({ ticker: "amzn" })];
    expect(matchPlanOrders("AMZN", orders)).toHaveLength(1);
    expect(matchPlanOrders("AmZn", orders)).toHaveLength(1);
  });
  it("skips closed and killed orders", () => {
    const orders = [
      mkOrder({ ticker: "AMZN", status: "CLOSED" }),
      mkOrder({ ticker: "AMZN", status: "KILLED" }),
      mkOrder({ ticker: "AMZN", status: "FILLED" }),
      mkOrder({ ticker: "AMZN", status: "BLOCKED" }),
    ];
    expect(matchPlanOrders("AMZN", orders)).toEqual([]);
  });
  it("returns empty when orders is undefined", () => {
    expect(matchPlanOrders("AMZN", undefined)).toEqual([]);
  });
});

describe("formatVtfMessage + planOrders cross-reference", () => {
  function alertOf(overrides: Record<string, unknown> = {}) {
    const res = parseVtfInput(validInput(overrides), T0);
    if (!res.ok) throw new Error("bad fixture");
    return res.alert;
  }

  it("annotates with matching ORDER when direction agrees", () => {
    const msg = formatVtfMessage(alertOf({ ticker: "AMZN", action: "long AMZN" }), {
      planOrders: [mkOrder({ ticker: "AMZN", direction: "LONG", sequence: 2 })],
    });
    expect(msg).toMatch(/matches DP ORDER 2 LONG @ 241\.5/);
    expect(msg).not.toMatch(/conflicts/);
  });

  it("flags a conflict when the direction opposes the brief", () => {
    const msg = formatVtfMessage(alertOf({ ticker: "AMZN", action: "short AMZN" }), {
      planOrders: [mkOrder({ ticker: "AMZN", direction: "LONG", sequence: 2 })],
    });
    expect(msg).toMatch(/⚠ conflicts with DP ORDER 2 LONG @ 241\.5/);
  });

  it("prefers the agreeing match when both agreeing and conflicting exist", () => {
    const msg = formatVtfMessage(alertOf({ ticker: "AMZN", action: "long AMZN" }), {
      planOrders: [
        mkOrder({ ticker: "AMZN", direction: "SHORT", sequence: 3 }),
        mkOrder({ ticker: "AMZN", direction: "LONG", sequence: 2 }),
      ],
    });
    expect(msg).toMatch(/matches/);
    expect(msg).not.toMatch(/conflicts/);
    expect(msg).toMatch(/ORDER 2/);
  });

  it("emits no plan annotation for flat/trimmed/added (no new direction)", () => {
    const msg = formatVtfMessage(alertOf({ ticker: "AMZN", action: "trimmed 1/2 AMZN" }), {
      planOrders: [mkOrder({ ticker: "AMZN", direction: "LONG", sequence: 2 })],
    });
    expect(msg).not.toMatch(/matches|conflicts/);
  });

  it("emits no plan annotation when ticker is not in the brief", () => {
    const msg = formatVtfMessage(alertOf({ ticker: "NVDA", action: "long NVDA" }), {
      planOrders: [mkOrder({ ticker: "AMZN" })],
    });
    expect(msg).not.toMatch(/matches|conflicts/);
  });

  it("skips already-closed orders when cross-referencing", () => {
    const msg = formatVtfMessage(alertOf({ ticker: "AMZN", action: "long AMZN" }), {
      planOrders: [
        mkOrder({ ticker: "AMZN", direction: "LONG", status: "CLOSED" }),
      ],
    });
    expect(msg).not.toMatch(/matches/);
  });
});

describe("vtfIcon + vtfShouldQuiet", () => {
  it("icons cover every action class", () => {
    for (const cls of [
      "long",
      "short",
      "flat",
      "stopped",
      "trimmed",
      "added",
      "other",
    ] as const) {
      expect(vtfIcon(cls).length).toBeGreaterThan(0);
    }
  });
  it("is loud for entries, stops, and unclassified (execution-relevant)", () => {
    expect(vtfShouldQuiet("long")).toBe(false);
    expect(vtfShouldQuiet("short")).toBe(false);
    expect(vtfShouldQuiet("stopped")).toBe(false);
    expect(vtfShouldQuiet("other")).toBe(false);
  });
  it("is quiet for trims, adds, flats (informational bookkeeping)", () => {
    expect(vtfShouldQuiet("trimmed")).toBe(true);
    expect(vtfShouldQuiet("added")).toBe(true);
    expect(vtfShouldQuiet("flat")).toBe(true);
  });
});
