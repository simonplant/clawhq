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

1. **Read today's brief.** Open `memory/trading-YYYY-MM-DD.md`. Note which sections are filled vs pending.

2. **Fill Market Context.** Fetch current data (use tradier for real-time):
   ```
   tradier quote ES=F NQ=F YM=F CL=F GC=F
   ```
   Add VIX and TNX if available. Capture: futures price, overnight change, direction.

3. **Fill Calendar Risk.** Check for:
   - Earnings reports today (for watchlist names)
   - FOMC, CPI, NFP, other economic events
   - Fed speeches, options expiration
   - If `earnings` tool available: `earnings today` + `earnings check` for watchlist
   - If no earnings tool: note what's known from overnight intelligence

4. **Check section completeness.** Note what's available:
   - Mancini: present / missing
   - Focus 25: present / missing
   - DP: present / pending (typical — Simon hasn't pasted yet)
   - Overnight: present / empty

5. **Cross-reference sources.** When multiple sections are filled:
   - **Alignment:** "DP and Mancini both watching ES [level] zone" → higher confidence
   - **Divergence:** "DP bearish but Mancini sees FB setup for longs at [level]" → caution
   - **Focus 25 overlap:** RS leaders appearing in DP watchlist → potential thesis
   - **Overnight confirmation:** X-scan findings that reinforce or contradict brief levels

6. **Detect confluence/divergence.** Compare ORDER blocks across sources:
   - Same ticker + aligned direction + overlapping level zone → merge into single ORDER with `confluence: DP+MANCINI` (or other combination)
   - Same ticker + opposing direction → keep both ORDERs with `confluence: divergence: [see ORDER N]`. Simon decides.

7. **Cross-account exposure check.** Before finalizing ideas, check: if the same ticker appears in ORDER blocks for multiple accounts, calculate total dollar exposure across all accounts. Per CONFIG.json `cross_account_risk`: max 10% of combined capital ($20,300) in any single name. If exceeded, flag: "NVDA total exposure across tos+ira would be $20K (9.9%) — at limit." Reduce sizing or drop from lower-priority accounts.

8. **Synthesize Ranked Trade Ideas.** Read all ORDER blocks from filled sections. Rank by:
   - **Confirmation** (CONFIRMED > PENDING_TA — all Phase 2 blocks are PENDING_TA)
   - **Confluence** (multi-source aligned > single source)
   - **Conviction level** (HIGH > MEDIUM)
   - **Risk/reward** (best R:R at top)

   **Max 5 trade ideas.** If more than 5 pass conviction filtering, keep the top 5. Cash is always a valid position. Over-trading destroys returns.

   Brief header must include: "Orders are watch-list signals with confirmation: PENDING_TA until TA enrichment is available."

   For each ranked idea, produce an order-ready signal:
   ```
   #1  [Symbol] [Direction] @ [Level] — [Conviction: HIGH/MED] [Trade type]
       LIMIT: [buy/sell] [price]
       Stop: [level]  Targets: [T1, T2]
       Risk: $[amount] per share x [qty] = $[total] ([pct]% of account)
       DP says: "[exact quote]" (if DP section available)
       Sources: [DP / Mancini / Both aligned / Focus 25 RS]
   ```

   If conviction isn't high enough for a specific LIMIT price → WATCH list, not trade idea.

7. **Check account status.** Run `trade-journal positions`:
   - tos ($100K TOS): current positions or "flat" — full capability
   - ira ($100K Fidelity IRA): current positions or "flat" — long-only, no margin
   - tradier ($3K Tradier): current positions or "flat" — Clawdius's own, alert-only
   - Any positions near stops or targets
   - Exposure levels per account

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
