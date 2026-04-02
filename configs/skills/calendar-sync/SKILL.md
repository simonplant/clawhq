# calendar-sync

Calendar monitoring and conflict detection skill. Checks the next 48 hours for scheduling conflicts, back-to-back meetings without buffer, and focus block opportunities. Silent when the calendar is healthy.

## Behavior

1. Fetch events — Pull the next 48 hours of calendar events.
2. Detect conflicts — Identify overlapping events or impossible back-to-back travel.
3. Flag overloads — Days with >4 hours of meetings get a "no deep work window" warning.
4. Suggest focus blocks — Identify 2h+ free windows on weekdays and suggest protecting them.
5. Deliver — Report conflicts and suggestions via messaging channel. Silent if nothing needs attention.

## Boundaries

- Read-only. Does not create, modify, or delete calendar events.
- Never books on behalf of the user without explicit request.
- Silent when calendar is clean — no "all clear" messages.

## Schedule

Runs twice daily: 7:00 AM and 1:00 PM via blueprint cron config.

## Execution

Declarative skill. Trigger: "Run skill: calendar-sync". Load this SKILL.md, execute prompts.

### Prompts

- prompts/check.md — Conflict detection and focus block identification

## Model Requirements

- Provider: Local Ollama only
- Minimum model: llama3:8b
- No cloud escalation
