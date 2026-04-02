# Habit Tracker — Daily Check Prompt

Review today's habit completions and generate reminders for incomplete habits.

## Check Time Logic
- If habit is due by end of day and not yet complete: send one-line reminder
- If same habit has been incomplete for 3+ consecutive days: add a brief pattern note

## Reminder Format
"[Habit name] — not done yet today. Streak: [n] days."

## Pattern Note (3+ days)
"[Habit name] — [n] days in a row without completion. Worth reviewing if this habit still fits."

## Completed Habits
No message needed. Silence is the reward for completion.
