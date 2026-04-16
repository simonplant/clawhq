---
name: dp-parse
description: "Parse DP/Inner Circle content pasted by Simon into Telegram. Handles two formats: AM Call transcriptions (long-form, pipe through dp-brief) and VTF intraday alerts (short-form action lines). Produces standard ORDER blocks for eligible accounts, writes to daily brief DP section. Event-driven — triggers on paste, not cron."
metadata:
  { "openclaw": { "emoji": "📈", "requires": { "bins": ["curl", "jq", "python3"] } } }
---

# dp-parse — DP/Inner Circle Signal Processing

Processes two types of DP content that Simon pastes into Telegram: AM Call transcriptions and VTF intraday alerts. Produces standard ORDER blocks per `references/STANDARD_ORDER_FORMAT.md` for all eligible accounts (tos, ira, tradier). Writes to `memory/trading-YYYY-MM-DD.md` DP section.

Before first use, consult the trading wiki: `knowledge/trading/wiki/dp-methodology.md` for the DP methodology and `knowledge/trading/wiki/dp-extraction-rules.md` for the extraction contract.

## Detection

When Simon sends a message, determine if it contains DP content:

**AM Call transcription (long-form):**
- Multiple paragraphs of speech-to-text content
- Discusses macro themes, analyst actions, multiple stocks
- Typically arrives 5:30-6:30 AM PT
- Simon may say "DP call", "AM call", "parse this"

**VTF alerts (short-form):**
- Short lines with trade action words: SHORT, LONG, COVERED, TRIMMED, FLAT, ADDED, SOLD
- Contains known tickers (with or without $): META, QQQ, NVDA, SPY, etc.
- Contains DP-style typos: mera, emta, coverd, trimemd, shrot
- Multiple lines with trading language
- Simon may say "VTF", "DP alerts", "parse this"

**Not DP content:**
- General market questions ("what's SPY at?")
- Single-word messages
- Requests for the morning brief

## Workflow: AM Call

1. **Pipe through dp-brief.** Run `dp-brief` with the pasted text. The tool handles speech-to-text cleanup (ticker fixes, price fixes, position detection).

2. **Review dp-brief output.** Check extracted tickers make sense (no phantom tickers from garbled speech). Flag any `VERIFY` items.

3. **Apply extraction rules.** Read `knowledge/trading/wiki/dp-extraction-rules.md` — the full extraction contract. For each stock DP discusses:
   - Is there an actionable level? (specific price or MA)
   - What's the direction? (long, short, observation)
   - What's the conviction? (from language → conviction table in dp-methodology.md)
   - What's the trade type? (CORE_SWING, PLANNED, EVENT, RS, SCALP)

4. **Produce standard ORDER blocks.** Per `references/STANDARD_ORDER_FORMAT.md`:
   - HIGH and MEDIUM conviction → ORDER blocks with entry, stop, targets, risk
   - LOW conviction → WATCH section
   - Exclude → omit entirely
   - All ORDER blocks: `accounts: tos,ira,tradier` (or eligible subset — IRA excludes shorts, margin, and day trades)
   - Size per account: tos ($100K, 1% risk), ira ($100K, 1% risk, long-only), tradier ($3K, 1% risk)
   - All ORDER blocks must include: `confirmation: PENDING_TA` (TA enrichment upgrades later)
   - All ORDER blocks must include: `confluence: none` (premarket-brief detects cross-source alignment)

5. **Write to daily brief.** Append the full trade plan output to `memory/trading-YYYY-MM-DD.md` under `## DP/Inner Circle (Source 3)`. Also append ORDER blocks to the `## Orders` section. Preserve existing sections.

6. **Log ORDER blocks to journal.** For each ORDER block produced:
   ```
   journal append order '{"source":"dp","accounts":"tos,tradier","ticker":"META","direction":"SHORT","conviction":"HIGH","entry":520,"stop":525,"status":"ACTIVE"}'
   ```
   Note: SHORT ideas exclude IRA (long-only). This creates an audit trail. The heartbeat will log status transitions (TRIGGERED, FILLED, KILLED).

7. **Cross-reference with Mancini.** Read the Mancini section of today's brief:
   - Same ticker + aligned direction + overlapping level zone → update ORDER: `confluence: DP+MANCINI`
   - Same ticker + opposing direction → emit both ORDERs with `confluence: divergence: [see ORDER N]`
   - If no Mancini section exists, skip cross-reference

8. **Deliver summary.** One message to Simon:
   - Bias, number of orders generated, top conviction idea
   - Any VERIFY items that need his attention
   - Cross-reference findings (alignment/divergence)
   - If before 6:00 AM PT: "Included in premarket brief"
   - If after 6:00 AM PT: deliver as a **DP Update** supplement

## Workflow: VTF Alerts

1. **Parse alert lines.** Each line is a trade action. Extract:
   - Action: SHORT, LONG, COVERED, TRIMMED, FLAT, ADDED, SOLD
   - Ticker: resolve typos per dp-methodology (mera→META, queues→QQQ, etc.)
   - Price: if stated
   - Context: any qualifier ("half", "starter", "full size", "aggressive")

2. **Map to trade-journal commands.** For each eligible account:
   - SHORT/LONG → `trade-journal log <account> <side> <qty> <symbol> --notes "VTF: <original text>"`
   - COVERED/FLAT → `trade-journal close <account> <symbol> --notes "VTF: <original text>"`
   - TRIMMED/SOLD → `trade-journal close <account> <symbol> --qty <partial> --notes "VTF: <original text>"`
   - ADDED → `trade-journal log <account> <side> <qty> <symbol> --notes "VTF: added"`

3. **Size per account.**
   - **tos** ($100K): full size, 1% risk = $1,000 max risk per trade, max 15% per position
   - **ira** ($100K): full size, 1% risk = $1,000 max risk per trade, long-only (skip SHORT/short-side alerts)
   - **tradier** ($3K): reduced size, 1% risk = $30 max risk per trade, alert-only (Clawdius generates but does not auto-execute yet)
   - Use `quote <symbol>` for current price if not stated in alert
   - Run `risk_governor.py check` before logging

4. **Present to Simon.** Simon executes on TOS and Fidelity. Clawdius generates ideas for all eligible accounts:
   - For tos/ira: present the sized ORDER with entry, stop, targets. Simon decides whether to execute.
   - For tradier: log the idea. Tradier is Clawdius's own account — currently alert-only mode.
   - When DP says FLAT, flag all accounts holding that ticker for closure.

5. **Confirm to Simon.** One batched message:
   - Ideas generated per account (with sizing)
   - Account eligibility notes (e.g., "IRA: skipped — short idea")
   - Current account states (exposure, open positions)
   - Any risk governor blocks

6. **Append to daily brief.** Add VTF events to the DP section of `memory/trading-YYYY-MM-DD.md` as an event log.

## Rules

- **Advisory for tos/ira, autonomous for tradier.** Simon executes on TOS and Fidelity. Clawdius logs ideas for tradier (alert-only mode).
- **Never fabricate.** Don't invent prices, levels, or positions DP didn't state. Flag VERIFY for ambiguous content.
- **Batch VTF alerts.** If multiple alerts arrive close together, batch into one message + one set of trade-journal commands. Don't send one message per alert.
- **Don't nag about missing DP.** If Simon hasn't pasted the AM Call yet, note "DP section pending" once. Don't ask again.
- **Risk governor is the hard gate.** Every trade passes through `risk_governor.py check` before execution. If blocked, report to Simon and don't override.

## Failure Modes

- **Ambiguous input** (200-500 chars, no clear keyword/headers) → quarantine with "Clarify: AM Call or VTF alert?" message. Do not guess.
- **Malformed AM Call** (dp-brief returns partial/error) → emit partial ORDER blocks with `incomplete: [missing fields]` flag. Do not silently fill gaps.
- **VTF parse fails** (unrecognized format, garbled text) → quarantine raw text, alert Simon: "Could not parse VTF content. Raw text preserved."
- **dp-brief tool unavailable** → alert Simon: "dp-brief tool not available. Raw text saved to daily brief DP section for manual review."
- **Price sanity check fails** (extracted price outside expected range) → flag `verify: "price [X] outside expected range for [TICKER]"`. Do not omit the ORDER.
- **Risk governor blocks trade** → log block reason to journal, include in Simon's confirmation message. Do not retry or override.

## References

- `knowledge/trading/` — trading wiki (query for dp-methodology, dp-extraction-rules, conviction scoring)
- `references/TRADING_SOP.md` — daily cycle, phases, signal routing
- `references/STANDARD_ORDER_FORMAT.md` — ORDER block format

## Requires

- `dp-brief` workspace tool (for AM Call parsing)
- `trade-journal` workspace tool (for account trade logging)
- `quote` workspace tool (for price verification)
- `risk_governor.py` (for pre-trade constraint checks)
