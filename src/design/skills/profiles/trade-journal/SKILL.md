# trade-journal

Paper trading journal skill for Markets profiles. Logs hypothetical trades with entry thesis, strategy tag, and outcome tracking — enabling multi-strategy performance review without risking capital. Designed for users developing and validating trading strategies before going live.

## Behavior

1. Capture trade — When the user declares a paper trade (entry or exit), record: symbol, direction (long/short), entry price, size, strategy tag (e.g. "momentum", "mean-reversion", "earnings-play"), and the entry thesis (why this trade, what's the expected move).
2. Track open positions — Maintain a running log of open paper positions with current P&L calculated from live quotes via the quote tool.
3. Record exits — When the user closes a paper position, record: exit price, actual P&L, hold duration, and outcome notes (thesis confirmed, invalidated, or stopped out).
4. Tag strategies — Every trade is tagged with a strategy name. Multiple strategies can run in parallel. The journal tracks each strategy's win rate, average P&L, and risk/reward ratio independently.
5. Generate strategy report — On demand or weekly, produce a per-strategy performance summary: total trades, win rate, average winner vs average loser, largest drawdown, and Sharpe-like consistency metric.
6. Report — Deliver the strategy report or open position summary via the messaging channel.

## Boundaries

- No real trading. This skill is exclusively for paper trades. It never connects to brokerage accounts, places real orders, or manages real capital.
- No data leaves the machine. All journal entries and calculations are local. Market quotes use allowlisted finance API domains only.
- No financial advice. Strategy reports are descriptive statistics, not recommendations. The skill does not suggest trades or predict outcomes.
- User-initiated only. Trades are logged only when the user explicitly declares them. The skill does not auto-detect or suggest trade entries.

## Schedule

Strategy reports run weekly (default: Friday after market close) via cron. Open position tracking is available on demand. As configured in the blueprint.

## Execution

This is a declarative skill. The cron scheduler triggers the agent with "Run skill: trade-journal" for weekly reports. The agent reads this SKILL.md for behavior definitions and processes the trade log.

## Model Requirements

- Provider: Local Ollama preferred (cloud escalation configurable per blueprint)
- Minimum model: any tool-capable local model (runtime uses the deployment default)
- Cloud escalation: optional — cloud models may improve strategy analysis narratives
