# project-standup

Daily async standup generator for solo builders and small teams. Summarizes what was
done yesterday, what's planned today, and what's blocked — from task history and notes.

## Behavior

1. Gather — Pull yesterday's completed tasks and work session notes from configured sources.
2. Plan — Pull today's tasks from the task system (sorted by priority/due date).
3. Blockers — Surface any tasks flagged BLOCKED or overdue by >2 days.
4. Draft — Compose a standup in the configured format (Slack, Notion, plain text).
5. Queue — Add to approval queue (category: publish_content). Never post autonomously.

## Boundaries

- Approval required before posting anywhere.
- Standup content sourced from real task history — no fabrication.
- If no tasks completed yesterday: say so. Don't pad with vague activity descriptions.

## Schedule

Daily at 09:30 (post morning brief, post reading list). Weekdays only.

## Prompts

- prompts/standup.md — Standup composition

## Model Requirements

Local Ollama only. Minimum: llama3:8b. Cloud for formatting: llama3:70b preferred.
