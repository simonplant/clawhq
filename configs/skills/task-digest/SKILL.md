# task-digest

Daily task prioritization skill. Reads the task queue, cross-references against today's calendar, and surfaces a ≤5 item focus list. Triage happens silently; only the prioritized list reaches the user. No padding — if the list is 2 items, it's 2 items.

## Behavior

1. Fetch tasks — Read all pending and overdue tasks from the task tool.
2. Read calendar — Pull today's events to understand available focus windows.
3. Prioritize — Score tasks by: due date urgency, calendar-fit (tasks that need focused time → schedule against free blocks), and dependency chain.
4. Surface — Compose the focus list: max 5 items, with time estimates and any blockers called out.
5. Deliver — Send via messaging channel. Skip the preamble.

## Boundaries

- Read-only. Does not modify tasks or calendar.
- No external requests. Uses local task and calendar integrations only.
- Silent on weekends unless overdue items exist.

## Schedule

Once daily at blueprint-configured morning time, after morning-brief.

## Execution

Declarative skill. Trigger: "Run skill: task-digest". Load this SKILL.md, execute prompts in sequence.

### Prompts

- prompts/prioritize.md — Task prioritization and focus list composition

## Model Requirements

- Provider: Local Ollama only
- Minimum model: llama3:8b
- No cloud escalation
