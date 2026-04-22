import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeTradierClient, TradierError } from "./tradier.js";

describe("TradierClient", () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.useRealTimers();
  });

  function stub(response: unknown, status = 200): void {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(response), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
  }

  it("parses bulk quote with multiple symbols", async () => {
    stub({
      quotes: {
        quote: [
          {
            symbol: "SPY",
            last: 500.12,
            bid: 500.1,
            ask: 500.14,
            high: 501,
            low: 498,
            prevclose: 499.5,
            trade_date: 1_700_000_000_000,
          },
          {
            symbol: "QQQ",
            last: 400.55,
            bid: 400.5,
            ask: 400.6,
            high: 401,
            low: 399,
            prevclose: 399.8,
            trade_date: 1_700_000_000_000,
          },
        ],
      },
    });
    const client = makeTradierClient({ baseUrl: "http://fake", accountId: "A1" });
    const quotes = await client.quotes(["SPY", "QQQ"]);
    expect(quotes).toHaveLength(2);
    expect(quotes[0]?.symbol).toBe("SPY");
    expect(quotes[0]?.last).toBe(500.12);
    expect(quotes[0]?.dayHigh).toBe(501);
    expect(quotes[0]?.dayLow).toBe(498);
    expect(quotes[0]?.prevClose).toBe(499.5);
  });

  it("handles single-quote response (Tradier returns object, not array)", async () => {
    stub({
      quotes: {
        quote: {
          symbol: "SPY",
          last: 500,
          bid: 499.9,
          ask: 500.1,
          high: 501,
          low: 498,
          prevclose: 499.5,
          trade_date: 1_700_000_000_000,
        },
      },
    });
    const client = makeTradierClient({ baseUrl: "http://fake", accountId: "A1" });
    const quotes = await client.quotes(["SPY"]);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.symbol).toBe("SPY");
  });

  it("returns empty array when requesting no symbols", async () => {
    const client = makeTradierClient({ baseUrl: "http://fake", accountId: "A1" });
    const quotes = await client.quotes([]);
    expect(quotes).toEqual([]);
  });

  it("maps market clock states", async () => {
    stub({
      clock: {
        state: "open",
        next_change: "16:00",
        date: "2026-04-21",
        description: "Market is open",
      },
    });
    const client = makeTradierClient({ baseUrl: "http://fake", accountId: "A1" });
    const clk = await client.clock();
    expect(clk.state).toBe("open");
    expect(clk.description).toBe("Market is open");
  });

  it("maps premarket / afterhours states", async () => {
    stub({
      clock: { state: "premarket", next_change: "09:30", date: "2026-04-21" },
    });
    let clk = await makeTradierClient({ baseUrl: "http://fake", accountId: "A1" }).clock();
    expect(clk.state).toBe("premarket");

    stub({
      clock: { state: "postmarket", next_change: "20:00", date: "2026-04-21" },
    });
    clk = await makeTradierClient({ baseUrl: "http://fake", accountId: "A1" }).clock();
    expect(clk.state).toBe("postmarket");
  });

  it("handles empty positions response (Tradier quirk: string 'null')", async () => {
    stub({ positions: "null" });
    const client = makeTradierClient({ baseUrl: "http://fake", accountId: "A1" });
    const positions = await client.positions();
    expect(positions).toEqual([]);
  });

  it("parses positions with single position (object, not array)", async () => {
    stub({
      positions: {
        position: {
          symbol: "AAPL",
          quantity: 10,
          cost_basis: 1700,
        },
      },
    });
    const client = makeTradierClient({ baseUrl: "http://fake", accountId: "A1" });
    const positions = await client.positions();
    expect(positions).toEqual([
      { symbol: "AAPL", qty: 10, avgPrice: 170, costBasis: 1700 },
    ]);
  });

  it("parses balances with close_pl as day change", async () => {
    stub({
      balances: {
        total_equity: 3100,
        total_cash: 2500,
        close_pl: 42.5,
        pdt_day_trades: 1,
      },
    });
    const client = makeTradierClient({ baseUrl: "http://fake", accountId: "A1" });
    const bal = await client.balances();
    expect(bal.totalEquity).toBe(3100);
    expect(bal.dayChange).toBe(42.5);
    expect(bal.cash).toBe(2500);
    expect(bal.pdtCount).toBe(1);
  });

  it("throws TradierError on HTTP error", async () => {
    stub({ error: "unauthorized" }, 401);
    const client = makeTradierClient({ baseUrl: "http://fake", accountId: "A1" });
    await expect(client.quotes(["SPY"])).rejects.toBeInstanceOf(TradierError);
  });
});
