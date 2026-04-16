---
name: dp-parse
description: "Parse DP/Inner Circle content pasted by Simon into Telegram. Handles two formats: AM Call transcriptions (long-form, pipe through dp-brief) and VTF intraday alerts (short-form action lines). Produces standard ORDER blocks, writes to daily brief DP section, executes Pot B trades mechanically. Event-driven — triggers on paste, not cron."
metadata:
  { "openclaw": { "emoji": "📈", "requires": { "bins": ["curl", "jq", "python3"] } } }
---

# dp-parse — DP/Inner Circle Signal Processing

Processes two types of DP content that Simon pastes into Telegram: AM Call transcriptions and VTF intraday alerts. Produces standard ORDER blocks per `references/STANDARD_ORDER_FORMAT.md`. Writes to `memory/trading-YYYY-MM-DD.md` DP section. Executes Pot B trades mechanically for VTF alerts.

Before first use, read `references/DP.md` for the DP methodology and `references/analyze-dp.md` for the extraction contract.

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

3. **Apply extraction rules.** Read `references/analyze-dp.md` — the full extraction contract. For each stock DP discusses:
   - Is there an actionable level? (specific price or MA)
   - What's the direction? (long, short, observation)
   - What's the conviction? (from language → conviction table in DP.md)
   - What's the trade type? (CORE_SWING, PLANNED, EVENT, RS, SCALP)

4. **Produce standard ORDER blocks.** Per `references/STANDARD_ORDER_FORMAT.md`:
   - HIGH and MEDIUM conviction → ORDER blocks with entry, stop, targets, risk
   - LOW conviction → WATCH section
   - Exclude → omit entirely
   - All ORDER blocks: `pot: B`, sizing per DP.md rules (1% risk, max 15% per position)

5. **Write to daily brief.** Append the full trade plan output to `memory/trading-YYYY-MM-DD.md` under `## DP/Inner Circle (Source 3)`. Preserve existing sections (Mancini, Focus 25, etc.).

6. **Cross-reference with Mancini.** Read the Mancini section of today's brief:
   - Flag alignment: "DP and Mancini both watching ES [level] zone" → higher confidence
   - Flag divergence: "DP bearish but Mancini sees FB setup for longs at [level]"
   - If no Mancini section exists, skip cross-reference

7. **Deliver summary.** One message to Simon:
   - Bias, number of orders generated, top conviction idea
   - Any VERIFY items that need his attention
   - Cross-reference findings (alignment/divergence)
   - If before 6:00 AM PT: "Included in premarket brief"
   - If after 6:00 AM PT: deliver as a **DP Update** supplement

## Workflow: VTF Alerts

1. **Parse alert lines.** Each line is a trade action. Extract:
   - Action: SHORT, LONG, COVERED, TRIMMED, FLAT, ADDED, SOLD
   - Ticker: resolve typos per DP.md (mera→META, queues→QQQ, etc.)
   - Price: if stated
   - Context: any qualifier ("half", "starter", "full size", "aggressive")

2. **Map to trade-journal commands.** Per `references/DP.md` Pot B mirror rules:
   - SHORT/LONG → `trade-journal log B <side> <qty> <symbol> --notes "VTF: <original text>" --execute`
   - COVERED/FLAT → `trade-journal close B <symbol> --notes "VTF: <original text>" --execute`
   - TRIMMED/SOLD → `trade-journal close B <symbol> --qty <partial> --notes "VTF: <original text>" --execute`
   - ADDED → `trade-journal log B <side> <qty> <symbol> --notes "VTF: added" --execute`

3. **Size per DP.md rules.**
   - Planned trades: full size (up to 15% of pot per position)
   - Scalps: half size
   - 1% risk rule: max ~$333 risk per trade on $33K pot
   - Use `quote <symbol>` for current price if not stated in alert
   - Run `risk_governor.py check` before execution

4. **Execute Pot B mechanically.** No discretion — mirror DP exactly:
   - When he enters, we enter
   - When he exits, we exit
   - When he says FLAT, close all Pot B positions for that ticker

5. **Confirm to Simon.** One batched message:
   - Positions taken/closed
   - Current Pot B state (exposure, open positions)
   - Any risk governor blocks

6. **Append to daily brief.** Add VTF events to the DP section of `memory/trading-YYYY-MM-DD.md` as an event log.

## Rules

- **Mechanical for Pot B.** No discretion on VTF mirroring. DP's calls are followed exactly.
- **Never fabricate.** Don't invent prices, levels, or positions DP didn't state. Flag VERIFY for ambiguous content.
- **Batch VTF alerts.** If multiple alerts arrive close together, batch into one message + one set of trade-journal commands. Don't send one message per alert.
- **Don't nag about missing DP.** If Simon hasn't pasted the AM Call yet, note "DP section pending" once. Don't ask again.
- **Risk governor is the hard gate.** Every trade passes through `risk_governor.py check` before execution. If blocked, report to Simon and don't override.

## References

- `references/DP.md` — DP methodology, conviction scoring, sizing, trade types, Pot B rules
- `references/analyze-dp.md` — AM Call extraction contract, standard ORDER format output
- `references/STANDARD_ORDER_FORMAT.md` — Shared ORDER block format
- `references/TRADING_PIPELINE.md` — Signal routing (Source 2 and Source 5 sections)
- `references/TRADING_SOP.md` — Phase 3 (FOCUS) and Phase 4 (EXECUTE)

## Requires

- `dp-brief` workspace tool (for AM Call parsing)
- `trade-journal` workspace tool (for Pot B execution)
- `quote` workspace tool (for price verification)
- `risk_governor.py` (for pre-trade constraint checks)
