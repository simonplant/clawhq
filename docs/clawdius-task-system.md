# Clawdius Task System Research — Findings & Recommendations

**Date:** March 20, 2026  
**Scope:** OpenClaw-native task management architecture for Clawdius  

---

## Executive Summary

After researching OpenClaw's native primitives, the Lobster workflow engine, community task patterns, and the available dashboard/sync ecosystem, the recommendation is:

**Keep Todoist as the shared human-agent task interface (source of truth). Add a local dispatch cache + structured reasoning state in the workspace. Use Lobster for deterministic task execution pipelines. Use the heartbeat (not cron polling) as the triage scheduler, with a rotating-check pattern on a cheap model.**

This aligns with the validated community pattern (MoltFounders, awesome-openclaw-usecases, Dan Cleary/Converge) and avoids rebuilding the local task system that was already retired today.

---

## Research Question 1: What Does OpenClaw Provide Natively?

### Heartbeat System

The heartbeat is OpenClaw's core autonomous scheduling feature. It wakes the agent at a configurable interval (default 30 min, configurable down to minutes), runs a prompt against `HEARTBEAT.md` in the workspace, and either surfaces something actionable or returns `HEARTBEAT_OK` silently.

Key capabilities relevant to task management:

- **`HEARTBEAT.md` as checklist:** The file is read every cycle. It's the natural place for a rotating task-check protocol. If the file is effectively empty (only headers/blank lines), the heartbeat is skipped entirely — saving API calls.
- **`lightContext: true`:** Strips all workspace bootstrap files except HEARTBEAT.md from the heartbeat prompt. This is critical for cost — you don't want the full identity/memory stack loaded just to check if tasks need attention.
- **`isolatedSession: true`:** Runs each heartbeat in a fresh session with no conversation history. Prevents heartbeat reasoning from polluting the main chat context.
- **`target: "last"` or channel-specific routing:** Controls where heartbeat output goes. Default is `"none"` (silent). Must be set to `"last"` for notifications to actually reach Telegram. *This is a known gotcha — the bundled coding-agent skill's notification mechanism is effectively dead code without this setting (GitHub issue #29215).*
- **Active hours:** Heartbeats can be restricted to a time window in the agent's configured timezone, preventing overnight noise.
- **Model routing:** Heartbeats can run on a cheap model (`gpt-5-nano`, `gemini-2.5-flash-lite`) since they're doing lightweight checks, not heavy reasoning. MoltFounders confirms this pattern works well.

**Versus cron:** The heartbeat is for "periodic awareness" — checking if anything needs attention. Cron is for precise timing — "do X at 6 AM every Monday." For task triage, heartbeat is the right primitive. For scheduled task execution, cron is correct.

### Workspace Filesystem

The workspace (`~/.openclaw/workspace/`) is the agent's persistent storage. Files survive across sessions, across heartbeat cycles, across context compaction. This is where task reasoning state should live — not as a replacement for Todoist, but as the agent's working memory about tasks.

The workspace already holds `MEMORY.md`, daily memory files, `HEARTBEAT.md`, identity files, and skill output. Adding a `task-cache/` directory or a `QUEUE.md` file for dispatch state is architecturally consistent.

### Session Management

Sessions can model task execution contexts. `sessions_spawn` creates isolated execution environments. The MoltFounders pattern uses named agents with dedicated session contexts for different work types (monitor, researcher, communicator, orchestrator).

For task execution: when the triage phase selects a task to work on, it can spawn an isolated session for the work, keeping the main session clean. This is what Context Studios learned the hard way — using main session events for cron jobs makes the chat unmanageable.

### Memory System

OpenClaw's memory is local SQLite with BM25 + vector search. Memory files are Markdown, stored daily, with a consolidation pipeline available. This is relevant because task reasoning state ("I assessed task X yesterday, concluded it was blocked on Y") should be written to memory so it persists across context compaction.

The `second-brain` skill (jugaad-lab) offers a mature memory lifecycle: scoring with time decay, auto-consolidation, entity graphs. If task assessments are stored as memory entries with proper categorization, the scoring system can naturally surface stale assessments for re-evaluation.

### Relevant Skills (NOT Recommended for Install)

Given Clawdius's zero-trust philosophy (no community skills, built from source), these are reference architectures, not install candidates:

- **`agent-autopilot`**: "Self-driving agent workflow with heartbeat-driven task execution, day/night progress reports, and long-term memory." The description matches the desired pattern closely, but as a community skill, it's not appropriate for Clawdius's security posture. Worth reading the source for architectural patterns.
- **`agent-task-manager`**: "Manages and orchestrates multi-step, stateful agent." Same — reference only.
- **`task-resume`**: "Automatic interrupted-task resume workflow with queueing and recovery." The resume pattern is relevant to the backoff/snooze requirement.
- **`subagent-driven-development`**: "Use when executing implementation plans with independent tasks in the current session." Relevant pattern for task decomposition.

---

## Research Question 2: Lobster for Deterministic Task Execution

### What Lobster Is

Lobster is OpenClaw's workflow engine — a typed, local-first pipeline runtime. Key properties:

- **Deterministic execution:** Steps run sequentially with JSON data flow between them. No LLM deciding the order.
- **Approval gates:** Side effects halt until explicitly approved. Returns a resume token.
- **Resumable:** Paused workflows can be continued later without re-running. State is serialized to disk.
- **One call instead of many:** OpenClaw makes one Lobster tool call and gets a structured JSON result. Saves tokens.
- **`llm-task` integration:** Structured LLM steps within deterministic pipelines. The LLM does classification/summarization/drafting; Lobster handles sequencing.

### Can Lobster Model Task Lifecycle?

**Partially, but it's not the right abstraction for the full lifecycle.**

Lobster excels at: "Given a task that's ready to execute, run the deterministic execution pipeline." For example: fetch Todoist tasks → triage with `llm-task` → pick highest priority → execute work steps → update Todoist with results → report to Telegram. Each step is deterministic, approval-gated where needed, and resumable.

Lobster is NOT the right place for: long-running task state tracking, backoff/snooze logic, or the persistent reasoning cache. Those are workspace file concerns, not pipeline concerns.

**Recommended usage:** A Lobster pipeline for the heartbeat's task-triage workflow:

```yaml
name: task-triage
steps:
  - id: fetch
    command: todoist list --json --filter "today | overdue"
  - id: check-cache
    command: cat workspace/task-cache.json
  - id: triage
    command: >
      openclaw.invoke --tool llm-task --action json --args-json '{
        "prompt": "Given these Todoist tasks and the local cache with last-assessed timestamps and resume conditions, identify which tasks have actionable resume conditions met. Return the single highest-priority ready task, or NONE if nothing is ready.",
        "schema": {"type": "object", "properties": {"task_id": {"type": "string"}, "action": {"type": "string"}, "reasoning": {"type": "string"}}, "required": ["task_id", "action"]}
      }'
    stdin: $fetch.stdout
  - id: execute
    command: workspace/scripts/execute-task.sh
    stdin: $triage.stdout
    when: $triage.json.task_id != "NONE"
  - id: update-cache
    command: workspace/scripts/update-task-cache.sh
    stdin: $triage.stdout
```

### Sub-Workflow / Loop Status

**PR #20 (sub-lobsters with loops)** by ggondim is still OPEN as of March 20, 2026. The maintainer (vignesh07) expressed concern about "invisible sub loops." ggondim has since built his own alternatives (`canonical-agents`, `duckflux`). Community support exists but the PR hasn't been merged.

**PR #27** (flow directives + `lobster.run`) by rendrag-git is also OPEN, opened March 6, 2026.

**Implication:** For now, Lobster is linear-only in mainline. Loops can be achieved via shell `condition` checks or by calling sub-workflows through `exec`, but native loop support isn't merged. This doesn't block the task-triage pipeline (which is naturally linear per cycle), but it means task decomposition into multi-iteration work loops would need to be orchestrated by the agent's LLM reasoning, not by Lobster natively.

### "Second Brain" Reference Implementation

The Lobster docs reference a "second brain" CLI + Lobster pipelines managing three Markdown vaults with workflows for `weekly-review`, `inbox-triage`, `memory-consolidation`, and `shared-task-sync`, each with approval gates. This is the closest documented pattern to what Clawdius needs — a CLI that emits JSON for state queries, with Lobster chaining them into deterministic triage workflows.

---

## Research Question 3: Community Task Patterns

### MoltFounders: Todoist as Transparency Layer (Most Mature Pattern)

This is the most thoroughly documented and battle-tested approach in the community. Key elements:

- **Todoist is source of truth** for task state. Four sections: Queue/Backlog → Active → Waiting/Assigned to me → Done.
- **Five operations:** `create_task`, `move_to_active`, `assign_to_me(reason)`, `complete_task`, `add_comment(status)`.
- **Reconciliation via heartbeat** every 30 min: find Active tasks with no updates >24h (stalled), list tasks assigned to human (need attention), report summary only if issues found.
- **Key insight:** "I fixed the black box problem by wiring up Todoist as the source of truth. Tasks get created when work starts, updated as state changes, assigned to me when human intervention is required, and closed when done. If something fails, it leaves a comment on the task instead of retrying forever."
- **Rotating heartbeat pattern:** Single heartbeat rotates through checks based on how overdue each check is. Each check has a cadence and optional time window. On each tick, run whichever check is most overdue. This batches background work, keeps costs flat, and avoids "everything fires at once."
- **Cheap model for heartbeat:** All heartbeat checks run on the cheapest available model. If a check finds real work, it spawns the appropriate agent/session for execution.

**Assessment:** This is architecturally what Clawdius should converge toward. The rotating heartbeat replaces the 5-minute cron polling. The Todoist operations are already similar to what the existing CLI wrapper provides. The missing pieces are: (1) the local reasoning cache so the agent doesn't re-assess unchanged tasks, and (2) the backoff/snooze mechanism for blocked tasks.

### awesome-openclaw-usecases: Todoist Reasoning Sync

Extends the MoltFounders pattern by externalizing the agent's internal reasoning into Todoist task descriptions and streaming sub-step completions as comments. Uses bash scripts wrapping the Todoist REST API.

**Assessment:** Useful for observability when tasks are complex multi-step operations. The comment stream gives you a real-time log of what the agent is doing without checking chat logs. However, it can create noise if overdone — comments on simple tasks that complete in one step are wasteful. Best applied selectively to tasks the agent decomposes.

### Dan Cleary / Converge: Agent-Friendly Task Dashboard

Built a custom web dashboard (Converge + Convex backend) where "the agent is the primary user." The dashboard has a task kanban board, project grouping, activity feed as daily log, and an API designed to be extremely agent-friendly. Key insight: "None of the UI is fancy or groundbreaking, the real benefit comes from designing the API to be extremely agent friendly."

**Assessment:** This is the "drop Todoist" path — build a bespoke task interface. It's compelling if you're willing to maintain a custom web app. For Clawdius, where the constraint is minimal infrastructure and zero-trust, this adds more than it saves. But the API-first design philosophy is worth borrowing — if Clawdius needs a task dashboard, a simple read-only web view of the workspace's `task-cache.json` would serve the same purpose without a database.

### ClawBoard (Wadera): Docker-Ready Dashboard

PostgreSQL-backed dashboard with Kanban task board, project management, session browser, real-time agent monitoring, and a plugin system. Reads OpenClaw workspace files (SOUL.md, HEARTBEAT.md, etc.) in read-only mode. Includes `clawbeat` — a proactive monitoring tool that checks task status and agent activity.

**Assessment:** Most feature-complete dashboard project. The `clawbeat` heartbeat watchdog pattern (scans sessions for active subagents, queries task API for stuck items, gathers context) is architecturally interesting. However, it requires PostgreSQL and a full Docker stack — heavier than what Clawdius needs. Reference architecture, not a direct adoption candidate given zero-trust posture.

### Agent Board (quentintou): Multi-Agent Task Board with DAG Dependencies

Purpose-built for AI agent teams. Kanban + DAG dependencies + MCP server + auto-retry + audit trail. Agents pick up work via heartbeat polling or webhook notifications. Dependencies enforced (Agent B can't start until Agent A finishes). Task chaining builds pipelines.

**Assessment:** Overkill for single-agent Clawdius, but the DAG dependency model is relevant if tasks are decomposed into trees. The heartbeat-polling pickup pattern validates the "agent checks for ready work on each cycle" approach.

### Alex Finn / "Mission Control" Pattern

Agent generates its own tasks from brain-dumped goals each morning, works through them on a Kanban board it built itself. The "ultimate direction" — replacing Todoist/Notion/Calendar with agent-built apps.

**Assessment:** Aspirational but premature for Clawdius. The agent building its own task UI creates a maintenance burden the agent also has to manage. Todoist already exists and works.

---

## Research Question 4: Human-Facing Sync Options

### Option A: Todoist (Recommended — Keep)

**Strengths validated by research:**
- MoltFounders pattern is the most mature documented approach in the community
- Mobile quick-capture works — Simon can throw tasks at Todoist from his phone
- Comments as notification channel eliminates Telegram noise for work-in-progress
- Sections model task lifecycle (Queue → Active → Waiting → Done)
- At least 3 CLI wrappers available (mjrussell, sachaos, buddyh Go-based); Clawdius already has one
- Community consensus: external system for human-facing interface, workspace files for internal agent memory

**Weaknesses to mitigate:**
- API polling → stale data: solve with local dispatch cache, not more frequent polling
- Flat structure → no task trees: solve with subtasks in Todoist (supported) + decomposition notes in workspace
- Nag-storms → blocked tasks re-evaluated: solve with reasoning cache + `next_review_at` timestamps

**Architecture:** Todoist as source of truth. Todoist REST API v1. Sync on 30-min heartbeat cycle (not 5-min cron). Local `task-cache.json` holds last-synced state + reasoning annotations. Agent reads from cache on high-frequency checks, syncs from API on heartbeat cycle.

### Option B: Apple Reminders (Not Viable)

**Critical blocker:** `remindctl` is macOS-native. Clawdius runs in Docker on Linux. Would require a macOS bridge node (Simon's Mac) as a relay — adds architectural complexity and a single point of failure. The known bug (OpenClaw.app missing `NSRemindersUsageDescription`, issue #5090, stale) adds further risk.

**Verdict:** Not viable for Clawdius's Docker-on-Linux architecture without disproportionate complexity.

### Option C: Telegram as Interface (Not Recommended as Primary)

Claude Code's feedback was clear: "Comments on tasks ARE the notification — Simon sees them in Todoist. No Telegram noise for work-in-progress." Telegram is already the conversational interface. Making it also the task management interface conflates two concerns and loses the "glance at your phone and see the board" capability that Todoist provides.

**Keep Telegram for:** Conversational commands ("handle X"), escalations, morning briefs, approval requests.
**Keep Todoist for:** Task state visibility, mobile browse, progress comments, priority management.

### Option D: GitHub Issues (Keep for Dev Work Only)

Already working for the CC ↔ Clawdius collaboration pipeline. Too heavy for personal tasks. Don't unify.

### Option E: Hybrid Internal + Selective Sync (The Actual Recommendation)

This is what Claude Code identified as the validated pattern and what the research confirms:

- **Todoist** = shared human-agent task interface, source of truth
- **Workspace files** = agent's internal working memory, planning scratch, session state
- **Local dispatch cache** = mirrors current Todoist state so the agent doesn't hit the API on every heartbeat just to re-read the same list
- **Reasoning annotations** = stored alongside cached task data, not in Todoist

---

## Research Question 5: Recommended Architecture

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
      "title": "Review Jodie's attorney response",
      "todoist_status": "waiting",
      "last_assessed_at": "2026-03-20T09:00:00Z",
      "assessment": "blocked_on_human",
      "next_action": "Wait for Simon to forward attorney email",
      "resume_conditions": {
        "type": "external_signal",
        "signal": "simon_telegram_message_contains_attorney"
      },
      "attempt_count": 0,
      "blocked_reason": "Waiting on attorney response from Simon",
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
| `external_signal` | Flag file set by inbound message handler | "Simon replied in Telegram about X" |
| `always` | Re-evaluate every cycle | Default for new/unassessed tasks |

### Heartbeat Triage Flow

Replace the 5-minute cron Todoist poll with a rotating heartbeat check:

1. **Sync phase** (every 30 min): Fetch Todoist tasks via CLI wrapper, update `task-state.json` cache, detect new/changed/completed tasks
2. **Triage phase** (every heartbeat, ~15-30 min): Read cache, evaluate resume conditions for all active tasks, select highest-priority ready task
3. **Execute phase**: If a task is ready, spawn an isolated session to work on it. Update Todoist with progress comments during execution.
4. **Bookkeep phase**: Update cache with new assessment, set next resume conditions, update `next_review_at` for blocked tasks

### Backoff/Snooze Model

When a task is assessed as blocked:
- Set `next_review_at` to a sensible future time (default: 24h for human-blocked, 1h for system-blocked)
- The triage phase skips tasks where `now < next_review_at` unless the resume condition's signal has fired
- Exponential backoff: if re-assessed and still blocked, double the review interval (cap at 7 days)
- Todoist comment: "Blocked: [reason]. Will check again [date]."

### Token Efficiency

- Heartbeat checks run on cheapest available model (Haiku, gpt-5-nano, Gemini Flash Lite)
- `lightContext: true` strips everything except HEARTBEAT.md from heartbeat prompts
- Triage uses `llm-task` via Lobster for structured JSON output (no chat overhead)
- Only the execute phase uses Claude Opus (the expensive model) — and only on the selected task
- Task assessments are structured JSON, not free-text reasoning — no tokens burned re-parsing

### What to Build (Prioritized)

1. **HEARTBEAT.md rewrite** — Implement rotating check pattern with task triage as a check category. Reference `task-state.json` for cached state. Cadence: task check every 30 min, sync from Todoist every 60 min.

2. **`task-state.json` schema + read/write scripts** — CLI scripts (consistent with existing wrapper pattern) that Clawdius can call: `task-cache read`, `task-cache update <task_id> <assessment_json>`, `task-cache ready` (list tasks with met resume conditions).

3. **Todoist sync script update** — Modify existing CLI wrapper to write results to `task-state.json` instead of (or in addition to) stdout. Add change-detection logic: only flag tasks that actually changed since last sync.

4. **Lobster triage pipeline** (optional, Phase 2) — Once the cache and heartbeat are working, wrap the triage logic in a Lobster workflow for deterministic execution and approval gating on task state changes.

5. **Backoff logic in triage** — Implement `next_review_at` checks in the heartbeat's task-check phase. This is what kills the nag-storm.

---

## Key Sources Consulted

| Source | Finding |
|--------|---------|
| OpenClaw Heartbeat Docs | `lightContext`, `isolatedSession`, `activeHours`, `target` configuration. Default target is "none" (silent). |
| MoltFounders Runbook: Heartbeat & Task Tracking | Rotating heartbeat pattern, Todoist as source of truth, reconciliation every 30 min, cheap model for heartbeat checks |
| awesome-openclaw-usecases: todoist-task-manager | Bash script approach to Todoist API, reasoning sync via comments, heartbeat reconciliation |
| Lobster official docs + repo | Deterministic pipelines, approval gates, resume tokens, `llm-task` integration. Sub-workflow PR #20 still open. |
| ggondim DEV.to: Deterministic Multi-Agent Pipeline | Lobster is right foundation for deterministic task execution. Loop support contributed but not merged. |
| ClawBoard (Wadera) | PostgreSQL-backed dashboard with task kanban, `clawbeat` watchdog. Reference architecture. |
| Agent Board (quentintou) | DAG dependency model, heartbeat-polling pickup, auto-retry. Multi-agent overkill for Clawdius but patterns are transferable. |
| Dan Cleary / Converge | Agent-first API design philosophy. Custom dashboard built with agent as primary user. |
| OpenClaw GitHub Issue #29215 | `heartbeat.target` defaults to "none" — notifications silently dropped without explicit config. Critical gotcha. |
| Lobster PR #20 + #27 | Sub-workflow loops and flow directives both still open/unmerged as of March 20, 2026. |

---

## Decision Summary

| Decision | Recommendation | Confidence |
|----------|---------------|------------|
| Task source of truth | Todoist (keep) | High — validated by community consensus |
| Human interface | Todoist + Telegram (current split) | High — Claude Code feedback confirmed |
| Agent working memory | Workspace `task-state.json` | High — consistent with OpenClaw patterns |
| Triage mechanism | Rotating heartbeat with cached state | High — MoltFounders pattern, proven |
| Execution orchestration | Lobster pipeline (Phase 2) | Medium — useful but not blocking |
| Apple Reminders | Not viable (Linux Docker) | High |
| Drop Todoist for Telegram-only | Not recommended | High — loses visibility |
| Community task skills | Reference only, don't install | High — zero-trust posture |

**Bottom line:** The architecture you need is an optimization on what you already have, not a replacement. Add a local reasoning cache, switch from cron polling to rotating heartbeat, implement backoff for blocked tasks. Todoist stays. The nag-storm dies. Staleness drops to manageable levels.
