---
tags: [system, order-format, execution]
date: 2026-04-16
source-count: 3
confidence: established
last-verified: 2026-04-16
---

# Standard Order Format

All source extractors produce this identical format. One format, one monitoring loop, one execution path.

**Authoritative spec:** `references/STANDARD_ORDER_FORMAT.md` — the full field definitions and formatting rules. This wiki page summarizes the key concepts.

## ORDER Block (summary)

Plain text, key:value pairs. Each block is self-contained — everything needed to monitor and execute.

Key fields: `source`, `accounts`, `ticker`, `exec_as`, `direction`, `entry`, `stop`, `t1`, `t2`, `runner`, `risk`, `confirmation`, `confluence`, `conviction`, `status`, `kills`, `activation`, `verify`.

## Conviction Levels

| Level | Action | DP numeric |
|-------|--------|-----------|
| HIGH | Full size, LIMIT | 0.70+ |
| MEDIUM | Half size, LIMIT | 0.50-0.69 |
| LOW | Watch only | 0.30-0.49 |
| Exclude | Omit | <0.30 |

See [[dp-extraction-rules]] for DP language and conviction mapping. See [[mancini-extraction-rules]] for Mancini quality word mapping.

## Confirmation

All extractors emit `PENDING_TA`. TA enrichment evaluates levels against indicators and upgrades to `CONFIRMED` where warranted. Simon can override to `MANUAL`.

The heartbeat treats `PENDING_TA` as watch-only and `CONFIRMED`/`MANUAL` as actionable alerts.

## Confluence

When same ticker appears in multiple sources with aligned direction -> merged block with `confluence: DP+MANCINI`. When they disagree -> both blocks with `divergence` flag. Simon decides.

## Status Lifecycle

CONDITIONAL -> TRIGGERED -> FILLED -> CLOSED (or KILLED / BLOCKED at any point)

**Current mode: alert-only.** Heartbeat detects and alerts. Simon executes. Autonomous execution is a separate future phase with its own gate.

## How It Flows

1. **Extractors** ([[dp-extraction-rules]], [[mancini-extraction-rules]]) produce ORDER blocks with `confirmation: PENDING_TA`
2. **TA enrichment** evaluates levels, upgrades to `CONFIRMED` where warranted
3. **Daily brief** (`## Orders` section) accumulates blocks from all sources
4. **Premarket-brief** detects confluence/divergence, ranks by conviction + confirmation
5. **Heartbeat** monitors proximity, alerts Simon (alert-only)
6. **EOD review** categorizes as TRIGGERED/NEAR/WATCH

## Related

- [[dp-extraction-rules]] — Produces DP ORDER blocks
- [[mancini-extraction-rules]] — Produces Mancini ORDER blocks
- [[account-system]] — ORDER `accounts` field routes to tos/ira/tradier
