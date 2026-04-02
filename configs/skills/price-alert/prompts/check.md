# Price Alert — Check Prompt

Compare current prices against watchlist targets and identify triggered alerts.

## For Each Watchlist Item
1. Fetch current price
2. Compare to target price and direction (above/below)
3. Check if already triggered (skip if fired in last 24h for same level)
4. If triggered and not already fired: generate alert

## Alert Format
`[Item] hit $[current_price] (target: $[target], [above/below]). Data as of [timestamp].`

## Output
List triggered alerts only. If nothing triggered: output nothing.
