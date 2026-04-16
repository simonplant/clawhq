---
tags: [extraction, dp, conviction, sizing]
date: 2026-04-15
source-count: 1
confidence: established
last-verified: 2026-04-15
---

# DP Conviction Scoring

How to map David Prince's language to conviction levels and trade sizing. Used by [[dp-extraction-rules]] when parsing AM Calls.

## Language → Conviction

### HIGH (0.70+) — Full size, LIMIT order
- "My favorite name", "go nuts", "game time", "definitely a buyer"
- "Sizable position at X", "I'm aggressive here"
- Voice rises with excitement — "game time" signal
- Quality name at key MA (21d or 200d) with earnings support

### MEDIUM (0.50-0.69) — Half size, LIMIT at level
- "I'm a buyer at X", "I'd be interested at X"
- "It'd be buyable at X", "where might it be viable"
- "I'd probably add" — building on existing position
- Level identified but entry conditional ("if it pulls back")

### LOW (0.30-0.49) — Watch only, no order
- "Cute short", "might be a cute short"
- "Not excited", "lazy long"
- Level mentioned without conviction language

### AVOID (<0.30) — Skip entirely
- "Not right", "something's off", "off the table"
- "Don't chase" — gap killed the setup

**Only HIGH and MEDIUM generate ORDER blocks.** LOW → WATCH section. AVOID → omit.

## Position Actions (Language → Signal)

| DP says | Signal |
|---------|--------|
| "Started a short/long" | NEW position |
| "Added to" | SIZING into existing |
| "Sold most of" | TRIMMING winner |
| "Got flat" | CLOSED position |
| "Lazy long" | LOW conviction entry |
| "Gifting positions" | Holding overnight to trim next day |

## Pot B Sizing Rules

- **Planned trades:** full size (up to 15% of pot)
- **Scalps:** half size
- **1% rule:** max ~$333 risk per trade (1% of $33K pot)
- **Max 3-4 concurrent positions**
- **Max 60% exposure**
- Follow DP's flat calls exactly — when he says FLAT, close all

## Cross-Reference with Mancini

| Dimension | DP | Mancini |
|-----------|----|---------| 
| Instrument | Individual stocks + QQQ/SPY | ES futures |
| Timeframe | Day + swing (overnight) | Intraday ES |
| Entry style | Theme + RS + MAs | Failed Breakdowns + flush zones |
| Sizing | Conviction-based, 1% risk | Protocol-based (75/15/10) |

When both sources align on a level → higher confidence. When they disagree → note divergence, each pot follows its own source.

## Related

- [[dp-methodology]] — Core trading system
- [[dp-extraction-rules]] — AM Call and VTF parsing
- [[mancini-methodology]] — Complementary approach
- [[pot-system]] — Pot allocation and sizing
