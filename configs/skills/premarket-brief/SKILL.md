---
name: premarket-brief
description: "Synthesize the daily trading brief into one order-ready morning message by 6:00 AM PT. Reads all filled sections of memory/trading-YYYY-MM-DD.md, fills Market Context and Calendar Risk, cross-references sources, ranks trade ideas by conviction, and delivers the single most important trading deliverable of the day. Simon uses this to place LIMIT orders before the bell."
metadata:
  { "openclaw": { "emoji": "🌅", "requires": { "bins": ["curl", "jq"] } } }
---

# premarket-brief — Morning Trading Brief Synthesis

The single most important deliverable of the day. Simon uses this to place LIMIT orders before the 6:30 AM PT open. Must be complete, order-ready, and worth his time.

Read `references/TRADING_SOP.md` Phase 2 (PLAN) for the full specification.
Read `references/STANDARD_ORDER_FORMAT.md` for the ORDER block format.

## Schedule

- **Cron:** 6:00 AM PT weekdays (`0 6 * * 1-5`)
- **Hard deadline:** Simon needs this by 6:00 AM to place orders by 6:10-6:30 AM

## What's Already in the Brief by 6:00 AM

Phase 1 (RESEARCH) crons have been filling `memory/trading-YYYY-MM-DD.md` since prior close:
- **Mancini (Source 1):** Filled at 2:30 PM PT prior day by mancini-fetch
- **Focus 25 (Source 2):** Filled at 4:30 PM PT prior day by focus25-fetch (or pending)
- **DP/Inner Circle (Source 3):** Pending until Simon pastes (don't wait for it)
- **Overnight Intelligence:** Accumulated by x-scan + heartbeats overnight

## Procedure

Simon has ~20 minutes (6:00-6:20 AM) to read, decide, and place orders. The brief is structured for speed: regime → portfolio → trades → context.

### Phase A: Assess (what's the environment?)

1. **Regime detection.** Run `ta regime`. This returns the market regime (TRENDING/CHOPPY/VOLATILE/CRISIS) with sizing rules and per-account guidance. The regime determines everything that follows — sizing, trade types, number of ideas.

2. **Calendar risk.** Run `earnings today` + `earnings check` for watchlist + `earnings economic --days 2`. Flag any market-moving events (FOMC, CPI, earnings on held positions). FOMC/CPI days → force VOLATILE regime regardless of VIX.

### Phase B: Portfolio (what do I hold right now?)

3. **Current positions.** Run `trade-journal positions` for each account. Present:
   ```
   PORTFOLIO
   tos:     NVDA 100sh @ $118.50 (+$280, +2.4%) | SPY 50sh @ $695 (+$247) | Cash: $82K | Exp: 18%
   ira:     META 30sh @ $655 (+$497) | AAPL 40sh @ $258 (+$337) | Cash: $73K | Exp: 26%
   tradier: flat | Cash: $3K
   ```
   This is the first thing Simon sees. He knows where he stands before reading any trade ideas.

4. **Position alerts.** For any open position approaching stop or target (from market-monitor alerts), flag it: "NVDA approaching T1 ($125) — consider scaling 75%."

### Phase C: Today's Trades (what should I do?)

5. **Read today's brief.** Open `memory/trading-YYYY-MM-DD.md`. Note which sections are filled vs pending.

6. **Cross-reference sources.** When multiple sections are filled:
   - Same ticker + aligned direction → merge ORDER with `confluence: DP+MANCINI`
   - Same ticker + opposing direction → keep both with `divergence` flag. Simon decides.

7. **Cross-account exposure check.** If same ticker across multiple accounts exceeds 10% of combined capital ($20,300), flag and reduce.

8. **Synthesize and rank.** Read all ORDER blocks. Apply regime sizing (from step 1). Rank by:
   - **Regime-adjusted conviction** (HIGH in TRENDING = full size. HIGH in CHOPPY = half size.)
   - **Confluence** (multi-source > single source)
   - **Risk/reward**

   **Max 5 trade ideas.** Cash is always a valid position.

   For each idea, produce order-ready output sized per account:
   ```
   #1  BUY SPY @ $695 — Mancini FB, HIGH conviction [TRENDING → full size]
       tos: 50 shares ($34,750). Stop $690, T1 $705, T2 $710. Risk $250.
       ira: 50 shares ($34,750). Stop $690, T1 $705, T2 $710. Risk $250.
       tradier: SKIP (SPY $700 > max_share_price $150)
       Sources: Mancini + DP aligned. Confluence: DP+MANCINI.
   ```

### Phase D: Context (if Simon wants more)

9. **Market context.** Futures, overnight moves, VIX/oil/bonds.

10. **Overnight intelligence.** Batched X findings, news — high-signal items only.

11. **Key levels.** Unified level grid from Mancini + DP + Focus 25.

12. **Source status.** Mancini [Y/N] | Focus 25 [Y/N] | DP [pending] | Overnight [Y/N]

8. **Deliver the brief.** One message in this format:

   ```
   === Pre-Market Brief — YYYY-MM-DD ===

   MARKET CONTEXT
   [Futures, overnight moves, macro drivers, VIX/oil/bonds]

   OVERNIGHT INTELLIGENCE
   [Batched X findings, news digest — only the high-signal items]

   TODAY'S TRADE IDEAS (order-ready)
   #1  [full signal with LIMIT, stop, targets, risk, sources]
   #2  ...

   WATCH LIST (no orders — monitor only)
   - [Symbol] @ [level] — [LOW conviction reason] — alert if reaches level

   KEY LEVELS TO WATCH
   [Unified level grid: Mancini ES levels + DP stock levels + Focus 25 movers]

   CALENDAR RISK
   [Earnings, FOMC, NFP, speeches]

   ACCOUNT STATUS
   tos:     [positions or "flat"] — Simon executes (stocks, options, futures, shorting, margin)
   ira:     [positions or "flat"] — Simon executes (long-only, no margin, no shorting, no day trading)
   tradier: [positions or "flat"] — Clawdius's own (alert-only mode)

   SOURCES: Mancini [Y/N] | Focus 25 [Y/N] | DP [pending] | Overnight [Y/N]
   ```

## Quality Bar

- **Order-ready means order-ready.** Not "watch this area" — give Simon a LIMIT price, stop, and targets.
- **If nothing is worth trading, say so.** "Quiet pre-market, Mancini levels unchanged, no DP call yet" is better than filler.
- **Don't repeat education.** Simon knows the methodology. Just give levels and signals.
- **One message.** Not a thread. Not a follow-up. One complete brief.

## When DP Arrives After 6:00 AM

If Simon pastes the DP AM Call after the brief has been delivered:
1. dp-parse processes it normally (writes to brief, produces ORDER blocks)
2. dp-parse delivers a **DP Update** supplement — not a full re-brief
3. The supplement contains: new ORDER blocks, cross-reference findings, any changes to ranked ideas
4. This is handled by dp-parse, not premarket-brief

## Failure Modes

- **Missing DP section** (Simon hasn't pasted AM Call) → ship brief with DP section flagged `awaiting_input`. Do not block delivery.
- **Missing Mancini section** (mancini-fetch failed or post not published) → ship brief with Mancini section flagged `unavailable`. Do not block.
- **Quote tool fails** (tradier unreachable) → ship brief with `market_context_unavailable: true` in header. Do not block.
- **Earnings tool unavailable** → emit Calendar Risk section with `pending_earnings_tool: true`. Do not block.
- **Daily brief file doesn't exist** → create scaffold (mancini-fetch should have done this, but defensive fallback). Log warning.
- **Sources conflict on same ticker** → emit both ORDER blocks with `confluence: divergence`. Do not resolve silently — Simon decides.
- **All sections empty** (catastrophic failure, no data) → send one-liner: "Pre-market brief unavailable — all data sources failed. Check system health." Do not send an empty template.

## Anti-Patterns

- Don't send the brief at 5:45 AM with "will update at 6:00" — send once, complete
- Don't wait for DP — build the best plan from what's available
- Don't include low-conviction ideas as trade ideas — they're WATCH items
- Don't generate new analysis — synthesize what the extractors already produced
- Don't repeat the brief content in a follow-up message

## References

- `knowledge/trading/` — trading wiki (query for dp-methodology, mancini-methodology, conviction scoring)
- `references/TRADING_SOP.md` — daily cycle, phases, signal routing
- `references/STANDARD_ORDER_FORMAT.md` — ORDER block format

## Requires

- `quote` workspace tool (for futures/market data)
- `trade-journal` workspace tool (for account status)
- `earnings` workspace tool (for calendar risk, when available)
