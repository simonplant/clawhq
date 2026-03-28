# OpenClaw Task Primitives — Research Findings

**Date:** March 20, 2026
**Scope:** OpenClaw's native capabilities for task management — heartbeat, workspace, Lobster, community patterns
**Source:** Dogfooding research from Clawdius (first ClawHQ-managed agent)
**Purpose:** Informs ClawHQ's task management capabilities — how blueprints should configure heartbeat, workspace task state, and Lobster pipelines for any agent that manages tasks

---

## Heartbeat System

The heartbeat is OpenClaw's core autonomous scheduling feature. It wakes the agent at a configurable interval (default 30 min, configurable down to minutes), runs a prompt against `HEARTBEAT.md` in the workspace, and either surfaces something actionable or returns `HEARTBEAT_OK` silently.

Key capabilities relevant to task management:

- **`HEARTBEAT.md` as checklist:** The file is read every cycle. It's the natural place for a rotating task-check protocol. If the file is effectively empty (only headers/blank lines), the heartbeat is skipped entirely — saving API calls.
- **`lightContext: true`:** Strips all workspace bootstrap files except HEARTBEAT.md from the heartbeat prompt. Critical for cost — you don't want the full identity/memory stack loaded just to check if tasks need attention.
- **`isolatedSession: true`:** Runs each heartbeat in a fresh session with no conversation history. Prevents heartbeat reasoning from polluting the main chat context.
- **`target: "last"` or channel-specific routing:** Controls where heartbeat output goes. Default is `"none"` (silent). Must be set to `"last"` for notifications to actually reach Telegram. *Known gotcha — the bundled coding-agent skill's notification mechanism is effectively dead code without this setting (GitHub issue #29215).*
- **Active hours:** Heartbeats can be restricted to a time window in the agent's configured timezone, preventing overnight noise.
- **Model routing:** Heartbeats can run on a cheap model (`gpt-5-nano`, `gemini-2.5-flash-lite`) since they're doing lightweight checks, not heavy reasoning.

**Versus cron:** The heartbeat is for "periodic awareness" — checking if anything needs attention. Cron is for precise timing — "do X at 6 AM every Monday." For task triage, heartbeat is the right primitive. For scheduled task execution, cron is correct.

---

## Workspace Filesystem

The workspace (`~/.openclaw/workspace/`) is the agent's persistent storage. Files survive across sessions, across heartbeat cycles, across context compaction. This is where task reasoning state should live — not as a replacement for an external task system, but as the agent's working memory about tasks.

The workspace already holds `MEMORY.md`, daily memory files, `HEARTBEAT.md`, identity files, and skill output. Adding a `task-cache/` directory or a `QUEUE.md` file for dispatch state is architecturally consistent.

---

## Session Management

Sessions can model task execution contexts. `sessions_spawn` creates isolated execution environments. The MoltFounders pattern uses named agents with dedicated session contexts for different work types (monitor, researcher, communicator, orchestrator).

For task execution: when the triage phase selects a task to work on, it can spawn an isolated session for the work, keeping the main session clean. This is what Context Studios learned — using main session events for cron jobs makes the chat unmanageable.

---

## Memory System

OpenClaw's memory is local SQLite with BM25 + vector search. Memory files are Markdown, stored daily, with a consolidation pipeline available. Task reasoning state ("I assessed task X yesterday, concluded it was blocked on Y") should be written to memory so it persists across context compaction.

The `second-brain` skill (jugaad-lab) offers a mature memory lifecycle: scoring with time decay, auto-consolidation, entity graphs. If task assessments are stored as memory entries with proper categorization, the scoring system can naturally surface stale assessments for re-evaluation.

---

## Lobster Workflow Engine

Lobster is OpenClaw's workflow engine — a typed, local-first pipeline runtime.

- **Deterministic execution:** Steps run sequentially with JSON data flow between them. No LLM deciding the order.
- **Approval gates:** Side effects halt until explicitly approved. Returns a resume token.
- **Resumable:** Paused workflows can be continued later without re-running. State is serialized to disk.
- **One call instead of many:** OpenClaw makes one Lobster tool call and gets a structured JSON result. Saves tokens.
- **`llm-task` integration:** Structured LLM steps within deterministic pipelines. The LLM does classification/summarization/drafting; Lobster handles sequencing.

Lobster excels at: "Given a task that's ready to execute, run the deterministic execution pipeline." For example: fetch tasks → triage with `llm-task` → pick highest priority → execute work steps → update external system with results → report to messaging channel.

Lobster is NOT the right place for: long-running task state tracking, backoff/snooze logic, or the persistent reasoning cache. Those are workspace file concerns.

### Sub-Workflow Status (as of March 2026)

PR #20 (sub-lobsters with loops) by ggondim — still OPEN. PR #27 (flow directives + `lobster.run`) by rendrag-git — also OPEN. For now, Lobster is linear-only in mainline. Loops can be achieved via shell `condition` checks or by calling sub-workflows through `exec`.

### "Second Brain" Reference Implementation

The Lobster docs reference a "second brain" CLI + Lobster pipelines managing three Markdown vaults with workflows for `weekly-review`, `inbox-triage`, `memory-consolidation`, and `shared-task-sync`, each with approval gates. Closest documented pattern to a full task triage system.

---

## Community Task Patterns

### MoltFounders: Todoist as Transparency Layer (Most Mature)

The most battle-tested approach in the community:

- **External task system as source of truth.** Four sections: Queue/Backlog → Active → Waiting/Assigned to me → Done.
- **Five operations:** `create_task`, `move_to_active`, `assign_to_me(reason)`, `complete_task`, `add_comment(status)`.
- **Reconciliation via heartbeat** every 30 min: find Active tasks with no updates >24h (stalled), list tasks assigned to human, report summary only if issues found.
- **Key insight:** "I fixed the black box problem by wiring up [external system] as the source of truth. Tasks get created when work starts, updated as state changes, assigned to me when human intervention is required, and closed when done."
- **Rotating heartbeat pattern:** Single heartbeat rotates through checks based on how overdue each check is. Each check has a cadence and optional time window. On each tick, run whichever check is most overdue. Batches background work, keeps costs flat.
- **Cheap model for heartbeat:** All heartbeat checks run on cheapest available model. If a check finds real work, it spawns the appropriate agent/session for execution.

### awesome-openclaw-usecases: Reasoning Sync

Extends MoltFounders by externalizing agent reasoning into task descriptions and streaming sub-step completions as comments. Uses bash scripts wrapping REST APIs. Useful for observability when tasks are complex multi-step operations.

### Dan Cleary / Converge: Agent-Friendly Task Dashboard

Custom web dashboard where "the agent is the primary user." Key insight: "None of the UI is fancy or groundbreaking, the real benefit comes from designing the API to be extremely agent friendly." This is the "build your own" path — compelling if you're willing to maintain a custom web app.

### ClawBoard (Wadera): Docker-Ready Dashboard

PostgreSQL-backed dashboard with Kanban task board, session browser, real-time monitoring, and `clawbeat` watchdog pattern. Most feature-complete dashboard project. Heavy infrastructure requirements.

### Agent Board (quentintou): Multi-Agent Task Board with DAG Dependencies

Purpose-built for AI agent teams. Kanban + DAG dependencies + MCP server + auto-retry + audit trail. Overkill for single-agent use, but the DAG dependency model is relevant for task decomposition.

---

## Relevant Skills (Reference Only)

For agents with zero-trust posture — reference architectures, not install candidates:

- **`agent-autopilot`**: Self-driving agent workflow with heartbeat-driven task execution and long-term memory
- **`agent-task-manager`**: Multi-step stateful agent orchestration
- **`task-resume`**: Interrupted-task resume workflow with queueing and recovery
- **`subagent-driven-development`**: Task decomposition pattern for implementation plans

---

## Key Sources

| Source | Finding |
|--------|---------|
| OpenClaw Heartbeat Docs | `lightContext`, `isolatedSession`, `activeHours`, `target` configuration |
| MoltFounders Runbook | Rotating heartbeat, external system as source of truth, reconciliation, cheap model |
| awesome-openclaw-usecases | Bash scripts, reasoning sync via comments, heartbeat reconciliation |
| Lobster official docs | Deterministic pipelines, approval gates, resume tokens, `llm-task` |
| ClawBoard (Wadera) | PostgreSQL dashboard, `clawbeat` watchdog |
| Agent Board (quentintou) | DAG dependencies, heartbeat-polling pickup |
| Dan Cleary / Converge | Agent-first API design |
| OpenClaw GitHub #29215 | `heartbeat.target` defaults to "none" — notifications silently dropped |
| Lobster PR #20, #27 | Sub-workflow loops and flow directives both unmerged |
