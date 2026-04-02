# health-log

Health metric logging and trend detection skill. Captures weight, activity, sleep, and nutrition data from connected health tools. Surfaces trends worth acting on — not a daily nag, but a weekly pattern surfacer.

## Behavior

1. Read metrics — Pull recent health data from connected integrations (weight, steps, sleep, calories).
2. Track trends — Identify 7-day moving averages and directional changes.
3. Flag — Surface when a metric deviates meaningfully from goal or recent trend.
4. Weekly report — Sunday evening: one-paragraph health summary with key trend.
5. Stay silent — If all metrics are on track, report nothing daily.

## Boundaries

- Read-only. Never modifies health data or health app settings.
- No medical advice. Observations only, not diagnosis or treatment recommendations.
- Weight and health data are personal — never included in group chat context.

## Schedule

Daily check (silent unless flagged): 9:00 AM. Weekly summary: Sunday 6:00 PM.

## Execution

Declarative skill. Trigger: "Run skill: health-log". Load this SKILL.md, execute prompts.

### Prompts

- prompts/trend.md — Trend analysis and deviation flagging
- prompts/summary.md — Weekly health summary composition

## Model Requirements

- Provider: Local Ollama only
- Minimum model: llama3:8b
- No cloud escalation — health data stays local
