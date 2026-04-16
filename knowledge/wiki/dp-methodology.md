---
tags: [methodology, dp, inner-circle, stocks, swing]
date: 2026-04-16
source-count: 2
confidence: established
last-verified: 2026-04-16
---

# DP Methodology

David Prince / Inner Circle trading system. Theme-driven stock trading with core position model. Source: AM Calls (transcriptions) and VTF intraday alerts.

## Core Philosophy

- **Theme-driven:** Identify market themes, determine when they'll work, commit aggressively
- **Environment reader:** Assess climate first, then select trades within it
- **Anticipate demand:** "Would everyone else want this?" not "Do I like this?"
- **50% failure rate:** Enter with open mind. Management is what matters.
- **Do less in tough markets:** Singles and doubles, not home runs

## Three Signal Layers

DP's system produces signals at three layers with different reliability:

| Layer | Source | Reliability | Use |
|-------|--------|------------|-----|
| **AM Call thesis** | DP's morning transcript | Directional bias + watchlist. Levels are aspirational — moderators rarely wait for them. | Set the watchlist and bias for the day. NOT executable entries. |
| **VTF alerts** | Real-time chat posts | Actual entries at market prices. Time-sensitive. | Generate ORDER blocks at current price (not AM Call level). |
| **Kira's execution** | Moderator trade log | Optimal timing and position management. Kira enters names DP identifies but at market prices with precise timing. | Reference for entry timing, trim cadence, reversal patterns. |

**Critical insight:** DP says "AMZN buyable at 241" (AM Call). Kira buys AMZN calls at $248 (execution). The AM Call sets the thesis. Kira's timing is the actual signal. Track the gap between thesis level and execution price.

## Core Position Model

1. **Identify quality names** — strong earnings, market leadership, clear levels
2. **Buy quality in the hole** — pullbacks to key MAs (8d, 10d, 21d, 200d)
3. **Build core** — enter at MA, size based on conviction
4. **Trade around core** — trim strength, add pullbacks, trail stops
5. **Swing high quality** — hold winners overnight ("gifting positions")
6. **Go flat when uncertain** — cash is a position

## Trade Types

| Type | Sizing | Hold | DP's Language |
|------|--------|------|---------------|
| **Core swing** | Full | Days-weeks | "my favorite name", "sizable position", "I'm aggressive" |
| **Planned** | Full | Day-swing | "if it pulls back to X, I'm a buyer" |
| **Event** | Moderate | Day | "positive into the print", "day-after trade" |
| **RS play** | Moderate | Intraday-day | "showing relative strength", "red-to-green" |
| **Scalp** | Small | Minutes-hours | Not called as special |
| **Lotto** | Tiny | Day | "cute short", "might work", "lazy long" |

## Key Technical Levels

| Level | Significance |
|-------|-------------|
| **8-day MA** | Short-term momentum, first pullback support |
| **10-day MA** | "I'd be interested" entry level |
| **21-day MA** | Primary swing level — "most profitable trades are longs from 21-day near previous high" |
| **50-day MA** | Intermediate trend |
| **200-day MA** | Major — "sizable position" entries |
| **VWAP** | Intraday reference |

## Risk and Money Management

- **1% Rule:** Max risk per trade = 1% of capital
- **3-4 positions max** at any time
- **Take profits quickly:** Lower targets, "look for less"
- **Go to cash when needed:** Don't force trades

See [[dp-extraction-rules]] for language -> conviction mapping.
See [[dp-extraction-rules]] for parsing AM Calls and VTF alerts.

## Entry Patterns

- **Buy quality in the hole:** Pullback to key MA -> buy level, stop below
- **Relative strength:** RS stocks go red-to-green (long), weak stocks drop faster (short)
- **Post-earnings day-after:** Pro-gap -> day-after range -> enter above day-after high
- **Buy-the-dip on events:** Ignore "sell-the-news", set up for bounce
- **Retests signal weakness:** Repeated retests without bounce -> flush coming

## Related

- [[dp-extraction-rules]] — Extraction rules including conviction scoring
- [[dp-extraction-rules]] — AM Call and VTF parsing
- [[mancini-methodology]] — Complementary ES futures approach
- [[account-system]] — Account sizing and constraints
