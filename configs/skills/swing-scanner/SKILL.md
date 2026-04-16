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

Scan these watchlists (from `WATCHLISTS.json`):
1. `dp_watchlist` — DP/Inner Circle frequent names (primary scan)
2. `portfolio` — Current holdings and key indices
3. `swing_candidates` — Previously identified candidates (refresh this list)

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

For each setup found, score using DP.md conviction framework:
- **21-day pullback on quality name:** HIGH conviction
- **200-day pullback on quality name:** HIGH conviction
- **RS leader with volume:** MEDIUM conviction
- **Volume surge near MA:** MEDIUM conviction
- **RS laggard short:** LOW conviction (reference only)
- **Day-after trade:** MEDIUM conviction (conditional on range establishment)

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

Refresh `swing_candidates` in WATCHLISTS.json with current scanner hits:
- Add new candidates that passed screens
- Remove candidates that are no longer valid (broke below stop levels)
- Keep the list to max 10 symbols

### 6. Write to Daily Brief

Append scanner findings to `memory/trading-YYYY-MM-DD.md` under a scanner section. Don't overwrite existing content — append or update.

### 7. Alert on High-Conviction Setups

If a HIGH conviction setup is found:
- Alert Simon: "[SCANNER] NVDA pulling back to 21-day MA at $118.50 — DP entry zone"
- Don't alert for MEDIUM or LOW — they go into the brief for next-day synthesis

For routine scans with no new setups: log silently, don't message.

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
- `WATCHLISTS.json` (for scan targets)
