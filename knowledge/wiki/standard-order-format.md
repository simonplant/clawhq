---
tags: [system, order-format, execution]
date: 2026-04-15
source-count: 3
confidence: established
last-verified: 2026-04-15
---

# Standard Order Format

All source extractors produce this identical format. One format, one monitoring loop, one execution path. Plain text, key:value pairs — no markdown tables, no JSON.

## ORDER Block

```
ORDER N | [conviction] | [status]
  source:     [mancini / dp / focus25 / scanner]
  pot:        [A / B / C]
  ticker:     [symbol]
  exec_as:    [execution symbol, e.g. SPY for ES]
  direction:  [LONG / SHORT]
  setup:      [type] — "[quality words ≤20 words]"
  why:        [what makes this actionable ≤15 words]
  entry:      [price] LMT
  stop:       [price] — [source: stated / MA-2% / flush-4 / derived]
  t1:         [price] (75%)
  t2:         [price] (15%)
  runner:     10% trail BE after T1
  risk:       [per share] | [qty] shares | $[total]
  caveat:     [warning verbatim or "none"]
  kills:      [dp_flat, gap_killed, level_broken, etc.]
  activation: [what must happen first, or "immediate"]
  verify:     [what needs checking, or "none"]
```

## Conviction Levels

| Level | Meaning | Action | DP numeric |
|-------|---------|--------|-----------|
| HIGH | Strong endorsement | Full size, LIMIT | 0.70+ |
| MEDIUM | Conditional/moderate | Half size, LIMIT | 0.50-0.69 |
| LOW | Speculative | Watch only | 0.30-0.49 |
| Exclude | Warned against | Omit | <0.30 |

See [[dp-conviction-scoring]] for DP language mapping. See [[mancini-extraction-rules]] for Mancini quality word mapping.

## Status Values

| Status | Meaning |
|--------|---------|
| ACTIVE | Live, monitoring in progress |
| CONDITIONAL | Waiting for activation condition |
| TRIGGERED | Entry condition met, execution pending |
| FILLED | Position opened |
| CLOSED | Position closed |
| KILLED | Invalidated by kill condition |
| BLOCKED | Risk governor rejected |

## CONTEXT Block (source-specific)

**Mancini:** source, bias, bull_ctrl, bear_trig, chop, calendar, runner
**DP:** source, bias, outlook, positions, calendar

## Supplementary Sections

**Mancini:** SHORTS (reference), LEVELS (S/R grid), SCENARIOS (hold/lose paths)
**DP:** ANALYST ACTIONS, DAT CANDIDATES, SECTOR THEMES

Agent monitors ORDER blocks only. Supplementary sections are for context.

## Related

- [[dp-extraction-rules]] — Produces DP ORDER blocks
- [[mancini-extraction-rules]] — Produces Mancini ORDER blocks
- [[pot-system]] — ORDER `pot` field routes to A/B/C
