# price-alert

Price monitoring skill. Watches configured items (stocks, products, services) for target price levels. Fires once when a target is hit — no repeated alerts for the same trigger. Informational only; never executes purchases or trades.

## Behavior

1. Load watchlist — Read configured price targets from the user's watchlist.
2. Fetch prices — Pull current prices for each item using the appropriate tool (quote for stocks/futures, web-search for products).
3. Check triggers — Identify items where current price has crossed the configured target.
4. Alert — Send a one-line alert for each triggered item. Mark it triggered to avoid repeat alerts.
5. Re-arm — Target can be reset by the user for re-monitoring.

## Boundaries

- Informational only. Never buys, sells, or commits to purchases.
- One alert per trigger level. Does not nag.
- Stock/futures price data: ~15 minute delay unless real-time tool available.
- Product prices may have longer lag — note the data age in the alert.

## Alert Format

`[Item] hit $[price] (target: $[target], direction: [above/below])`

## Schedule

Every 30 minutes during configured active hours.

## Execution

Declarative skill. Trigger: "Run skill: price-alert" or configure via watchlist. Load this SKILL.md, execute prompts.

### Prompts

- prompts/check.md — Price checking and trigger evaluation

## Model Requirements

- Provider: Local Ollama only (simple threshold check, no LLM needed for math)
- Minimum model: llama3:8b
