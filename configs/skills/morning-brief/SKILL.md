# morning-brief

Daily morning briefing skill. Gathers overnight email activity, today's calendar, and pending tasks, then composes a concise brief delivered via the messaging channel — so the user starts the day informed, not overwhelmed.

## Behavior

1. Gather email status — Read unread email count and flag urgent items using the email tool.
2. Pull calendar — Fetch today's events using the calendar tool. Detect schedule conflicts and flag overloaded days.
3. Check tasks — Read pending and overdue tasks using the tasks tool.
4. Compose brief — Synthesize gathered data into a structured morning message: email summary, calendar preview, task priorities, and flagged items.
5. Deliver — Send the composed brief via the messaging channel.

## Boundaries

- Read-only. This skill reads email headers, calendar events, and task lists. It does not modify, archive, or send anything.
- No data leaves the machine. All composition uses the local Ollama model. No cloud API calls.
- No external requests. The skill only accesses local integrations via workspace tools.
- No auto-actions. The brief is informational only — it does not take actions on the user's behalf.

## Schedule

Runs once daily at the blueprint-configured morning time (e.g., 08:00 for Email Manager, 06:30 for Founder's Ops, 07:00 for Family Hub).

## Execution

This is a declarative skill. The cron scheduler triggers the agent with "Run skill: morning-brief". The agent reads this SKILL.md for behavior definitions and loads the prompt templates from prompts/ to guide each step.

### Prompts

- prompts/gather.md — Data gathering prompt template (email, calendar, tasks)
- prompts/compose.md — Brief composition prompt template

## Model Requirements

- Provider: Local Ollama only
- Minimum model: gemma4:26b or equivalent
- No cloud escalation — gathering and composing run locally
