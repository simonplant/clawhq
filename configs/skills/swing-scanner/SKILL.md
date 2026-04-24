---
name: swing-scanner
description: "Hourly scan of watchlist symbols for DP-style swing setups: pullbacks to key MAs (8d/10d/21d/200d), relative strength leaders/laggards, post-earnings day-after candidates, and volume surges. Produces trade candidates for all eligible accounts and refreshes the swing_candidates watchlist. Runs hourly during market hours."
metadata:
  { "openclaw": { "emoji": "🔍", "requires": { "bins": ["python3", "curl", "jq"] } } }
---

# swing-scanner — Algorithmic Swing Setup Detection

Scans watchlist symbols hourly during market hours for DP-style swing trading setups. Generates trade candidates for all eligible accounts (tos, ira, tradier) based on technical analysis. This is the supplementary algorithmic signal source (priority 3) that complements the human-curated sources (Mancini priority 1, DP priority 1, Focus 25 priority 2).

Consult the trading wiki: `knowledge/trading/wiki/dp-methodology.md` for the trading methodology this scanner implements.

## Schedule

- **Cadence:** Hourly during market hours (9:30 AM - 4:00 PM ET)
- **Config:** `CONFIG.json` loops.swing (enabled, phase 2, hourly)
- **Not a cron skill** — triggered by the swing loop cadence in CONFIG.json

## Scan Targets

Scan these watchlists (from `markets/WATCHLISTS.json`):
1. `dp_watchlist` — DP/Inner Circle frequent names (primary scan)
2. `portfolio` — Current holdings and key indices
3. `swing_candidates` — Previously identified candidates (refresh this list)

## Today's Priority (read first, every run)

Before scanning, read `memory/trading-YYYY-MM-DD.md` (today's trading brief). From the `## Trade Ideas & Conviction` section, extract every ticker symbol mentioned (typically shown as `**TICKER:**` or `**TICKER (Company):**` in bold). This is today's **priority list** — the names Simon's premarket synthesis flagged as active or watch.

- If the file is missing, the section is empty, or no tickers parse cleanly: proceed with an **empty priority list**. The scanner degrades to its prior universe-wide behavior. This is a ranking hint, never a filter — a missing brief must not block scanning.
- The priority list does **not** narrow Step 2 (scanning). All watchlist names still get screened.
- The priority list **only** influences Step 3 (scoring). See the priority boost rule there.

Rationale: the brief reflects today's intentional focus (DP's AM calls, Mancini's levels, Simon's overnight thinking). Scanning the full universe but ranking with today's lens gives Simon louder signal on names he already cares about, while still catching unexpected setups on quality names outside the day's focus.

## Procedure

### 1. Fetch Technical Data

For each symbol in scan targets:
```
ta levels <symbol>
```
This returns: price vs key MAs, nearest MAs, DP entry zones, RSI, ATR, RVOL.

### 2. Screen for DP-Style Setups

Apply these screens in priority order:

**Screen A: Pullback to 21-day MA (DP primary entry)**
- Price within 2% of 21-day SMA
- RSI not oversold (<30 = skip, too risky)
- Volume not collapsing (RVOL > 0.5x)
- This is DP's most profitable trade: "most profitable trades are longs from 21-day near previous high"

**Screen B: Pullback to 200-day MA (DP major entry)**
- Price within 2% of 200-day SMA
- Quality name (in dp_watchlist = quality by definition)
- DP says "sizable position" entries happen here

**Screen C: Relative Strength Leaders**
- Price above all key MAs (8d, 10d, 21d, 50d)
- RSI between 50-70 (strong but not overbought)
- RVOL > 1.0x (institutional interest)
- These are DP's "showing relative strength" candidates

**Screen D: Relative Strength Laggards (short candidates)**
- Price below 21-day AND 50-day MA
- RSI below 40
- These are DP's "divergence" short candidates

**Screen E: Volume Surge**
- RVOL > 2.0x (unusual volume)
- Check if near a key MA level
- High volume at support = accumulation signal
- High volume at resistance = distribution signal

**Screen F: Post-Earnings Day-After Trade**
- Run `earnings check <symbol>` for each watchlist name
- If earnings were yesterday: check if stock gapped up/down
- Pro-gap (earnings beat + gap up) → day-after range establishes → long above day-after high
- This is DP's "day-after trade" pattern

### 3. Score and Rank

For each setup found, score using the conviction framework from `knowledge/trading/wiki/dp-extraction-rules.md` §Conviction Scoring:
- **21-day pullback on quality name:** HIGH conviction
- **200-day pullback on quality name:** HIGH conviction
- **RS leader with volume:** MEDIUM conviction
- **Volume surge near MA:** MEDIUM conviction
- **RS laggard short:** LOW conviction (reference only)
- **Day-after trade:** MEDIUM conviction (conditional on range establishment)

**Priority boost from today's brief.** If a ticker appears in today's priority list (see "Today's Priority" section above), bump its conviction one level:
- MEDIUM → HIGH
- LOW → MEDIUM
- HIGH stays HIGH (already at max)

Mark any boosted setup with `priority_source: brief` in the state file so downstream consumers can see which HIGH convictions are intrinsic vs. brief-promoted. Do not boost LOW short candidates (Screen D) above MEDIUM — the conviction framework treats shorts as reference-only regardless of brief priority.

Never demote. Absence from the priority list is not a signal; many quality setups won't have been on Simon's radar at 6 AM.

### 4. Produce ORDER Blocks

For HIGH and MEDIUM setups, produce standard ORDER blocks per `references/STANDARD_ORDER_FORMAT.md`.
Every ORDER must include `confirmation: PENDING_TA` and `confluence: none`:
```
ORDER N | [conviction] | CONDITIONAL
  source:       scanner
  accounts:     tos,ira,tradier
  ticker:     [symbol]
  exec_as:    [symbol]
  direction:  [LONG/SHORT]
  setup:      [screen type] — "[technical description]"
  why:        [why this is actionable now]
  entry:      [MA level or key price] LMT
  stop:       [MA - 2% for longs, or next support]
  t1:         [next resistance or +3%]
  t2:         [+5% or next major resistance]
  runner:     10% trail BE after T1
  risk:       [calculated from entry-stop]
  caveat:     [any risk factor]
  kills:      [below_ma, volume_dies, earnings_miss, etc.]
  activation: [what must happen: "pullback to 21d", "hold above gap", etc.]
  verify:     [human review needed: "check DP's take on this name"]
```

### 5. Update Watchlists

Refresh `swing_candidates` in `markets/WATCHLISTS.json` with current scanner hits:
- Add new candidates that passed screens
- Remove candidates that are no longer valid (broke below stop levels)
- Keep the list to max 10 symbols

### 6. Write scan state — always

Every run, overwrite `workspace/markets/scans/swing-setups.json` (create the `scans/` directory if missing). Use exec: `mkdir -p markets/scans && cat > markets/scans/swing-setups.json <<EOF ... EOF`. Schema:
```json
{
  "scanned_at": "YYYY-MM-DDTHH:MM:SSZ",
  "regime": "TRENDING_UP | CHOP | TRENDING_DOWN | HIGH_VOL",
  "priority_list": ["TICKER", ...],
  "priority_source": "memory/trading-YYYY-MM-DD.md | none",
  "screen_hits": {
    "21_day_pullback":    ["TICKER", ...],
    "200_day_pullback":   ["TICKER", ...],
    "rs_leaders":         ["TICKER", ...],
    "rs_laggards":        ["TICKER", ...],
    "volume_surge":       ["TICKER", ...],
    "earnings_day_after": ["TICKER", ...]
  },
  "active_candidates": ["TICKER", ...],
  "fresh_high_conviction": ["TICKER", ...],
  "brief_promoted": ["TICKER", ...],
  "orders_emitted": 0
}
```

`priority_list` records the tickers extracted from today's brief (empty array if none parsed). `priority_source` records where they came from (path of the brief file, or `none`). `brief_promoted` is the subset of `fresh_high_conviction` that got there via priority boost rather than intrinsic HIGH conviction. These fields let heartbeat and premarket synthesis distinguish signal types without re-parsing the brief.

This state file replaces, never accumulates. The premarket-brief and heartbeat read it; they don't re-scan.

### 7. Write to the daily trading brief — only on material change

Do NOT append a fresh "## Swing Scanner" section every run — that bloats the brief. Read the prior state file first. Write to `memory/trading-YYYY-MM-DD.md` ONLY if one of these is true:

- **First run of the day** — no `## Swing Scanner` section exists in today's brief yet.
- **New HIGH conviction setup** — a ticker in `fresh_high_conviction` that wasn't in the prior run's list.
- **Candidate list churn** — `active_candidates` added or removed vs prior run.
- **ORDER emitted** — `orders_emitted` increased since prior run.

When writing, **replace** the single `## Swing Scanner` section, don't append a new one. Use exec with sed/awk to find the existing `## Swing Scanner` heading, delete through the next top-level `## ` heading (or EOF), and insert the new section in its place. If no existing section, append at the end.

**One-time cleanup:** if the brief contains MULTIPLE `## Swing Scanner` headings (left over from a prior version of this skill that appended every run), collapse them: delete all existing Swing Scanner sections and their bodies, then insert a single fresh section. A simple approach: `awk '/^## Swing Scanner/{flag=1} /^## /{if(!/^## Swing Scanner/)flag=0} !flag' brief.md > brief.new && mv brief.new brief.md`, then append the one fresh section.

Content of the replaced section: one-line scan summary + `fresh_high_conviction` with specifics + `active_candidates` list + a link back to `markets/scans/swing-setups.json` for full detail. Keep it under 25 lines.

For quiet runs (no material change) the brief is untouched; the only side effects are the state file and the watchlist. Optionally append one timestamp+status line to `memory/DATE.md` (general daily memory) via exec echo >>, same pattern as x-scan.

### 8. Alert on High-Conviction Setups

If a HIGH conviction setup is *newly* in `fresh_high_conviction` (not present in prior state):
- Telegram Simon: "[SCANNER] NVDA pulling back to 21-day MA at $118.50 — DP entry zone"
- If the name was boosted from the priority list (appears in `brief_promoted`), append `— from today's brief`: "[SCANNER] META near 200-day SMA at $681 — from today's brief"
- Do not re-alert on setups that were already HIGH last run.
- Don't alert for MEDIUM or LOW — they appear in the brief's scanner section for next-day synthesis.

For routine scans with no material change: silent. The state file and general-memory line are enough audit trail.

## Boundaries

- **All eligible accounts.** Scanner generates candidates for tos, ira (long-only setups), and tradier. Account constraints filter eligibility (e.g., IRA can't take short ideas from Screen D).
- **No auto-execution.** Scanner produces ORDER blocks with status CONDITIONAL. Simon executes on TOS/Fidelity; tradier is alert-only.
- **Human-curated signals take priority.** Per CONFIG.json: "human-curated signals take priority over algorithmic when they conflict." If scanner and DP disagree on a name, note the divergence but defer to DP.
- **Don't spam.** Hourly scan, but only alert on HIGH conviction new setups. Most scans should be silent.

## References

- `knowledge/trading/` — trading wiki (query for dp-methodology, conviction scoring, trade types)
- `references/TRADING_SOP.md` — daily cycle, phases, signal routing
- `references/STANDARD_ORDER_FORMAT.md` — ORDER block format

## Requires

- `ta` workspace tool (for technical analysis)
- `quote` workspace tool (for current prices)
- `earnings` workspace tool (for day-after trade detection)
- `markets/WATCHLISTS.json` (for scan targets)
