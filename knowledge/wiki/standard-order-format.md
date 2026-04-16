---
tags: [system, order-format, execution]
date: 2026-04-15
source-count: 3
confidence: established
last-verified: 2026-04-15
---

# Standard Order Format

All source extractors produce this identical format. One format, one monitoring loop, one execution path.

**Authoritative spec:** `references/STANDARD_ORDER_FORMAT.md` — the full field definitions and formatting rules. This wiki page summarizes the key concepts.

## ORDER Block (summary)

Plain text, key:value pairs. Each block is self-contained — everything needed to monitor and execute.

Key fields: `source`, `pot`, `ticker`, `exec_as`, `direction`, `entry`, `stop`, `t1`, `t2`, `runner`, `risk`, `conviction`, `status`, `kills`, `activation`, `verify`.

## Conviction Levels

| Level | Action | DP numeric |
|-------|--------|-----------|
| HIGH | Full size, LIMIT | 0.70+ |
| MEDIUM | Half size, LIMIT | 0.50-0.69 |
| LOW | Watch only | 0.30-0.49 |
| Exclude | Omit | <0.30 |

See [[dp-conviction-scoring]] for DP language mapping. See [[mancini-extraction-rules]] for Mancini quality word mapping.

## Status Lifecycle

CONDITIONAL → TRIGGERED → FILLED → CLOSED (or KILLED / BLOCKED at any point)

The heartbeat monitors ORDER blocks and manages status transitions. Status changes are logged to the journal for audit.

## How It Flows

1. **Extractors** ([[dp-extraction-rules]], [[mancini-extraction-rules]]) produce ORDER blocks
2. **Daily brief** (`memory/trading-YYYY-MM-DD.md` `## Orders` section) accumulates them
3. **Premarket-brief** synthesizes and ranks across sources
4. **Heartbeat** monitors proximity, triggers, executes, scales
5. **EOD review** categorizes as TRIGGERED/NEAR/WATCH

## Related

- [[dp-extraction-rules]] — Produces DP ORDER blocks
- [[mancini-extraction-rules]] — Produces Mancini ORDER blocks
- [[pot-system]] — ORDER `pot` field routes to A/B/C
