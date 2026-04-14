---
name: mancini-fetch
description: "Fetch Adam Mancini's latest Futures Daily post and extract the trading plan into Quick Brief format (v4.0-QR). Writes to memory/trading-YYYY-MM-DD.md for heartbeat, premarket-brief, and EOD review. Call when Simon asks for Mancini's plan, or via cron at 14:30 PT weekdays (fallback 19:00 PT). NOT for: general market data (use quote), live level monitoring (use heartbeat)."
---

# mancini-fetch

Fetches Mancini's latest Substack post and produces an ultra-compact Quick Brief following `references/EXTRACT_MANCINI.md` (v4.0-QR format). Purely declarative — the agent does the extraction; no regex scripts.

## Procedure

1. **Check cache.** Read `memory/trading-YYYY-MM-DD.md`. If it already contains a `## SETUPS` section under `## Mancini (Source 1)` and `--force` was not passed, return the existing brief and exit.

2. **Fetch raw post.** Run `substack read mancini`. If the result is empty or an error, log to daily memory and abort — do not fabricate.

3. **Apply the extractor SOP.** Load `references/EXTRACT_MANCINI.md` as the extraction contract. It defines:
   - What to skip (the ~75% boilerplate before "Trade Plan [Day]")
   - Setup extraction in code block format (Low/Flush/Accept/Entry/Stop/T1/T2/Run)
   - Max 3 setups (most actionable only)
   - Conviction mapping from his quality words
   - Level grid as bullet lists
   - Runners as one-liners
   - Scenarios as hold/lose paths
   - 2000 word max, word budget per section
   - Quality checklist

4. **Produce the Quick Brief.** Output must match the format in `references/EXTRACT_MANCINI.md` exactly:
   - Header with ES price, regime, mode, volatility
   - TL;DR (one sentence)
   - SETUPS section with code blocks (no prose paragraphs)
   - LEVELS as bullet lists
   - RUNNERS as one-liners with protection mode
   - SCENARIOS as two paths + expect line
   - EXECUTION line
   - YESTERDAY line (carry from previous day)

5. **Write to daily brief.** Write the Quick Brief to `memory/trading-YYYY-MM-DD.md` under the `## Mancini (Source 1)` section. Preserve existing sections from other sources (DP, Focus 25, Overnight, Market Context, Ranked Ideas, Calendar).

6. **Return.** Emit a one-line Telegram-ready summary: `Mancini Brief — YYYY-MM-DD | [regime] | [top setup summary]`. The full brief lives in the file.

## Hard rules (from references/EXTRACT_MANCINI.md)

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
- `references/EXTRACT_MANCINI.md` in workspace root (v4.0-QR extraction contract)
- `references/MANCINI.md` in workspace root (methodology reference for edge cases)

## Reference

- `references/EXTRACT_MANCINI.md` — the v4.0-QR extraction contract (what to parse, what to emit, output format)
- `references/MANCINI.md` — Mancini's methodology (Failed Breakdowns, acceptance types, protection mode)
- `references/TRADING_SOP.md` — six-phase daily process this skill feeds into
