# Health Log — Trend Analysis Prompt

Review the last 7 days of health metrics.

## Flag When
- Weight change >2 lbs in 7 days (either direction)
- Steps <3,000/day for 3 consecutive days
- Sleep <6h average over the week
- Calories >20% over target for 3+ consecutive days

## Output
If a trend crosses the threshold: "[Metric] trend: [specific observation]. 7-day avg: [value] vs. goal: [value]."
If all metrics on track: output nothing.
