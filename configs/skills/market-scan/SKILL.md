# market-scan

Periodic market monitoring skill for the Stock Trading Assistant agent. Scans market data on a scheduled cron, analyzes price movements and news, generates alerts for significant changes, and tracks watchlist positions — all delivered via the messaging channel for user review.

## Behavior

1. Fetch market data — Pull current prices and daily changes for watchlist symbols using the quote tool.
2. Scan news — Search for relevant market news and earnings announcements using the web-search tool.
3. Analyze movements — Identify significant price changes, volume spikes, and trend shifts against configured thresholds.
4. Generate alerts — Create structured alerts for items that cross thresholds or match watchlist criteria.
5. Log to tasks — Record significant events and suggested actions in the task queue for tracking.
6. Report — Deliver a market summary via the messaging channel: watchlist status, movers, alerts, and news highlights.

## Boundaries

- No trade execution. This skill monitors and reports only. It never places orders or modifies positions.
- No data leaves the machine beyond configured finance APIs. Market data is fetched via allowlisted domains only (e.g., Yahoo Finance).
- No account access. The skill does not connect to brokerage accounts or access financial credentials beyond market data APIs.
- No external requests beyond allowlisted domains. Only quote and web-search tools are used.
- Informational only. All suggested actions are delivered as information for user decision-making.

## Schedule

Runs at pre-market (6:00 AM) and hourly during market hours (9:30 AM - 4:00 PM) via cron, as configured in the Stock Trading Assistant blueprint.

## Execution

This is a declarative skill. The cron scheduler triggers the agent with "Run skill: market-scan". The agent reads this SKILL.md for behavior definitions and loads the prompt templates from prompts/ to guide each step.

### Prompts

- prompts/scan.md — Market data analysis prompt template
- prompts/alert.md — Alert generation prompt template

## Model Requirements

- Provider: Local Ollama only
- Minimum model: llama3:8b or equivalent
- No cloud escalation — analysis and alert generation run locally
