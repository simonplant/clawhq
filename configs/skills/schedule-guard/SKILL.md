# schedule-guard

Schedule protection skill for the Replace Google Assistant and Email Manager agents. Monitors the calendar on a recurring cron, detects conflicts, protects focus blocks from meeting requests, and alerts the user to scheduling issues — proactively guarding the user's time.

## Behavior

1. Scan calendar — Read upcoming events for today and tomorrow using the calendar tool.
2. Detect conflicts — Identify overlapping events, double-bookings, and back-to-back meetings without buffer time.
3. Guard focus blocks — Identify events that encroach on designated focus/deep-work blocks.
4. Check overload — Flag days with excessive meetings (configurable threshold, default: 5+ meetings).
5. Propose resolutions — For each conflict, suggest a resolution (reschedule, decline, shorten).
6. Report — Deliver conflict alerts and suggestions via the messaging channel.

## Boundaries

- No auto-modify. This skill detects and reports scheduling issues. It never modifies, declines, or reschedules events without explicit user approval.
- No data leaves the machine. All analysis uses the local Ollama model. No cloud API calls.
- No external requests. The skill only accesses the local calendar via the calendar tool.
- Read-only by default. Calendar modifications only happen if the user approves a proposed resolution.
- No contact access. The skill does not access contact lists or attendee details beyond what is in calendar events.

## Schedule

Runs every 15 minutes during waking hours via the work-session cron job, as configured in the blueprint.

## Execution

This is a declarative skill. The cron scheduler triggers the agent with "Run skill: schedule-guard". The agent reads this SKILL.md for behavior definitions and loads the prompt templates from prompts/ to guide each step.

### Prompts

- prompts/detect-conflicts.md — Conflict detection prompt template
- prompts/propose-resolution.md — Resolution suggestion prompt template

## Approval Integration

Proposed calendar changes are enqueued with:
- Category: calendar_change
- Source: schedule-guard
- Metadata: event IDs, conflict type, proposed action

The user reviews proposals via their messaging channel and approves or rejects each one.

## Model Requirements

- Provider: Local Ollama only
- Minimum model: llama3:8b or equivalent
- No cloud escalation — conflict detection and resolution proposals run locally
