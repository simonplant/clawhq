---
name: mancini-fetch
description: "Fetch Adam Mancini's latest Futures Daily post and extract the trading plan into Quick Brief format (v4.0-QR). Writes to memory/trading-YYYY-MM-DD.md for heartbeat, premarket-brief, and EOD review. Call when Simon asks for Mancini's plan, or via cron at 14:30 PT weekdays (fallback 19:00 PT). NOT for: general market data (use quote), live level monitoring (use heartbeat)."
---

# mancini-fetch

Fetches Mancini's latest Substack post and produces an ultra-compact Quick Brief following `knowledge/trading/wiki/mancini-extraction-rules.md` (v4.0-QR format). Purely declarative — the agent does the extraction; no regex scripts.

## Procedure

0. **Scaffold brief if needed.** Check if `memory/trading-YYYY-MM-DD.md` exists (using tomorrow's date if running at 2:30 PM PT, today's date if running in the morning). If the file does not exist, create it with this scaffold:

   ```markdown
   # Trading Brief: YYYY-MM-DD (Day)

   ## Mancini (Source 1)
   [Pending — mancini-fetch]

   ## Focus 25 (Source 2)
   [Pending — focus25-fetch]

   ## DP/Inner Circle (Source 3)
   [Pending — Simon pastes AM Call]

   ## Overnight Intelligence
   [Accumulated by x-scan + heartbeat overnight]

   ## Market Context
   [Filled by premarket-brief at 6:00 AM PT]

   ## Ranked Trade Ideas
   [Filled by premarket-brief — synthesized from all above]

   ## Calendar Risk
   [Filled by premarket-brief]

   ## Orders
   [Active ORDER blocks from all sources]
   ```

   Replace YYYY-MM-DD with the target date and Day with the weekday name. This scaffold is the shared structure that all other skills (focus25-fetch, dp-parse, premarket-brief, heartbeat) read and write to.

1. **Check cache.** Read `memory/trading-YYYY-MM-DD.md`. If it already contains a `## SETUPS` section under `## Mancini (Source 1)` and `--force` was not passed, return the existing brief and exit.

2. **Fetch raw post.** Run `substack read mancini`. If the result is empty or an error, log to daily memory and abort — do not fabricate.

3. **Apply the extractor SOP.** Load `knowledge/trading/wiki/mancini-extraction-rules.md` as the extraction contract. It defines:
   - What to skip (the ~75% boilerplate before "Trade Plan [Day]")
   - Setup extraction in code block format (Low/Flush/Accept/Entry/Stop/T1/T2/Run)
   - Max 3 setups (most actionable only)
   - Conviction mapping from his quality words
   - Level grid as bullet lists
   - Runners as one-liners
   - Scenarios as hold/lose paths
   - 2000 word max, word budget per section
   - Quality checklist

4. **Produce the Quick Brief.** Output must match the format in `knowledge/trading/wiki/mancini-extraction-rules.md` exactly:
   - Header with ES price, regime, mode, volatility
   - TL;DR (one sentence)
   - SETUPS section with code blocks (no prose paragraphs)
   - LEVELS as bullet lists
   - RUNNERS as one-liners with protection mode
   - SCENARIOS as two paths + expect line
   - EXECUTION line
   - YESTERDAY line (carry from previous day)

5. **Write to daily brief.** Write the Quick Brief to `memory/trading-YYYY-MM-DD.md` under the `## Mancini (Source 1)` section. Also produce standard ORDER blocks (per `references/STANDARD_ORDER_FORMAT.md`) for each HIGH/MEDIUM setup and append them to the `## Orders` section. Preserve existing sections.

6. **Log ORDER blocks to journal.** For each ORDER block produced:
   ```
   journal append order '{"source":"mancini","pot":"C","ticker":"ES","exec_as":"SPY","direction":"LONG","conviction":"HIGH","entry":5530,"stop":5518,"status":"CONDITIONAL","activation":"recovery above 5525 with acceptance"}'
   ```

7. **Return.** Emit a one-line Telegram-ready summary: `Mancini Brief — YYYY-MM-DD | [regime] | [top setup summary]`. The full brief lives in the file.

## Hard rules (from mancini-extraction-rules)

- **Never fabricate** R:R ratios, confidence percentages, acceptance durations, or any level not in the source.
- **All setups in code block format** — no prose paragraphs in setups section.
- **Max 3 setups** — only the most actionable. Others go to LEVELS section.
- **R:R ratios required** for every T1/T2/Runner target.
- **Acceptance duration required** for every setup.
- **Under 2000 words total** — enforce the word budget.
- If post unavailable, report and stop. Never generate from memory or prior days.

## Callers

| Caller | When | Purpose |
|---|---|---|
| Cron `mancini-fetch` | 14:30 PT weekdays | Write tomorrow's Mancini section |
| Cron `mancini-fallback` | 19:00 PT weekdays | Retry if primary missed |
| `premarket-brief` | 06:00 PT weekdays | Reads the brief mancini cron wrote |
| `heartbeat` (market hours) | every 30 min | Reads setups to monitor levels |
| Direct | Any time Simon asks | "What's Mancini's plan today?" |

## Requires

- `CRED_PROXY_URL` env var (Substack cookies injected server-side, SEC-022)
- `substack` workspace tool
- `knowledge/trading/wiki/mancini-extraction-rules.md` (v4.0-QR extraction contract)
- `knowledge/trading/wiki/mancini-methodology.md` (methodology reference for edge cases)

## References

- `knowledge/trading/` — trading wiki (query for mancini-methodology, mancini-extraction-rules)
- `references/TRADING_SOP.md` — daily cycle, phases, signal routing
