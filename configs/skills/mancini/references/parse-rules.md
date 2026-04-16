# Parse Rules: Mancini Post → Quick Brief

The primary extraction contract is `knowledge/trading/wiki/mancini-extraction-rules.md` (v4.0-QR). This file covers supplementary parsing guidance not in the main contract.

## Setup Classification

For each trade setup Mancini describes, classify:

| Field | What to capture |
|-------|----------------|
| Level | The price number |
| Level type | Prior Day Low / Multi-Hour Low (timestamp) / Shelf (test count) / Overnight Shelf / Opening Low (which session) / Broken Shelf / Squeeze Origin / Intraday Pivot |
| Grade | Major (meets FB criteria: PDL, 20+ pt move, or 3+ test shelf) or Minor |
| Direction | Long FB / Backtest Short |
| Conditions | "Controlled sell only" / "Only if X fails" / "Desperation" / None |
| Acceptance | Type 1, Type 2, or Non-Acceptance — assign per methodology.md rules based on expected flush depth |

## Conviction Scoring

Score each setup using three factors:

**Language signal:**
- High: "massive", "primary", "highest odds", "obvious", "much more obvious", "A+", "powerful", "clear significant low", "I get very interested"
- Medium: "fairly strong", "decent", "big", "actionable", "quality Failed Breakdown"
- Low: "if nothing else works", "desperation", "last resort", "lower quality", "may be an entry"
- Exclude: "would not bid/engage", "too well tested", "risky", "I won't take this"

**Grade:** Major > Major-conditional > Minor

**Execution clarity:** Full chain specified > partial > just mentioned

Only the top 3 setups make it into the Quick Brief SETUPS section. Others appear in LEVELS only.

## Common Parsing Pitfalls

- Mancini often says "bid X" meaning he'd enter long there, but with conditions buried later in the paragraph. Read the full context before classifying.
- "Knife-catching" / "free fall" / "full speed" = Non-Acceptance protocol. Do NOT assign Type 1/2 to these.
- Levels listed as flush targets (e.g. "ideally tags 6723") are NOT entry levels — they're where price goes before recovering. Don't rank them as setups.
- "Desperation" entries are real but should never rank HIGH.
- When he says a level is "well tested and weaker," that's a downgrade signal — the level above or below it is probably the real setup.
