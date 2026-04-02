# weather-check

Plan-impact weather monitoring skill. Checks the local forecast and surfaces only weather that would change what the user does today or tomorrow. Silent when weather is unremarkable.

## Behavior

1. Fetch forecast — Get the current weather and 48-hour forecast for the user's location.
2. Check against plans — Look for calendar events that might be weather-affected (outdoor meetings, travel, commutes).
3. Assess — Is today's weather genuinely worth surfacing? Apply the signal test.
4. Deliver — Report weather only if it changes plans. Silent otherwise.

## Signal Test for Weather

Surface weather if:
- Rain/snow when outdoor activity is planned
- Temperature extreme (>90°F or <35°F) outside normal range
- High winds or storm warnings
- Conditions significantly worse than recent baseline

Stay silent if:
- Typical seasonal weather
- Nice day
- Mild overcast

## Boundaries

- Read-only. No calendar modifications.
- Uses wttr.in or Open-Meteo — no API key required.
- Silent by default. One message max per day.

## Schedule

Once daily at 7:00 AM via blueprint cron config.

## Execution

Declarative skill. Trigger: "Run skill: weather-check". Load this SKILL.md, execute prompts.

### Prompts

- prompts/assess.md — Plan-impact weather assessment

## Model Requirements

- Provider: Local Ollama only
- Minimum model: llama3:8b
