# meeting-notes

Meeting notes capture and action item extraction skill. During or after a meeting, converts spoken/typed notes into structured summaries with decisions and action items extracted. Routes action items to the task queue.

## Behavior

1. Receive notes — Accept raw meeting notes (typed or transcribed).
2. Structure — Organize into: attendees, agenda items, decisions, action items.
3. Extract actions — Identify specific commitments with owner and due date where mentioned.
4. Log tasks — Create tasks in the task queue for action items with the meeting as context.
5. Archive — Save structured summary to the notes archive.

## Boundaries

- Action items go to the task queue — never executes the actions itself.
- If owner of an action item isn't the user, note it but don't create a task.
- Meeting notes may contain sensitive content — never includes in outbound communications without explicit approval.

## Schedule

On-demand only. No cron schedule.

## Execution

Declarative skill. Trigger: "Run skill: meeting-notes [paste raw notes]". Load this SKILL.md, execute prompts.

### Prompts

- prompts/extract.md — Structure, decision, and action item extraction

## Model Requirements

- Provider: Cloud preferred for nuanced action extraction
- Minimum model: llama3:8b
