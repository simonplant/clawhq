# task-digest

Daily task prioritization — surfaces what matters, surfaces blockers, saves you the triage.

## What It Does

- **Morning digest**: lists overdue, due today, and high-priority tasks at 8am
- **Midday check-in**: brief update on task progress (weekdays only)
- **Smart prioritization**: reorders tasks based on deadlines, importance, and available time (calendar-aware)
- **Blocker flagging**: calls out tasks blocked by dependencies or missing info
- **Context-aware**: knows when you have meetings and adjusts available task time

## Sections in Digest

1. **Overdue** — tasks past their due date (with count and oldest)
2. **Due Today** — what must be done today
3. **High Priority** — flagged items without a hard deadline
4. **In Progress** — tasks already started
5. **Blocked** — tasks waiting on something (dependency, info, approval)

## Tools Required

- `tasks` — local work queue for agent tasks
- `ical` — calendar context for time-aware prioritization

## Customization

- `max_items` — cap the digest length (default: 10)
- `digest.sections` — choose which sections appear
- `notifications.deadline_warning_hours` — how far ahead to warn

## Note for Blueprints

Pair this with `morning-brief` for a complete morning routine: calendar + weather + email summary + task priorities in one message.
