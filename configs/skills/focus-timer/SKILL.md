# focus-timer

Pomodoro-style focus session manager. Starts timed work blocks, suppresses non-urgent
notifications during sessions, and logs completion. Designed for deep work protection.

## Behavior

1. Start — User triggers a focus session (25 or 50 min, configurable). Agent logs start time.
2. Guard — During active sessions, route all incoming messages to a hold queue. Only urgent
   alerts (calendar conflicts, keyword-triggered urgency) interrupt.
3. Break — At session end, deliver a summary of held messages, then prompt for break or continue.
4. Streak — Track daily focus sessions completed. Surface count in morning brief.
5. Log — Append session records to `memory/focus-log.md` (date, duration, interruption count).

## Boundaries

- Never suppress calendar or time-sensitive alerts without user confirmation.
- No auto-archive of held messages — they queue for user review.
- Session state stored locally only.

## Schedule

On-demand only. No autonomous triggering — user explicitly starts sessions.

## Prompts

- prompts/session-start.md — Session start confirmation and hold-queue notification
- prompts/session-end.md — Break prompt with held messages summary
- prompts/held-message.md — Deferred message format for queued items

## Model Requirements

Local Ollama only. Minimum: llama3:8b. No cloud escalation.
