---
name: mancini
description: Parse Mancini ES trading posts into quick briefs with ranked setups. Triggers on "pull mancini", "trading brief", "today's levels", or cron auto-pull.
metadata:
  { "openclaw": { "emoji": "📊", "requires": { "bins": ["curl", "jq"] } } }
---

# Mancini Trading Intelligence

Parses Adam Mancini's Substack posts into ultra-compact quick briefs. Writes daily briefs to `memory/trading-YYYY-MM-DD.md`. Checks levels during heartbeats.

Before first use, read `{baseDir}/references/methodology.md` for the Mancini framework.
Before parsing, read `references/EXTRACT_MANCINI.md` for the v4.0-QR extraction rules and output format.

## Workflows

### pull — Fetch and parse latest post

1. Fetch: `curl -s "https://adamsmancini.substack.com/api/v1/posts?limit=1" | jq '.[0]'`
2. If body truncated or paywalled, `web_fetch` the post URL.
3. If unavailable, report "Post not accessible." Stop.
4. Read `references/EXTRACT_MANCINI.md` (the v4.0-QR extraction contract).
5. Skip everything before "Trade Plan [Day]" per the skip list.
6. Extract setups in ultra-compact code block format: Low/Flush/Accept/Entry/Stop/T1/T2/Run. Max 3 setups.
7. Extract flat level grid as bullet lists (no prose).
8. Extract runners as one-liners, protection mode status.
9. Extract two scenario paths (hold/lose) and one "Expect" line.
10. Write `memory/trading-YYYY-MM-DD.md` in the Quick Brief format defined in EXTRACT_MANCINI.md.
11. Carry forward runners/positions from previous day's brief if it exists.
12. Total output must be under 2000 words. Code blocks for setups, bullet lists for levels, no paragraphs in setups section.
13. Confirm to user: regime, top setup with confidence, protection mode, level count.

### check — Heartbeat level monitoring

1. Read `memory/trading-YYYY-MM-DD.md`. If missing, skip.
2. Get ES price via `quote ES`.
3. Alert thresholds:
   - Within 10 pts of setup flush target → "Approaching #N zone"
   - Within 5 pts → "In flush zone. Watch recovery above [level]"
   - Price recovers an FB level → "#N FB triggered. [Acceptance type] watch."
   - Price in 0-5pt Danger Zone above recovered low → "Danger Zone — no entry without acceptance"
   - T1/T2 hit → alert with scale instruction
4. Suppress non-critical alerts 11:00 AM - 2:00 PM EST (mid-day chop).
5. Update execution log in brief.

### wrap — Post-session update

1. Read today's brief.
2. For each setup: triggered? Acceptance confirmed? Targets hit?
3. Mode: Was session Mode 1 (trend) or Mode 2 (trap)?
4. Update protection mode.
5. Carryforward: held levels keep, broken levels flagged, runners carry with updated stops.
6. Add YESTERDAY line for next day's brief.

## Rules

- Only extract levels Mancini explicitly states. Never invent.
- Never assign HIGH confidence without strong conviction language ("massive", "obvious", "highest odds", "A+", "powerful").
- All setups in code block format — no prose paragraphs in the setups section.
- R:R ratios required for every target.
- Acceptance duration required for every setup.
- Generate trade signals for Simon's review — he executes his own trades. Clawdius may trade his own Tradier account independently.
- Mancini posts only. No other authors.
