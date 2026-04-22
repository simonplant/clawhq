# eod-review (SUPERSEDED)

> **This is the generic blueprint version.** The full trading eod-review with Phase 6 REVIEW
> (mark-to-market, pot comparison, level accuracy, feed-forward) lives at
> `configs/skills/eod-review/SKILL.md` and is what gets deployed for the life-ops profile.

End-of-day market review skill for Markets profiles. After market close, pulls the day's price action for the user's watchlist and portfolio, compares against morning expectations or open positions, and delivers a concise performance summary with notable movers and sector trends.

## Behavior

1. Fetch closing data — Pull end-of-day prices, volume, and daily change for all watchlist symbols and portfolio holdings using the quote tool.
2. Compare against positions — For each held position, calculate daily P&L (unrealized), percentage change, and distance from stop-loss or target levels if configured.
3. Identify movers — Flag symbols with outsized moves (>2% daily change), unusual volume (>1.5x average), or new 52-week highs/lows within the watchlist.
4. Sector summary — Group watchlist and portfolio by sector. Report sector-level performance to surface rotation patterns.
5. Review against morning notes — If a morning scan or trade plan was logged earlier in the day, compare actual outcomes against expectations. Note hits, misses, and surprises.
6. Report — Deliver a structured end-of-day summary via the messaging channel: portfolio P&L, notable movers, sector performance, and any divergences from the morning plan.

## Boundaries

- No trade execution. This skill reviews and reports only. It never places orders, modifies positions, or interacts with brokerage APIs.
- Read-only. The skill reads market data and prior journal entries but does not modify positions, watchlists, or configuration.
- No data leaves the machine beyond configured finance APIs. Market data is fetched via allowlisted domains only.
- Informational only. All observations and comparisons are delivered as information for user review, not as trading recommendations.

## Schedule

Runs once daily after market close (default: 4:30 PM ET) via cron, as configured in the blueprint. Can also be triggered on demand.

## Execution

This is a declarative skill. The cron scheduler triggers the agent with "Run skill: eod-review". The agent reads this SKILL.md for behavior definitions and analyzes the day's market data against the user's portfolio and watchlist.

## Model Requirements

- Provider: Local Ollama preferred (cloud escalation configurable per blueprint)
- Minimum model: any tool-capable local model (runtime uses the deployment default)
- Cloud escalation: optional — cloud models may improve sector analysis and pattern recognition
