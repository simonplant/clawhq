---
tags: [extraction, dp, conviction]
date: 2026-04-15
source-count: 1
confidence: established
last-verified: 2026-04-15
---

# DP Conviction Scoring

How to map David Prince's language to conviction levels. Used by [[dp-extraction-rules]] when parsing AM Calls and by the heartbeat when evaluating ORDER blocks.

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

For sizing rules and pot constraints, see [[pot-system]].

## Related

- [[dp-methodology]] — Core trading system
- [[dp-extraction-rules]] — AM Call and VTF parsing
- [[pot-system]] — Account system and sizing rules
