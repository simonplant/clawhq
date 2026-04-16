# TRADING_SOP.md — Daily Trading Standard Operating Procedure

Six-phase cycle. Every trading day, every phase, no skipping.

```
RESEARCH → PLAN → FOCUS → EXECUTE → MANAGE → REVIEW
```

The morning is about **preparation, not chatter**. All overnight energy goes into building one excellent trade plan. Simon wakes to a brief, not 50 messages.

---

## Phase 1: RESEARCH (Prior close → 5:00 AM PT next day)

**Goal:** Progressively fill in tomorrow's trading brief. Each cron/event writes to the same file. By morning the brief is mostly complete — the PLAN phase just synthesizes and ranks.

**Timing:** Starts at prior day's close, runs through overnight. All automated — no Simon involvement. Must be complete by 5:00 AM PT so PLAN phase can start.

### The Brief is a Working Draft

`memory/trading-YYYY-MM-DD.md` starts as a scaffold and gets filled in by each step:

```
# Trading Brief: YYYY-MM-DD (Day)

## Mancini (Source 1)
[Filled by mancini-fetch at 2:30 PM PT prior day]
[Regime, ranked setups, level grid, protection mode]

## Focus 25 (Source 2)
[Filled by focus25-fetch at 4:30 PM PT prior day]
[Market posture, RS leaders/laggards, actionable tickers]

## DP/Inner Circle (Source 3)
[Filled when Simon pastes AM Call → dp-brief]
[Bias, positions, key levels, analyst actions, catalysts]
[PENDING until Simon pastes]

## Overnight Intelligence
[Accumulated by x-scan + news overnight]
[Trading-relevant X posts, macro developments]

## Market Context
[Filled by premarket-brief at 5:00 AM — futures, VIX, oil, bonds]

## Ranked Trade Ideas
[Filled by premarket-brief at 6:00 AM — synthesized from all above]
[Order-ready: LIMIT price, targets, stop, risk, source confidence]

## Calendar Risk
[Filled by premarket-brief — earnings, FOMC, NFP, speeches]
```

Each section is independent. A cron fills its section without touching others. If a section is still empty at 6 AM, the premarket-brief notes "pending" and works with what's available.

### Who Fills What, When

| Time | Event | Section filled |
|------|-------|----------------|
| 2:30 PM PT (prior day) | `mancini-fetch` cron | **Mancini** — regime, setups, levels |
| 4:30 PM PT (prior day) | `focus25-fetch` cron | **Focus 25** — posture, RS, movers |
| 7:00 PM PT (fallback) | `mancini-fallback` cron | **Mancini** — retry if primary missed |
| Overnight | `x-scan` crons | **Overnight Intelligence** — accumulate, don't deliver |
| Overnight | `heartbeat` crons | **Overnight Intelligence** — news, macro |
| 5:00 AM PT | First heartbeat | **Market Context** — futures snapshot, VIX, oil |
| 5:30 AM PT (typical) | Simon pastes DP AM Call | **DP/Inner Circle** — via `dp-brief` |
| 6:00 AM PT | `premarket-brief` cron | **Ranked Trade Ideas** + **Calendar Risk** — synthesize all sections into order-ready signals |

### Key Rule: BATCH OVERNIGHT OUTPUT

**Do not send Simon 50 messages overnight.** All overnight research goes into the brief file, not Telegram:
- X scan findings → append to **Overnight Intelligence** section of the brief
- News → append to same section
- Email triage → summarize in brief or daily memory
- Heartbeats overnight → `HEARTBEAT_OK` unless genuinely urgent

**Only break silence overnight for:**
- Market circuit breaker / flash crash
- Urgent personal email requiring immediate response
- System failure (cron errors, API down)

---

## Phase 2: PLAN (5:00 AM - 6:00 AM PT)

**Goal:** Synthesize the already-filled sections into ranked, order-ready trade ideas. **Must be complete by 6:00 AM PT** so Simon has time to place LIMIT orders before the open.

**Timing:** 5:00 AM PT start. Premarket-brief cron fires at 6:00 AM PT as the hard deadline.

### What's Already in the Brief by 5:00 AM

The draft should have these sections filled from Phase 1:
- **Mancini** ✅ (filled at 2:30 PM prior day)
- **Focus 25** ✅ or pending (filled at 4:30 PM prior day, if email arrived)
- **Overnight Intelligence** ✅ (accumulated by x-scan + heartbeats overnight)
- **DP/Inner Circle** ❓ (pending until Simon pastes — don't wait for it)

### What PLAN Phase Does (5:00-6:00 AM)

1. **Fill Market Context**: `quote ES=F NQ=F YM=F CL=F GC=F ^VIX ^TNX` — futures, VIX, oil, bonds right now
2. **Fill Calendar Risk**: earnings, FOMC, NFP, speeches — anything that could move the market today
3. **Check section completeness**: note which sections are filled vs pending
4. **Synthesize Ranked Trade Ideas**: read all filled sections, cross-reference levels, rank by conviction, output order-ready signals
5. **Fill Ranked Trade Ideas section**: the final synthesis — LIMIT prices, stops, targets, risk

**Don't wait for DP.** Build the best plan from what you have. When Simon pastes the DP AM Call, update the plan and deliver a supplement.

### When Simon Pastes DP AM Call

Process immediately regardless of phase:
1. Detect format → pipe through `dp-brief`
2. Append DP section to today's trading brief
3. Cross-reference with Mancini levels — flag alignment and divergence
4. If pre 6:00 AM → cron brief will include the DP section automatically
5. If post 6:00 AM → deliver a **DP Update** supplement with new levels, positions, and any changes to the ranked ideas

### The Morning Brief (Single Deliverable — by 6:00 AM PT)

The premarket-brief cron (6:00 AM PT) produces **one message** — Simon's trade plan for the day. This is what he uses to place LIMIT orders.

```
=== Pre-Market Brief — YYYY-MM-DD ===

MARKET CONTEXT
[Futures, overnight moves, macro drivers, VIX/oil/bonds]

OVERNIGHT INTELLIGENCE
[Batched X findings, news digest — only the high-signal items]

TODAY'S TRADE IDEAS (order-ready)
#1  [Symbol] [Direction] @ [Level] — [Conviction: HIGH/MED] [Trade type]
    LIMIT: [buy/sell] [price]
    Stop: [level]  Targets: [T1, T2]
    Risk: $[amount] per share × [qty] = $[total] ([pct]% of account)
    DP says: "[exact quote]"
    Sources: [DP / Mancini / Both aligned]
#2  ...

WATCH LIST (no orders — monitor only)
- [Symbol] @ [level] — [LOW conviction reason] — alert if reaches level

KEY LEVELS TO WATCH
[Unified level grid: Mancini ES levels + DP stock levels + Focus 25 movers]

CALENDAR RISK
[Earnings, FOMC, NFP, speeches — anything that could move the market today]

ACCOUNT STATUS
tos:     [positions or "flat"] — Simon executes (full capability)
ira:     [positions or "flat"] — Simon executes (long-only)
tradier: [positions or "flat"] — Clawdius's own (alert-only)
```

**Trade ideas must be order-ready.** Not "watch this area" — give Simon a price to set a LIMIT order at, a stop, and targets. If the conviction isn't high enough for a specific limit price, it's a WATCH, not a trade idea.

**Quality bar:** If this brief isn't worth Simon's time, don't send it. A one-line "quiet pre-market, Mancini levels unchanged, no DP call yet" is better than filler.

---

## Phase 3: FOCUS (6:00 AM - 6:30 AM PT / market open)

**Goal:** Simon places LIMIT orders from the plan. Clawdius answers questions and monitors for DP VTF alerts.

**Timing:** Brief delivered at 6:00 AM. **Order-ready signals by 6:10 AM** — Simon enters LIMIT orders 6:10-6:30 AM before the bell.

### What Simon Does

1. Reads the brief
2. **Places LIMIT orders** in his trading platform for the day's top ideas
3. Pastes DP AM Call if he hasn't already (Clawdius processes and supplements)
4. Pastes early DP VTF alerts if the VTF is active pre-market
5. Asks Clawdius for clarification on levels, sizing, or conviction

### What Clawdius Does

1. **Score each trade idea per `DP.md`** — apply conviction scoring and trade type classification. Output HIGH + MEDIUM ideas as order-ready signals, LOW as watch list.
2. **Output order-ready signals** — LIMIT price, stop, targets, risk, DP's exact words. See brief template below.
3. **Be available and responsive** — Simon is placing orders, answer questions fast
4. **Process VTF alerts** as they arrive — parse, update brief, generate ORDER blocks for eligible accounts
5. **If DP AM Call arrives now**: process via `dp-brief`, score ideas, deliver supplement
6. **Size calculations on request**: output exact share quantities based on risk rules in `DP.md`

### Key Rule: FOCUS MEANS FEWER MESSAGES

- Don't send updates unless Simon asks or a level is being tested RIGHT NOW
- Don't send "market is opening" — Simon knows
- Don't repeat information from the brief
- If Simon asks "what should I buy?", refer back to the brief's ranked ideas — don't generate new ones
- One message with all pre-open VTF alerts (batched), not one per alert

---

## Phase 4: EXECUTE (9:30 AM - 4:00 PM ET)

**Goal:** Trade the plan. React to signals, not to noise.

**Timing:** Market hours. Heartbeat monitors every 30 min.

### DP Signals — Advisory

When Simon pastes VTF alerts:
1. `vtf-parse` → structured events
2. Size per account: tos ($100K, 1% risk), ira ($100K, long-only — skip shorts), tradier ($3K, alert-only)
3. Present sized ORDER blocks to Simon for tos/ira execution
4. Log to `trade-journal log <account> ...` for each eligible account

When DP posts FLAT/COVERED:
1. `vtf-parse` detects close action
2. Flag all accounts holding that ticker for closure
3. Report P&L on closed positions per account

### Mancini Signals — Level-Triggered

Heartbeat every 15 min during market hours:
1. Read brief → find `## Orders` section → extract Mancini ORDER blocks
2. `tradier quote ES=F` → compare to flush targets (use tradier for real-time, not Yahoo)
3. Within 10 pts of flush target → log to memory (don't bother Simon)
4. Within 5 pts → alert Simon: "ES approaching [setup] zone at [price]"
5. Acceptance confirmed → `risk_governor.py check` → present to Simon for tos/ira execution, log for tradier
6. Follow Mancini protocol: T1 scale (75%), T2 scale (15%), runner (10%) with trailing stop at BE
7. ES → SPY conversion: 1 ES point ≈ $0.18 on SPY. Monitor ES via `tradier quote ES=F`, execute as SPY.
8. IRA: eligible for long setups only. Tradier: alert-only mode.

### Scanner / Swing Ideas — Discretionary

Clawdius's own analysis. Uses all sources plus own TA:
1. Identify setups from brief + real-time data
2. Generate ORDER blocks for all eligible accounts
3. `trade-journal log <account> ...` with thesis in `--notes`
4. Simon executes on TOS/Fidelity; tradier is alert-only

### Trade Signals for Simon

Throughout the day, surface actionable setups when levels are tested:
- "ES hitting Mancini Rank 1 zone (5530). Recovery watch above 5525."
- "DP's META short at 583 — stock at 581, approaching. Still in resistance zone."
- Only when price is AT the level, not when it's 50 points away

### Key Rule: TRADE THE PLAN

- Don't generate new ideas during market hours — trade what was planned
- Don't second-guess the brief — the research phase is over
- Exceptions: breaking news (earnings surprise, policy change) that invalidates the plan

---

## Phase 5: MANAGE (Concurrent with EXECUTE)

**Goal:** Protect capital, take profits, manage risk.

**Timing:** Continuous during market hours.

### Position Monitoring

Every heartbeat (30 min):
1. `trade-journal positions` — check all account positions
2. `tradier quote <symbol>` for each position
3. Alert on:
   - Position >2% against entry (approaching stop)
   - Position hitting T1 target (time to scale out)
   - Account exposure approaching 60% limit
   - Any account down >5% for the day

### Risk Rules (per account)

- **tos** ($100K): 1% risk per trade ($1,000), max 15% per position ($15K), max 60% exposure ($60K), 3-4 positions max
- **ira** ($100K): 1% risk per trade ($1,000), max 15% per position ($15K), long-only, no margin, no shorting, no day trading
- **tradier** ($3K): 1% risk per trade ($30), max 15% per position ($450), full capability but alert-only mode
- **Halt an account if down >10% from allocation** — review before resuming

### Simon's Signals Management

When Simon's signals are active:
- Monitor prices vs the signal's targets and stop
- "Your META short signal from this morning: stock at 575, approaching T1 (573). Consider scaling."
- Don't spam — only when actionable (at target, at stop, or significant move)

---

## Phase 6: REVIEW (4:15 PM ET → evening)

**Goal:** Mark to market, assess what worked, feed lessons into tomorrow.

**Timing:** After market close. EOD review cron at 4:15 PM ET.

### EOD Checklist

1. **Mark to market**: `trade-journal mark`
2. **Compare accounts**: `trade-journal compare` — tos vs ira vs tradier vs SPY
3. **Reconcile**: `trade-journal reconcile` — journal matches broker positions?
4. **Level review**: Which Mancini levels triggered? Which DP targets hit?
5. **Signal review**: Which signals to Simon were correct? Which missed?

### EOD Report (Single Deliverable)

```
=== EOD Review — YYYY-MM-DD ===

MARKET SUMMARY
[ES close, % change, session character (trend/chop/reversal)]

ACCOUNT PERFORMANCE
tos ($100K TOS):       $X P&L (+Y%)  [positions: ...]
ira ($100K Fidelity):  $X P&L (+Y%)  [positions: ...]
tradier ($3K Tradier): $X P&L (+Y%)  [positions: ...]
SPY benchmark:         +Z%

LEVEL ACCURACY
[Which setups triggered? Which levels held? What was the regime?]

TOMORROW'S SETUP
[Mancini pull running at 2:30 PM — key carryforward levels/positions]
```

### Feed Forward

- Open positions carry into tomorrow's RESEARCH phase (per account)
- Lessons learned → `memory/trading-YYYY-MM-DD.md` notes section
- If an account is consistently losing → flag for halt review
- Mancini pull (2:30 PM PT) begins tomorrow's RESEARCH phase automatically

---

## Phase Ownership

| Phase | Time (PT) | Primary Owner | Simon's Role | Clawdius Autonomy |
|-------|-----------|--------------|--------------|-------------------|
| RESEARCH | Close → 5 AM | Clawdius (cron) | Sleeps | Full — gather, scan, accumulate |
| PLAN | 5:00-6:00 AM | Clawdius + Simon | Pastes DP AM Call | Full for synthesis; Simon triggers DP input |
| FOCUS | 6:00-6:30 AM | Simon | Places LIMIT orders by 6:10 AM | On standby — answer questions, process VTF |
| EXECUTE | 6:30 AM-1 PM | Both | Pastes VTF alerts, manages orders | Advisory for tos/ira; autonomous for tradier (alert-only) |
| MANAGE | Concurrent | Clawdius | Reviews alerts | Monitors all accounts; advisory for Simon |
| REVIEW | 1:15 PM → evening | Clawdius (cron) | Reads EOD report | Full — mark, compare, reconcile |

---

## Anti-Patterns

Things Clawdius must NOT do:

- **50 overnight messages**: Batch everything into the morning brief
- **Repeating the brief**: If Simon read the brief, don't re-summarize it later
- **Generating new ideas during EXECUTE**: Trade the plan, don't reinvent it mid-day
- **Alert fatigue**: Only alert when price is AT a level, not approaching from 50 points away
- **Nagging about DP AM Call**: If Simon hasn't pasted it, note "pending" once. Don't ask again.
- **Report noise as signal**: HEARTBEAT_OK is the right answer when nothing is happening
- **Over-managing Simon**: Surface the signal, let him decide. Don't chase him for updates.

---

## Signal Source Routing

How trading signals flow from source to action: INGEST → PARSE → BRIEF → DETECT → EXECUTE → REPORT.

| Source | Ingest | Parse | Brief Section | Detect | Execute | Accounts |
|--------|--------|-------|---------------|--------|---------|----------|
| Mancini | mancini-fetch cron 2:30 PM PT | v4.0-QR extraction | Mancini (Source 1) | Heartbeat: ES price vs levels | tos,ira (longs),tradier (alert) | tos,ira,tradier |
| DP AM Call | Simon pastes into Telegram | dp-brief tool | DP (Source 3) | Heartbeat: stock prices vs levels | tos,ira (longs),tradier (alert) | tos,ira,tradier |
| DP VTF | Simon pastes alerts | dp-parse detects action lines | DP events | Immediate — alerts ARE triggers | tos,ira (longs),tradier (alert) | tos,ira,tradier |
| Focus 25 | focus25-fetch cron 4:30 PM PT | Email HTML parsing | Focus 25 (Source 2) | Premarket cross-reference | Informs all accounts | tos,ira,tradier |
| X Intelligence | x-scan cron every 15 min | Quality filter | Overnight Intelligence | Cross-ref with brief levels | Alert Simon | — |
| Swing Scanner | Hourly during market hours | ta tool + earnings | Scanner section | ORDER blocks monitored | tos,ira (longs),tradier (alert) | tos,ira,tradier |

**Rule:** Human-curated signals (Mancini, DP) take priority over algorithmic (scanner) when they conflict.

## Heartbeat Trading Integration

During market hours (Mon-Fri, 9:30 AM - 4:00 PM ET), heartbeat MUST:

1. **Read the brief:** `memory/trading-YYYY-MM-DD.md` — find `## Orders` section, extract ORDER blocks
2. **Check positions:** `trade-journal positions` — know what's open across accounts
3. **Fetch real-time prices:** `tradier quote ES=F` for Mancini, `tradier quote <symbol>` for stock positions
4. **Monitor ORDER blocks:** For each ACTIVE/CONDITIONAL order, check proximity to entry/stop/targets
5. **Alert on trigger:** `risk_governor.py check` → present to Simon for tos/ira execution, log for tradier
6. **Scale-out on targets:** T1 hit → close 75%. T2 hit → close 15%. Runner trails at BE.
7. **Cross-reference sources:** Mancini + DP agree on level → higher confidence. Disagree → flag divergence.
8. **When nothing near a level:** `HEARTBEAT_OK` — don't report noise.

## Pipeline Health Checks

In each heartbeat during market hours, verify:
- Today's trading brief exists and has Mancini section
- DP section present (if Simon has pasted AM call or VTF alerts)
- Account positions match expectations (no phantom trades)
- No stale prices in portfolio state (mark if >4h old)

**Missing data escalation:**
- No Mancini brief by 7 PM PT → mancini-fallback handles it
- No Focus 25 by 8 PM PT → note in daily log, carry forward
- No DP AM Call by 9:30 AM ET → note "DP pending" in brief. Don't nag Simon.

## Reference Documents

| Doc | Purpose |
|-----|---------|
| `knowledge/trading/` | Trading wiki — methodology, extraction rules, conviction, account system |
| `STANDARD_ORDER_FORMAT.md` | Unified ORDER block spec (also in wiki as [[standard-order-format]]) |
| `trade-journal` tool | Account trade logging (tos/ira/tradier) |
| `risk_governor.py` | Hard constraint enforcement |
