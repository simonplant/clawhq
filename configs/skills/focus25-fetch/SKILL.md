---
name: focus25-fetch
description: "Fetch today's Focus 25 email from FastMail (from si.plant@gmail.com), parse market posture, RS leaders/laggards, biggest movers, and actionable cards. Appends Focus 25 section to memory/trading-YYYY-MM-DD.md. Source 2 of daily trading brief. Cron at 16:30 PT weekdays. NOT for: general email (use email-fastmail), live market data (use quote)."
metadata:
  { "openclaw": { "emoji": "📋", "requires": { "bins": ["curl", "jq", "python3"] } } }
---

# focus25-fetch — Focus 25 Email Parser

Fetches the daily Focus 25 email from FastMail and parses it into a structured section for the trading brief. Focus 25 provides end-of-day market posture, relative strength rankings, biggest movers, and actionable setups. This is Source 2 of the daily trading brief, feeding into tomorrow's premarket-brief synthesis.

## Schedule

- **Primary:** Cron at 4:30 PM PT weekdays (`30 16 * * 1-5`)
- **Fallback:** If email hasn't arrived, log "Focus 25 pending" in the brief. Next heartbeat checks again.
- **Direct:** Simon asks "get focus 25" or "check for focus email"

## Procedure

1. **Search FastMail.** Run:
   ```
   email-fastmail search --from "si.plant@gmail.com" --subject "Focus 25" --since today
   ```
   Look for today's Focus 25 email. The email arrives EOD from si.plant@gmail.com.

2. **Check cache.** Read `memory/trading-YYYY-MM-DD.md`. If it already has a `## Focus 25 (Source 2)` section with today's data and `--force` was not passed, return the existing data and skip.

3. **Read email body.** Use `email-fastmail read <message_id>` to get the full email content. The email contains HTML tables with market data.

4. **Extract structured data.** Parse the email for:

   **Market Posture:**
   - Overall market breadth (bullish/bearish/neutral)
   - Advance/decline ratio
   - New highs vs new lows
   - Sector breadth summary

   **RS Leaders (top relative strength):**
   - Ticker, RS score, sector, price change
   - These are stocks showing strength vs the market
   - Relevant for DP-style "relative strength" trades (Pot A thesis)

   **RS Laggards (weakest relative strength):**
   - Ticker, RS score, sector, price change
   - Potential short candidates or avoids
   - Relevant for divergence detection

   **Biggest Movers:**
   - Top gainers and losers by percentage
   - Volume context (unusual volume flag if >2x average)

   **Actionable Cards:**
   - Specific setups or alerts the Focus 25 report highlights
   - May include: breakouts, breakdowns, MA tests, volume surges

5. **Write to daily brief.** Append to `memory/trading-YYYY-MM-DD.md` under `## Focus 25 (Source 2)`:

   ```
   ## Focus 25 (Source 2)
   *Fetched: YYYY-MM-DD HH:MM PT*

   **Market Posture:** [bullish/bearish/neutral] — [breadth summary]
   Advance/Decline: [ratio] | New Highs: [N] | New Lows: [N]

   **RS Leaders:**
   - [TICKER] RS:[score] [sector] [+X%] [volume flag]
   - ...

   **RS Laggards:**
   - [TICKER] RS:[score] [sector] [-X%]
   - ...

   **Biggest Movers:**
   - [TICKER] [+/-X%] [volume context]
   - ...

   **Actionable:**
   - [TICKER]: [setup description] — [level if stated]
   - ...
   ```

6. **Cross-reference with watchlists.** Check if any Focus 25 names overlap with:
   - DP watchlist (from WATCHLISTS.json `dp_watchlist`)
   - Existing ORDER blocks in today's brief
   - Flag overlaps: "NVDA appears in Focus 25 RS leaders AND DP watchlist"

7. **Deliver summary.** One Telegram message:
   - Market posture (one line)
   - Top 3 RS leaders with scores
   - Any watchlist overlaps
   - "Full Focus 25 data written to daily brief"

## Boundaries

- **Read-only.** No trade execution. Focus 25 informs Pot A thesis and next-day premarket synthesis.
- **Email only.** Only reads from FastMail via `email-fastmail` tool. No other data sources.
- **No fabrication.** Only extract data present in the email. Don't invent RS scores or posture readings.
- **Informational.** Actionable cards are for Simon's review, not automatic execution.

## Fallback Behavior

- Email not found → log `Focus 25: not yet received (checked HH:MM PT)` in the brief section
- Email found but unparseable → log the error, include raw subject line, flag for Simon
- Multiple Focus 25 emails → use the most recent one

## References

- `references/TRADING_PIPELINE.md` — Source 3 routing
- `references/TRADING_SOP.md` — Phase 1 (RESEARCH), timing at 4:30 PM PT

## Requires

- `email-fastmail` workspace tool (for email search and read)
