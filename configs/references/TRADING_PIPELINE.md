# TRADING_PIPELINE.md — Signal Flow & Event Routing

How trading signals flow from source to action. Every signal follows the same pipeline:

```
INGEST → PARSE → BRIEF → DETECT → EXECUTE → REPORT
```

## Signal Sources

### Source 1: Mancini (Substack) — AUTOMATED
| Stage | How | When |
|-------|-----|------|
| Ingest | `mancini-fetch` cron | Weekdays 2:30 PM PT (fallback 7 PM PT) |
| Parse | `mancini-fetch.py` extracts levels, setups, regime | Same cron |
| Brief | Writes `memory/trading-YYYY-MM-DD.md` Mancini section | Same cron |
| Detect | **Heartbeat** checks ES price vs Rank 1-3 setups | Every 30 min during market hours |
| Execute | Pot C: `trade-journal log C ...` when setup triggers | Heartbeat or work-session |
| Report | Telegram alert on trigger, EOD via `trade-journal mark` | As triggered + 4:15 PM ET |

**Trigger rules for Pot C (Mancini mirror):**
1. Read today's `memory/trading-YYYY-MM-DD.md` — extract ranked setups
2. Fetch ES price: `quote ES=F`
3. If price within 10 pts of a Rank 1-3 flush target → alert Simon: "Approaching Rank N zone"
4. If price enters flush zone (within 5 pts) → alert: "In flush zone. Watch recovery above [level]"
5. If acceptance confirmed (price recovers level, holds) → log Pot C trade as SPY equivalent
6. Follow Mancini protocol: scale at T1, T2, runner with trailing stop
7. **Clawdius executes Pot C mechanically** — no discretion, follow protocol per MANCINI.md

### Source 2: DP/VTF Alerts — SEMI-AUTOMATED
| Stage | How | When |
|-------|-----|------|
| Ingest | Simon pastes VTF alerts into Telegram | Throughout trading day |
| Parse | `vtf-parse` (auto-detected, see routing rules below) | On receipt |
| Brief | Append DP section to `memory/trading-YYYY-MM-DD.md` | After parse |
| Detect | Immediate — alerts ARE the triggers | On receipt |
| Execute | Pot B: `vtf-parse --pot-b` → `trade-journal log B ...` | On receipt |
| Report | Confirm trade logged + Tradier execution status | Immediately |

**When Simon pastes VTF content, Clawdius must:**
1. Detect it's VTF content (trade actions, ticker mentions, DP/Kira patterns)
2. Pipe through `vtf-parse` — review parsed output for correctness
3. Run `vtf-parse --json` — append structured events to today's brief DP section
4. Run `vtf-parse --pot-b` — review generated commands, set appropriate qty
5. **Size per `DP.md`** trade type and conviction rules
6. Execute Pot B commands via `trade-journal log B ... --execute`
7. Confirm to Simon: positions taken, current Pot B state
8. **Mechanical** — mirror DP exactly. No discretion on entry/exit
9. **Reference:** `DP.md` for methodology, conviction mapping, sizing rules

**How to detect VTF content in a Telegram paste:**
- Contains trade action words: SHORT, LONG, COVERED, TRIMMED, FLAT, ADDED
- Contains known tickers (with or without $): META, QQQ, NVDA, SPY, etc.
- Contains DP-style typos: mera, emta, coverd, trimemd, shrot
- Multiple lines with trading language
- Simon explicitly says "VTF", "DP alerts", "parse this", etc.

### Source 3: Focus 25 (Email) — AUTOMATED
| Stage | How | When |
|-------|-----|------|
| Ingest | `focus25-fetch` cron checks FastMail | Weekdays 4:30 PM PT |
| Parse | HTML table extraction → structured data | Same cron |
| Brief | Appends Focus 25 section to trading brief | Same cron |
| Detect | Premarket brief cross-references next morning | 6 AM PT |
| Execute | Informs Pot A thesis (Clawdius's own analysis) | Next trading day |
| Report | Telegram summary of market posture + actionable tickers | Same cron |

### Source 4: X Intelligence — AUTOMATED
| Stage | How | When |
|-------|-----|------|
| Ingest | `x-scan` cron scans watchlist | Every 30 min, waking hours |
| Parse | Quality filter + sanitize | Same cron |
| Brief | **Should cross-reference** with today's trading brief | Same cron |
| Detect | Flag alignment/disagreement with brief levels | Same cron |
| Execute | Inform Pot A thesis; alert Simon on Mancini/DP X posts | Same cron |
| Report | Telegram with brief context if relevant | Same cron |

**X-scan trading integration:**
- When a scanned tweet mentions a level or ticker in today's brief, add context:
  "Mancini tweeted ES 5650 — aligns with brief Rank 2 target"
- When @AdamMancini4 or @epictrades1 posts, always cross-ref the brief
- Flag disagreements between sources (e.g., DP bearish but Mancini bullish)

### Source 5: DP AM Call — SEMI-AUTOMATED via `dp-brief`
| Stage | How | When |
|-------|-----|------|
| Ingest | Simon pastes Dropbox transcription into Telegram | ~5:30-6:30 AM PT |
| Parse | `dp-brief` extracts bias, positions, levels, analyst actions, catalysts | On receipt |
| Brief | Append parsed output to `memory/trading-YYYY-MM-DD.md` DP section | After parse |
| Detect | Levels become watch targets for heartbeat | Throughout day |
| Execute | Informs Pot B entries (alongside VTF alerts) | As DP trades |
| Report | Included in premarket brief if available | 6 AM PT or on receipt |

**When Simon pastes AM Call transcription:**
1. Detect longer-form text (paragraphs, not short alert lines) — different from VTF alerts
2. Pipe through `dp-brief` — extracts bias, positions, levels, analyst actions, catalysts
3. Review output — flag any transcription errors (speech-to-text artifacts)
4. Append to `memory/trading-YYYY-MM-DD.md` DP section
5. Cross-reference with Mancini levels — flag alignment and divergence
6. DP's levels become Pot B watch targets for the day

**Known `dp-brief` limitations (speech-to-text):**
- Dropbox transcription garbles tickers spoken quietly — review extracted tickers
- "58463" may be "584.63" — price sanity checker flags obvious errors
- "queues" → QQQ, "GE Vinova" → GEV handled automatically
- Natural language position detection is ~80% — manually add missed positions

## Heartbeat Trading Integration

During market hours (Mon-Fri, 9:30 AM - 4:00 PM ET), heartbeat MUST:

1. **Read the brief:** `memory/trading-YYYY-MM-DD.md` — check it exists and is today's date
2. **Check Pot B/C positions:** `trade-journal positions` — know what's open
3. **Fetch prices:** `tradier quote ES=F` for Mancini levels, `tradier quote <symbol>` for stock positions
4. **Monitor Mancini setups (Pot C):**
   - Rank 1-3 setups: check if ES is approaching flush targets
   - Within 10 pts → "Approaching zone" (log to daily memory, no Telegram)
   - Within 5 pts → alert Simon + prepare Pot C execution
   - Recovery confirmed → execute Pot C trade
5. **Monitor DP positions (Pot B):**
   - If Pot B has open positions, check current prices
   - Alert on significant moves (>2% or approaching DP's stated targets/stops)
6. **Cross-reference sources:**
   - If Mancini and DP agree on a level → higher confidence signal for Simon
   - If they disagree → flag the divergence

**When nothing is near a level:** `HEARTBEAT_OK` — don't report noise.

## Trade Signal Generation for Simon

Separate from Pot B/C paper trading. Clawdius generates trade ideas for Simon to review and execute manually on his own account.

**Daily signal output** (via premarket brief or on-demand):
```
=== Today's Ranked Setups ===

#1  ES 5530 FB — Mancini Rank 1 (65%) + DP watching same zone
    Entry: recovery above 5525 with acceptance
    Targets: 5564 (T1), 5593 (T2), runner
    Stop: below 5518
    Source agreement: HIGH (both sources aligned)

#2  META 520 short — DP AM Call short target
    Entry: rejection at 520 resistance
    Targets: 510, 505
    Stop: above 525
    Source: DP only (Mancini doesn't cover single names)
```

**Format:** Level, direction, entry conditions, targets, stop, source confidence.
**Scope:** Today's plan only — never carry stale signals forward.
**Simon executes:** Clawdius surfaces, Simon decides and trades.

## Pot Sizing Rules

**Pot constraints** (enforced by `trade-journal`):
- Max single position: 15% of pot
- Max total exposure: 60% of pot

**DP (Pot B):** Size per trade type and conviction in `DP.md` — core swings full size, scalps small, 1% risk rule.

**Mancini (Pot C):** ES levels → SPY stock equivalent. 1 ES point ≈ $0.18 on SPY. Use `tradier quote ES=F` for monitoring, `tradier quote SPY` for execution.

## EOD Reconciliation

Weekdays at market close (4:15 PM ET):
1. `trade-journal mark` — update all position prices
2. `trade-journal reconcile` — verify journal matches Tradier
3. `trade-journal compare` — pot-vs-pot-vs-SPY
4. Report any mismatches or notable P&L to Simon

## Pipeline Health Checks

**In each heartbeat during market hours, verify:**
- [ ] Today's trading brief exists and has Mancini section
- [ ] DP section present (if Simon has pasted AM call or VTF alerts today)
- [ ] Pot B/C positions match expectations (no phantom trades)
- [ ] No stale prices in portfolio state (mark if >4h old)

**Missing data escalation:**
- No Mancini brief by 7 PM PT → `mancini-fallback` handles it
- No Focus 25 by 8 PM PT → note in daily log, carry forward
- No DP AM call by 9:30 AM ET → note in premarket brief: "DP section pending — Simon hasn't pasted yet"
- Don't nag Simon about missing DP data — note it once, move on
