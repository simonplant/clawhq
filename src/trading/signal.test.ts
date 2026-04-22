import { describe, expect, it } from "vitest";

import {
  formatAlertMessage,
  formatClockTime,
  formatHeartbeat,
  generateAlertId,
  makeInMemoryChannel,
  parseReply,
} from "./signal.js";
import type { Alert } from "./types.js";

function mkAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "A7F3",
    orderId: "mancini-ES-abcd1234",
    sequence: 1,
    source: "mancini",
    horizon: "session",
    ticker: "ES",
    execAs: "/MES",
    accounts: ["tos"],
    direction: "LONG",
    conviction: "MEDIUM",
    confirmation: "CONFIRMED",
    entry: 7021,
    stop: 6998,
    t1: 7036,
    t2: 7048,
    totalRisk: 230,
    levelName: "entry",
    levelPrice: 7021,
    risk: { scope: "advisory-only" },
    expiresAtMs: Date.now() + 5 * 60_000,
    ...overrides,
  };
}

describe("generateAlertId", () => {
  it("produces 4-character uppercase alphanumeric ids", () => {
    for (let i = 0; i < 50; i++) {
      const id = generateAlertId();
      expect(id).toMatch(/^[A-Z0-9]{4}$/);
    }
  });
});

describe("formatAlertMessage", () => {
  it("contains the alert id in the reply line", () => {
    const body = formatAlertMessage(mkAlert({ id: "ZZZZ" }));
    expect(body).toContain("YES-ZZZZ");
    expect(body).toContain("HALF-ZZZZ");
    expect(body).toContain("NO-ZZZZ");
  });

  it("annotates governor scope", () => {
    const tradier = formatAlertMessage(
      mkAlert({ risk: { scope: "tradier-strict" } }),
    );
    expect(tradier).toContain("Governor: OK (tradier-strict)");

    const warned = formatAlertMessage(
      mkAlert({ risk: { scope: "advisory-only", warn: "cross-account" } }),
    );
    expect(warned).toMatch(/Governor: warn — cross-account/);
  });

  it("uses 🔁 CATCHUP header for catch-up alerts", () => {
    const body = formatAlertMessage(mkAlert({ catchup: true }));
    expect(body.split("\n")[0]).toContain("🔁 CATCHUP");
  });

  it("uses 🛑 for stop-level alerts and 🎯 for targets", () => {
    const stopAlert = formatAlertMessage(mkAlert({ levelName: "stop" }));
    expect(stopAlert.split("\n")[0]).toContain("🛑");
    const t1Alert = formatAlertMessage(mkAlert({ levelName: "t1" }));
    expect(t1Alert.split("\n")[0]).toContain("🎯");
  });
});

describe("parseReply", () => {
  it("recognizes YES-XXXX", () => {
    const r = parseReply("YES-A7F3");
    expect(r.type).toBe("approve");
    expect(r.alertId).toBe("A7F3");
  });

  it("is lenient on case and whitespace", () => {
    expect(parseReply("yes a7f3").type).toBe("approve");
    expect(parseReply("  approve  A7F3  ").type).toBe("approve");
    expect(parseReply("Yes_A7F3").type).toBe("approve");
  });

  it("maps all documented reply verbs", () => {
    expect(parseReply("HALF-A7F3").type).toBe("reduce-half");
    expect(parseReply("THIRD-A7F3").type).toBe("reduce-third");
    expect(parseReply("NO-A7F3").type).toBe("reject");
    expect(parseReply("REJECT-A7F3").type).toBe("reject");
    expect(parseReply("5MIN-A7F3").type).toBe("defer-5m");
    expect(parseReply("DEFER-A7F3").type).toBe("defer-5m");
    expect(parseReply("OPEN-A7F3").type).toBe("defer-to-open");
  });

  it("refuses plain 'yes' with no alert id", () => {
    expect(parseReply("yes").type).toBeNull();
    expect(parseReply("approve please").type).toBeNull();
  });

  it("refuses ambiguous input with multiple reply verbs", () => {
    expect(parseReply("YES-A7F3 or NO-A7F3").type).toBeNull();
  });

  it("ignores unknown verbs", () => {
    expect(parseReply("DO-A7F3").type).toBeNull();
  });
});

describe("formatHeartbeat", () => {
  it("renders a compact status line", () => {
    const now = Date.now();
    const later = now + 15 * 60_000;
    const s = formatHeartbeat({
      nowMs: now,
      nextAtMs: later,
      symbolCount: 30,
      alertsToday: 2,
      tradierPnl: 120,
    });
    expect(s).toMatch(/💓/);
    expect(s).toMatch(/30 symbols/);
    expect(s).toMatch(/2 alerts today/);
    expect(s).toMatch(/\+\$120/);
    expect(s).toMatch(/next heartbeat/);
  });
});

describe("formatClockTime", () => {
  it("renders 12-hour time with am/pm suffix", () => {
    const d = new Date();
    d.setHours(9, 47, 0, 0);
    const s = formatClockTime(d.getTime(), d);
    expect(s).toBe("9:47am");
  });

  it("handles noon as 12:00pm", () => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    expect(formatClockTime(d.getTime(), d)).toBe("12:00pm");
  });

  it("handles midnight as 12:00am", () => {
    const d = new Date();
    d.setHours(0, 3, 0, 0);
    expect(formatClockTime(d.getTime(), d)).toBe("12:03am");
  });
});

describe("in-memory SignalChannel", () => {
  it("sends messages to outbox and drains inbox on receive", async () => {
    const ch = makeInMemoryChannel();
    await ch.send("hello");
    expect(ch.outbox).toEqual(["hello"]);

    ch.inbox.push("YES-A7F3");
    const received = await ch.receive();
    expect(received).toEqual(["YES-A7F3"]);
    expect(await ch.receive()).toEqual([]); // already drained
  });
});
