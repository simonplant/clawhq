# Todoist Integration — Architecture & Implementation

**Date:** March 20, 2026
**Scope:** Todoist as shared human-agent task interface — sync, local cache, CLI, triage flow
**Source:** Dogfooding research from Clawdius (first ClawHQ-managed agent)
**Purpose:** Reference architecture for ClawHQ's Todoist integration capability. Any blueprint that includes task management (Founder's Ops, Replace my PA, etc.) can use this pattern — the sync scripts, reasoning cache, and heartbeat triage flow are designed to be reusable across agents.

---

## Decision Summary

| Decision | Recommendation | Confidence |
|----------|---------------|------------|
| Task source of truth | Todoist (keep) | High — validated by community consensus |
| Human interface | Todoist + Telegram (current split) | High |
| Agent working memory | Workspace `task-state.json` | High — consistent with OpenClaw patterns |
| Triage mechanism | Rotating heartbeat with cached state | High — MoltFounders pattern, proven |
| Execution orchestration | Lobster pipeline (Phase 2) | Medium — useful but not blocking |
| Apple Reminders | Not viable (Linux Docker) | High |
| Drop Todoist for Telegram-only | Not recommended | High — loses visibility |
| Community task skills | Reference only, don't install | High — zero-trust posture |

---

## Why Todoist

**Strengths validated by research:**
- MoltFounders pattern is the most mature documented approach in the OpenClaw community
- Mobile quick-capture works — throw tasks at Todoist from your phone
- Comments as notification channel eliminates messaging noise for work-in-progress
- Sections model task lifecycle (Queue → Active → Waiting → Done)
- Multiple CLI wrappers available (mjrussell, sachaos, buddyh Go-based)
- Community consensus: external system for human-facing interface, workspace files for internal agent memory

**Weaknesses to mitigate:**
- API polling → stale data: solve with local dispatch cache, not more frequent polling
- Flat structure → no task trees: solve with subtasks in Todoist (supported) + decomposition notes in workspace
- Nag-storms → blocked tasks re-evaluated: solve with reasoning cache + `next_review_at` timestamps

---

## Why Not the Alternatives

### Apple Reminders — Not Viable

`remindctl` is macOS-native. Agents running in Docker on Linux would require a macOS bridge node as a relay — adds architectural complexity and a single point of failure. Known bug: OpenClaw.app missing `NSRemindersUsageDescription` (issue #5090, stale).

### Telegram as Primary — Not Recommended

Telegram is the conversational interface. Making it also the task management interface conflates two concerns and loses the "glance at your phone and see the board" capability.

**Keep Telegram for:** Conversational commands, escalations, morning briefs, approval requests.
**Keep Todoist for:** Task state visibility, mobile browse, progress comments, priority management.

### GitHub Issues — Dev Work Only

Already working for code collaboration. Too heavy for personal tasks. Don't unify.

---

## Architecture

**Todoist** = shared human-agent task interface, source of truth
**Workspace files** = agent's internal working memory, planning scratch, session state
**Local dispatch cache** = mirrors current Todoist state so the agent doesn't hit the API on every heartbeat
**Reasoning annotations** = stored alongside cached task data, not in Todoist

### Task Reasoning Cache (`workspace/task-state.json`)

```json
{
  "last_synced": "2026-03-20T10:30:00Z",
  "tasks": {
    "todoist_task_id_123": {
      "title": "Research Lobster pipeline patterns",
      "todoist_status": "active",
      "last_assessed_at": "2026-03-20T10:15:00Z",
      "assessment": "ready_to_work",
      "next_action": "Read Lobster docs, build minimal triage workflow",
      "resume_conditions": {
        "type": "time_passed",
        "threshold": "2026-03-20T11:00:00Z"
      },
      "attempt_count": 0,
      "blocked_reason": null
    },
    "todoist_task_id_456": {
      "title": "Review attorney response",
      "todoist_status": "waiting",
      "last_assessed_at": "2026-03-20T09:00:00Z",
      "assessment": "blocked_on_human",
      "next_action": "Wait for forwarded email",
      "resume_conditions": {
        "type": "external_signal",
        "signal": "telegram_message_contains_attorney"
      },
      "attempt_count": 0,
      "blocked_reason": "Waiting on attorney response",
      "next_review_at": "2026-03-21T09:00:00Z"
    }
  }
}
```

### Resume Condition Types (Machine-Evaluable)

| Type | How Evaluated | Example |
|------|--------------|---------|
| `time_passed` | Compare `threshold` to current time | "Check back in 2 hours" |
| `file_exists` | Check workspace path | "Wait for report.md to be generated" |
| `cli_returns` | Run CLI command, check exit code/output | "Wait for PR to be merged: `gh pr view 123 --json state`" |
| `todoist_changed` | Compare cached state to fresh API fetch | "Task was reprioritized or commented on" |
| `external_signal` | Flag file set by inbound message handler | "User replied in Telegram about X" |
| `always` | Re-evaluate every cycle | Default for new/unassessed tasks |

---

## Heartbeat Triage Flow

Replace cron polling with a rotating heartbeat check:

1. **Sync phase** (every 30-60 min): Fetch Todoist tasks via CLI wrapper, update `task-state.json` cache, detect new/changed/completed tasks
2. **Triage phase** (every heartbeat, ~15-30 min): Read cache, evaluate resume conditions for all active tasks, select highest-priority ready task
3. **Execute phase**: If a task is ready, spawn an isolated session to work on it. Update Todoist with progress comments during execution.
4. **Bookkeep phase**: Update cache with new assessment, set next resume conditions, update `next_review_at` for blocked tasks

### Backoff/Snooze Model

When a task is assessed as blocked:
- Set `next_review_at` to a sensible future time (default: 24h for human-blocked, 1h for system-blocked)
- Triage skips tasks where `now < next_review_at` unless the resume condition's signal has fired
- Exponential backoff: if re-assessed and still blocked, double the review interval (cap at 7 days)
- Todoist comment: "Blocked: [reason]. Will check again [date]."

### Token Efficiency

- Heartbeat checks run on cheapest available model (Haiku, gpt-5-nano, Gemini Flash Lite)
- `lightContext: true` strips everything except HEARTBEAT.md from heartbeat prompts
- Triage uses `llm-task` via Lobster for structured JSON output (no chat overhead)
- Only the execute phase uses the expensive model — and only on the selected task
- Task assessments are structured JSON, not free-text reasoning

---

## Implementation Priority

1. **HEARTBEAT.md rewrite** — Implement rotating check pattern with task triage as a check category. Reference `task-state.json` for cached state. Cadence: task check every 30 min, sync from Todoist every 60 min.

2. **`task-state.json` schema + read/write scripts** — CLI scripts: `task-cache read`, `task-cache update <task_id> <assessment_json>`, `task-cache ready` (list tasks with met resume conditions).

3. **Todoist sync script update** — Modify CLI wrapper to write results to `task-state.json` in addition to stdout. Add change-detection logic: only flag tasks that actually changed since last sync.

4. **Lobster triage pipeline** (Phase 2) — Once the cache and heartbeat are working, wrap the triage logic in a Lobster workflow for deterministic execution and approval gating.

5. **Backoff logic in triage** — Implement `next_review_at` checks in the heartbeat's task-check phase. This is what kills the nag-storm.

---

## Bottom Line

The architecture needed is an optimization on what already exists, not a replacement. Add a local reasoning cache, switch from cron polling to rotating heartbeat, implement backoff for blocked tasks. Todoist stays. The nag-storm dies. Staleness drops to manageable levels.
