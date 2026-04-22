import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatAlertMessage,
  formatClockTime,
  formatHeartbeat,
  generateAlertId,
  makeInMemoryChannel,
  makeTelegramChannel,
} from "./telegram.js";
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
      expect(generateAlertId()).toMatch(/^[A-Z0-9]{4}$/);
    }
  });
});

describe("formatAlertMessage", () => {
  it("contains the alert id in the reply instruction line", () => {
    const body = formatAlertMessage(mkAlert({ id: "ZZZZ" }));
    expect(body).toContain("YES-ZZZZ");
    expect(body).toContain("HALF-ZZZZ");
    expect(body).toContain("NO-ZZZZ");
  });

  it("annotates governor scope", () => {
    expect(formatAlertMessage(mkAlert({ risk: { scope: "tradier-strict" } }))).toContain(
      "Governor: OK (tradier-strict)",
    );
    expect(
      formatAlertMessage(
        mkAlert({ risk: { scope: "advisory-only", warn: "cross-account" } }),
      ),
    ).toMatch(/Governor: warn — cross-account/);
  });

  it("uses 🔁 CATCHUP prefix for catch-up alerts", () => {
    expect(formatAlertMessage(mkAlert({ catchup: true })).split("\n")[0]).toContain(
      "🔁 CATCHUP",
    );
  });

  it("uses 🛑 for stops and 🎯 for targets", () => {
    expect(formatAlertMessage(mkAlert({ levelName: "stop" })).split("\n")[0]).toContain("🛑");
    expect(formatAlertMessage(mkAlert({ levelName: "t1" })).split("\n")[0]).toContain("🎯");
  });

  it("upper-cases the source in the header", () => {
    const body = formatAlertMessage(mkAlert());
    expect(body).toContain("MANCINI ES");
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
    expect(formatClockTime(d.getTime(), d)).toBe("9:47am");
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

describe("in-memory channel", () => {
  it("appends every send to outbox", async () => {
    const ch = makeInMemoryChannel();
    await ch.send("hello");
    await ch.send("world");
    expect(ch.outbox).toEqual(["hello", "world"]);
  });
});

describe("Telegram channel (mocked fetch)", () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.useRealTimers();
  });

  it("POSTs to sendMessage with the right shape", async () => {
    const calls: RequestInit[] = [];
    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const ch = makeTelegramChannel({
      botToken: "testtoken",
      chatId: "123456",
      timeoutMs: 5000,
    });
    await ch.send("📈 test alert");

    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error("expected one fetch call");
    expect(call.method).toBe("POST");
    const body = JSON.parse(call.body as string) as {
      chat_id: string;
      text: string;
      disable_web_page_preview: boolean;
    };
    expect(body.chat_id).toBe("123456");
    expect(body.text).toBe("📈 test alert");
    expect(body.disable_web_page_preview).toBe(true);
  });

  it("throws on non-2xx response", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, description: "bot not found" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const ch = makeTelegramChannel({
      botToken: "bad",
      chatId: "1",
      timeoutMs: 5000,
    });
    await expect(ch.send("hi")).rejects.toThrow(/Telegram sendMessage 401/);
  });

  it("throws when config is missing", () => {
    expect(() => makeTelegramChannel({ botToken: "", chatId: "1", timeoutMs: 1 })).toThrow();
    expect(() => makeTelegramChannel({ botToken: "t", chatId: "", timeoutMs: 1 })).toThrow();
  });
});
