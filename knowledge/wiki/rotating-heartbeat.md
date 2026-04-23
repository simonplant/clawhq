---
title: Rotating heartbeat pattern
category: Decisions
status: active
date: 2026-04-22
tags: [heartbeat, pattern, cost, cron, openclaw]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# Rotating heartbeat pattern

## Problem

An agent that needs to check multiple things periodically — inbox,
calendar, git status, markets, system health — has two naive options:

1. **Run all checks every tick.** Simple, but wastes tokens on checks
   that don't need to run that often. A daily calendar review doesn't
   need to re-run every 30 minutes.
2. **One cron job per check.** Clean separation, but each job pays its
   own context startup cost. Fragments the agent's awareness across
   many small sessions.

Neither is great.

## The pattern

A single heartbeat that rotates through checks based on staleness.
Each tick:

1. Read the most-recent-run timestamp for each check.
2. Compute which check is most overdue, respecting per-check time
   windows ("calendar only during business hours").
3. Run only that check.
4. Update the timestamp.
5. Report only if the check returned something actionable.

State lives in a single `heartbeat-state.json` file beside
`HEARTBEAT.md`:

```json
{
  "checks": {
    "inbox":    { "every": "30m", "last_run": "2026-04-22T09:30:00Z", "hours": [8, 22] },
    "calendar": { "every": "2h",  "last_run": "2026-04-22T08:00:00Z", "hours": [8, 20] },
    "git":      { "every": "4h",  "last_run": "2026-04-22T06:00:00Z", "hours": [0, 24] },
    "markets":  { "every": "1h",  "last_run": "2026-04-22T09:00:00Z", "hours": [9, 16] }
  }
}
```

## HEARTBEAT.md shape

```markdown
# Heartbeat

Read `heartbeat-state.json`. Determine which check is most overdue
within its active hours. If no check is currently due, return
`HEARTBEAT_OK` and stop.

Otherwise, run the appropriate check:

- **inbox** → `email inbox --unread --since=last`
- **calendar** → `ical today` + `ical tomorrow`
- **git** → `git status` on watched repos
- **markets** → `quote <watchlist>` summary

Update `heartbeat-state.json` with the new `last_run` timestamp for
the check you just ran.

If the check produced nothing actionable, return `HEARTBEAT_OK`.
Otherwise, respond with the actionable content only.
```

## Why this works

- **Staleness-driven.** Each check runs at its own cadence without
  needing its own cron job.
- **One context per tick.** Only one check runs per heartbeat, so
  context budget is predictable. Combined with `lightContext: true`
  and `isolatedSession: true`, each tick is cheap.
- **Silent by default.** `HEARTBEAT_OK` is stripped from delivery;
  the operator only hears from the agent when something needs
  attention.
- **Backpressure built in.** If a check runs long, the next tick
  simply finds a different check overdue — no queue buildup, no
  concurrent calls.

## Benefits vs. the alternatives

| Approach | Token cost | Complexity | Per-check cadence control |
|---|---|---|---|
| Run all checks every tick | High | Low | No |
| One cron job per check | Medium | Medium | Per-job |
| Rotating heartbeat | Low | Medium | Per-check (in state file) |

## Related

Builds on [[heartbeat-token-sink]]. Combines with the
isolated cron recommendation from there: the heartbeat itself runs as
an isolated cron job, and rotation is the pattern that makes the
single isolated job cover multiple kinds of awareness.

## See also

- [[heartbeat-md]]
- [[heartbeat-token-sink]]
