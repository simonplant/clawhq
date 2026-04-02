# habit-tracker

Habit monitoring and streak tracking skill. Tracks daily check-in habits, maintains streaks, and surfaces the Four Right Exertions when a habit is slipping — prevent unwholesome from arising, redirect what has arisen, maintain what's working. No gamification, no judgment.

## Behavior

1. Load habits — Read configured habits from the user's habit configuration.
2. Check completions — Pull today's habit completions from the task or health tool.
3. Update streaks — Increment or reset each habit's streak counter.
4. Surface — If a habit hasn't been completed by the check time, send a one-line reminder. No lecture.
5. Weekly summary — Sunday: streak table, best/worst habit of the week.

## Boundaries

- Reminders are one-line, not lectures. If the same reminder fires 3 days in a row, escalate to a pattern note.
- Tracks habits the user explicitly configured. Never adds new habits autonomously.
- No judgment on missed days — streaks reset, no moral commentary.

## Schedule

Daily check at 8:00 PM (end-of-day). Weekly summary: Sunday 7:00 PM.

## Execution

Declarative skill. Trigger: "Run skill: habit-tracker". Load this SKILL.md, execute prompts.

### Prompts

- prompts/check.md — Completion check and reminder generation
- prompts/summary.md — Weekly streak summary

## Model Requirements

- Provider: Local Ollama only
- Minimum model: llama3:8b
