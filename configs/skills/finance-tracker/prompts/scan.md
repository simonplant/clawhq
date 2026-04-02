# Finance Tracker — Scan Prompt

Review recent transactions for anomalies.

## Anomaly Criteria
- Charge >2x the usual amount for a known merchant
- New subscription or recurring charge not seen before
- Duplicate transaction (same merchant, same amount, within 48h)
- Large transaction (>$200) that's out of pattern

## Output
If anomalies found: list each with merchant, amount, date, and why it's flagged.
If nothing anomalous: output nothing.
