---
name: dp-parse
description: "Parse DP/Inner Circle content — three input types: AM Call (thesis + watchlist), VTF alerts (real-time entries), and moderator trade log (Kira/Rickman execution). AM Call sets the thesis, VTF gives real-time signals, Kira's execution patterns are the optimal timing reference."
metadata:
  { "openclaw": { "emoji": "📈", "requires": { "bins": ["curl", "jq", "python3"] } } }
---

# dp-parse — DP/Inner Circle Signal Processing

Three distinct input types, each serving a different purpose:

| Input | What It Is | What It Tells You | Urgency |
|-------|-----------|-------------------|---------|
| **AM Call** | DP's morning thesis (long-form transcript) | Bias, watchlist, ideal levels, key MAs, analyst actions | Low — background context for the day |
| **VTF Alerts** | Real-time trade actions from the chat | What they're buying/selling RIGHT NOW | High — actionable immediately |
| **Moderator Trade Log** | Kira/Rickman execution log (table format) | Optimal execution timing and sizing patterns | Medium — learn from their entries vs AM Call levels |

**Key insight: DP's AM Call levels are thesis-grade, not execution-grade.** The AM Call says "AMZN buyable at 241" but Kira buys AMZN calls at $248. The AM Call says "BE at 210-212" but they enter at $218-220. The moderators trade the names DP identifies but at market prices, not at the ideal levels. DP sets the thesis. Kira has the optimal execution.

Before first use, consult the trading wiki: `knowledge/trading/wiki/dp-methodology.md` for methodology and `knowledge/trading/wiki/dp-extraction-rules.md` for extraction rules.

## Detection

When Simon sends a message, classify the content:

**AM Call transcript (long-form):**
- Multiple paragraphs of speech-to-text content
- Discusses macro themes, analyst actions, multiple stocks
- Typically arrives 5:30-6:30 AM PT
- Simon may say "DP call", "AM call", "parse this"

**VTF alerts (short-form action lines):**
- Short lines with trade actions: SHORT, LONG, COVERED, TRIMMED, FLAT, ADDED, SOLD
- Known tickers (with or without $): META, QQQ, NVDA, SPY, etc.
- DP-style typos: mera, emta, coverd, shrot
- Simon may say "VTF", "DP alerts", "parse this"

**Moderator trade log (table format):**
- Markdown table with columns: Time, User, Ticker, Action
- Users include Kira, Rickman, DP, and unnamed moderators
- Simon may say "IC trades", "moderator log", "Kira trades"

**Not DP content:**
- General market questions ("what's SPY at?")
- Single-word messages
- Requests for the morning brief

## Workflow: AM Call → Thesis + Watchlist

The AM Call produces a **WATCHLIST** with ideal levels, NOT executable ORDER blocks. These levels are aspirational — the moderators rarely wait for them.

1. **Pipe through dp-brief.** Run `dp-brief` with the pasted text. Handles speech-to-text cleanup.

2. **Extract thesis.** For each stock DP discusses:
   - Direction (bullish/bearish/neutral)
   - Conviction (from language → conviction table)
   - Ideal entry level (the MA or price he names)
   - Trade type (CORE_SWING, PLANNED, EVENT, RS, SCALP)

3. **Write to daily brief** under `## DP/Inner Circle (Source 3)` with two subsections:

   **DP Thesis (from AM Call):**
   ```
   BIAS: LEAN BULLISH — expecting choppy pullback in recent leaders
   
   WATCHLIST (ideal levels — moderators often enter above these):
   - AMZN: buyer below 241 (8-day MA) — HIGH conviction, CORE_SWING
   - BE: viable at 210-212 — HIGH conviction, PLANNED
   - NVDA: add below 190 — MEDIUM conviction, PLANNED
   - HOOD: buy dips to 80 — MEDIUM conviction, EVENT (PDT rule change)
   
   THEMES: Software analysts catching down (NOW, ZS, OKTA targets lowered). 
   Recent leaders (MBIS, MRVL, AMD, SNDK) extended, likely pullback.
   ```

   Do NOT produce ORDER blocks from AM Call levels alone. These become ORDER blocks only when confirmed by VTF execution or moderator trades.

4. **Cross-reference with Mancini and Focus 25.** Flag alignment/divergence with other sources.

5. **Deliver summary.** Bias, watchlist names, key themes. Note: "These are thesis levels. Watch for VTF/moderator entries for actual execution timing."

## Workflow: VTF Alerts → Real-Time Signals

VTF alerts are the **actual execution signals**. When Kira or DP posts "long $BE", that's the entry — at whatever the current market price is, not at the AM Call level.

1. **Parse alert lines.** Each line is a trade action:
   - Action: LONG, SHORT, TRIMMED, FLAT, COVERED, ADDED
   - Ticker: resolve typos
   - User: who posted (Kira, Rickman, DP, unnamed)
   - Price: current market price (fetch via `tradier quote` if not stated)

2. **Produce ORDER blocks.** VTF alerts get real ORDER blocks because these are actual entries:
   - Entry = current market price at time of alert (NOT the AM Call ideal level)
   - Stop = derived from AM Call thesis (the MA or support level DP mentioned)
   - Targets = next resistance levels from brief
   - `confirmation: PENDING_TA` (or MANUAL if Simon decides to follow)
   - `accounts: tos,ira,tradier` (filtered by constraints)

3. **Size per account.**
   - **tos** ($100K): 1% risk = $1,000 max risk per trade
   - **ira** ($100K): 1% risk = $1,000, long-only (skip shorts)
   - **tradier** ($3K): 1% risk = $30, alert-only

4. **Present to Simon immediately.** VTF alerts are time-sensitive:
   ```
   VTF ALERT: Kira + Rickman LONG $BE at ~$218
   AM Call thesis: "viable at 210-212" — entering above ideal level
   Sized: tos 45sh ($1K risk to $210 stop) | ira 45sh | tradier SKIP ($218 > $150)
   Execute?
   ```

5. **Track execution vs AM Call.** Note the gap between AM Call level and actual entry. This feeds the track-record tool's understanding of "DP thesis accuracy" vs "VTF execution accuracy."

6. **When moderators go FLAT/COVERED.** Flag all accounts holding that ticker:
   ```
   VTF: Kira + Rickman FLAT $BE at ~$219
   BE position should be closed. All accounts.
   ```

## Workflow: Moderator Trade Log → Execution Patterns

The moderator log is a **post-hoc record** of what Kira/Rickman actually did. Use it to:

1. **Parse the table.** Extract: time, user, ticker, action (long/trimmed/flat/etc.)

2. **Reconstruct the trades.** Group by ticker, build the timeline:
   ```
   BE: Long 10:26 → Trimmed 10:50 → Trimmed 10:53 → Added 11:40 → Flat 11:54 → Short 12:12
   Duration: 88 min long, then reversed to short
   ```

3. **Compare to AM Call thesis.** For each traded name:
   - Was it on the AM Call watchlist? (BE: yes. LITX: no — real-time only.)
   - Entry price vs AM Call ideal level? (BE entered ~$218 vs AM Call "210-212")
   - How long did they hold? (BE: 88 min. LITX: all day with trims.)

4. **Extract Kira's patterns.** Kira is the optimal execution reference:
   - **Entry timing:** Does Kira enter at the open, mid-morning, or afternoon?
   - **Position management:** How quickly does Kira trim? (BE: trimmed in 24 min)
   - **Reversal speed:** Kira goes long→flat→short on the same name in one session
   - **Names not in AM Call:** Kira trades LITX, IBIT — watch for these as real-time signals

5. **Write execution analysis to daily brief** under DP section:
   ```
   MODERATOR EXECUTION (from IC trade log):
   - BE: entered $218 (AM Call said 210-212), held 88 min, took profit, reversed short
   - LITX: not in AM Call — real-time Kira pick, held all day with trims
   - AAPL: Rickman traded calls aggressively, trimming into strength
   - AMZN: Kira bought 250 calls at $248 (AM Call said "below 241")
   
   KEY PATTERN: Moderators enter above AM Call levels. AM Call = thesis. 
   VTF/chat = execution. Kira's timing is the signal, not DP's price.
   ```

6. **Score for track-record.** Each moderator trade gets scored:
   ```
   track-record score "vtf-LONG-HIGH-BE-20260415" WIN --pnl 1.84 --notes "Kira long 10:26 ~$218, flat 11:54 ~$219. Quick scalp."
   ```

## Rules

- **AM Call = thesis, VTF = execution.** Never generate ORDER blocks from AM Call levels alone. Wait for VTF confirmation or present AM Call levels as WATCHLIST items.
- **Kira's timing > DP's levels.** When Kira enters a name at a different price than DP's AM Call level, Kira's price is the execution-grade signal.
- **Track the gap.** Always note the difference between AM Call ideal level and actual VTF/moderator entry. This data compounds in the track-record.
- **Names not in the AM Call are real.** LITX, IBIT — if Kira and Rickman both enter, it's a real signal even if DP didn't mention it in the morning.
- **Never fabricate.** Don't invent prices or positions. Flag VERIFY for ambiguous content.
- **Batch VTF alerts.** Multiple alerts close together → one message.
- **Risk governor is the hard gate.** Every trade passes through `risk_governor.py check`.

## Failure Modes

- **Ambiguous input** (200-500 chars, no clear format) → quarantine with "Clarify: AM Call, VTF alert, or moderator log?"
- **Malformed AM Call** → emit partial thesis + watchlist with `incomplete` flag
- **VTF parse fails** → quarantine raw text, alert Simon
- **Moderator log missing columns** → parse what's available, flag gaps
- **dp-brief tool unavailable** → save raw text to brief for manual review

## References

- `knowledge/trading/` — trading wiki (dp-methodology, dp-extraction-rules, conviction scoring)
- `references/TRADING_SOP.md` — daily cycle, phases, signal routing
- `references/STANDARD_ORDER_FORMAT.md` — ORDER block format

## Requires

- `dp-brief` workspace tool (for AM Call parsing)
- `trade-journal` workspace tool (for trade logging)
- `tradier quote` or `quote` (for current prices on VTF alerts)
- `risk_governor.py` (for pre-trade constraint checks)
- `track-record` workspace tool (for scoring outcomes)
