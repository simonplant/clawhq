# STANDARD_ORDER_FORMAT.md — Unified Trade Plan Output

All source extractors (Mancini, DP, Focus 25, swing scanner) produce this IDENTICAL format. The agent reads one format. The heartbeat monitors one format. The premarket-brief synthesizes one format.

Plain text, key:value pairs, no markdown tables — easier for a local LLM to parse reliably.

---

## Structure

```
=== TRADE PLAN: [source] | [date] ===

CONTEXT:
  source:    [mancini / dp / focus25 / scanner]
  bias:      [directional lean or regime description]
  ... source-specific fields (see below) ...
  calendar:  [risk events today]

---

ORDER 1 | [conviction] | [status]
  ... fields ...

ORDER 2 | [conviction] | [status]
  ... fields ...

---

WATCH:
  - [ticker] [level]: [reason <=15 words] (LOW)

---

[Source-specific supplementary sections]
```

---

## CONTEXT Block (source-specific)

### Mancini context:
```
CONTEXT:
  source:    mancini
  bias:      [his lean <=15 words]
  bull_ctrl: [level] — [reason <=8 words]
  bear_trig: [level]
  chop:      [low]-[high] or none
  calendar:  [risk events today]
  runner:    [entry] -> +[PL]pts | 10% trailing
```

### DP context:
```
CONTEXT:
  source:    dp
  bias:      [BULLISH / LEAN BULLISH / MIXED / LEAN BEARISH / BEARISH]
  outlook:   [his summary <=20 words]
  positions: [SHORT META @ 583, LONG NVDA @ 118] or "flat"
  calendar:  [risk events today]
```

---

## ORDER Block (identical across all sources)

Every ORDER block is self-contained. Each one has everything needed to monitor and execute. No cross-referencing other sections.

```
ORDER N | [conviction] | [status]
  source:       [mancini / dp / focus25 / scanner]
  accounts:     [tos / ira / tradier] (comma-separated if multiple eligible)
  ticker:       [symbol]
  exec_as:      [execution symbol, e.g. SPY for ES]
  direction:    [LONG / SHORT]
  setup:        [type] — "[quality words or thesis <=20 words]"
  why:          [what makes this actionable <=15 words]
  entry:        [price] LMT
  stop:         [price] — [source: stated / MA-2% / flush-4 / next support / derived]
  t1:           [price] (75%) — [source: stated / next R / estimated]
  t2:           [price] (15%) — [source: stated / estimated]
  runner:       10% trail BE after T1
  risk:         [amount per share] | [qty] shares | $[total risk]
  confirmation: [PENDING_TA / CONFIRMED / MANUAL]
  confluence:   [none / DP+MANCINI / DP+FOCUS25 / etc.]
  caveat:       [warning verbatim from source or "none"]
  kills:        [conditions that invalidate: dp_flat, gap_killed, level_broken, etc.]
  activation:   [for CONDITIONAL: what must happen first, or "immediate"]
  verify:       [what needs checking, or "none"]
```

### Field definitions:

| Field | Required | Description |
|-------|----------|-------------|
| `source` | Yes | Which extractor produced this order |
| `accounts` | Yes | Eligible accounts: tos, ira, tradier (comma-separated). Filtered by account constraints. |
| `ticker` | Yes | The instrument being analyzed (e.g. ES, META) |
| `exec_as` | Yes | The symbol to actually trade (e.g. SPY when ticker is ES) |
| `direction` | Yes | LONG or SHORT |
| `setup` | Yes | Trade type + quality words from the source |
| `why` | Yes | One-line actionability reason |
| `entry` | Yes | Entry price + order type (LMT/MKT) |
| `stop` | Yes | Stop price + how it was derived |
| `t1` | Yes | First target (75% scale) + derivation |
| `t2` | Yes | Second target (15% scale) + derivation |
| `runner` | Yes | Runner rule (typically 10% trail BE after T1) |
| `risk` | Yes | Per-share risk, quantity, total dollar risk |
| `confirmation` | Yes | TA confirmation state (see Confirmation below) |
| `confluence` | Yes | Cross-source agreement, or "none" |
| `caveat` | Yes | Source's warning verbatim, or "none" |
| `kills` | Yes | Conditions that invalidate the order |
| `activation` | Yes | What must happen before order is live, or "immediate" |
| `verify` | Yes | What needs human checking, or "none" |

### Confirmation field:

All Phase 2 skills emit `PENDING_TA`. The ta-enrichment skill (Phase 3) evaluates whether TA supports the level and upgrades to `CONFIRMED`. Simon can override to `MANUAL` for discretionary trades.

| Value | Meaning |
|-------|---------|
| `PENDING_TA` | Signal generated from source, TA confirmation not yet applied |
| `CONFIRMED` | TA enrichment confirms level aligns with indicators (MA support, RSI, volume) |
| `MANUAL` | Simon manually confirmed or overrode — execute at his discretion |

**The heartbeat treats these differently:**
- `PENDING_TA` — alert as "watch only, TA unconfirmed"
- `CONFIRMED` — alert as "TRIGGERED, execute?"
- `MANUAL` — alert as "TRIGGERED" (Simon already confirmed)

### Confluence field:

When the same ticker appears in multiple sources with aligned direction and overlapping entry zones, emit a single merged ORDER with the confluence field set. When sources disagree on the same ticker, emit both ORDER blocks with `divergence` noted.

| Value | Meaning |
|-------|---------|
| `none` | Single-source signal |
| `DP+MANCINI` | Both sources aligned on direction and level zone |
| `DP+FOCUS25` | DP signal + Focus 25 RS confirmation |
| `divergence: [see ORDER N]` | Same ticker, opposing direction or conflicting levels — both blocks emitted |

### Conviction levels:

Categorical labels used across all sources. When scoring, map source-specific language to these categories:

| Level | Meaning | Action | DP numeric range |
|-------|---------|--------|-----------------|
| **HIGH** | Source explicitly endorses with strong language | Full size, LIMIT order | 0.70+ |
| **MEDIUM** | Conditional or moderate language | Half size, LIMIT at level | 0.50-0.69 |
| **LOW** | Weak or speculative | Watch list only, no order | 0.30-0.49 |
| **Exclude** | Source explicitly warns against | Omit entirely | <0.30 |

See `knowledge/trading/wiki/dp-conviction-scoring.md` for DP language mapping. See `knowledge/trading/wiki/mancini-extraction-rules.md` for Mancini quality word mapping.

### Status values:

| Status | Meaning |
|--------|---------|
| `ACTIVE` | Order is live, monitoring in progress |
| `CONDITIONAL` | Waiting for activation condition |
| `TRIGGERED` | Entry condition met, execution pending |
| `FILLED` | Position opened |
| `CLOSED` | Position closed |
| `KILLED` | Invalidated by a kill condition |
| `BLOCKED` | Risk governor rejected (reason logged) |

---

## Supplementary Sections (source-specific)

These sections provide context. The agent monitors ORDER blocks only. Supplementary sections are for Simon's context and discretionary thesis generation.

### Mancini supplementary:
```
SHORTS (reference only):
  - [level]: trigger below [bounce low] — [caveat]

LEVELS:
  S: **[major]** [minor] **[major]** [minor] ...
  R: **[major]** [minor] **[major]** [minor] ...

SCENARIOS:
  hold [level]: -> [path]
  lose [level]: -> [path]
```

### DP supplementary:
```
ANALYST ACTIONS:
  - [TICKER]: [firm] [action] PT $[target] — [DP's take or "no comment"]

DAT CANDIDATES:
  - [TICKER]: [event] — [DP's lean]

SECTOR THEMES:
  - [theme <=10 words]
```

---

## Formatting Rules

1. **Plain text, not markdown tables** — predictable, greppable, no ambiguity
2. **Key: value pairs** — one field per line, consistent indentation
3. **ORDER blocks are self-contained** — everything needed to monitor and execute in one block
4. **Same field names across all sources** — `source`, `pot`, `ticker`, `exec_as`, `direction`, `entry`, `stop`, `t1`, `t2`, `risk`, `conviction`, `status`, `kills`, `activation`, `verify`
5. **CONTEXT block is source-specific** — different sources have different context fields, but under the same label pattern
6. **Supplementary sections are source-specific** — LEVELS, SCENARIOS for Mancini; ANALYST ACTIONS, SECTOR THEMES for DP

---

## How This Format is Used

1. **Extractors** (mancini-fetch, dp-parse, focus25-fetch, swing-scanner) produce ORDER blocks with `confirmation: PENDING_TA`
2. **TA enrichment** (Phase 3) evaluates levels against indicators, upgrades to `CONFIRMED` where warranted
3. **Daily brief** (`memory/trading-YYYY-MM-DD.md` `## Orders` section) accumulates ORDER blocks from all sources
4. **Premarket-brief** reads all ORDER blocks, detects confluence/divergence, ranks by conviction + confirmation, outputs the morning brief
5. **Heartbeat** reads ORDER blocks, monitors proximity, alerts Simon (alert-only — Simon executes)
6. **EOD review** reads ORDER blocks, categorizes as TRIGGERED/NEAR/WATCH, reports accuracy
