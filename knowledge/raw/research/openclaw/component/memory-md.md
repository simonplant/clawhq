---
title: MEMORY.md
subject: openclaw
type: component
status: active
openclaw_version: ">=v2026.4.12"
last_verified: 2026-04-22
location: "{workspace}/MEMORY.md"
role: "Curated long-term memory — durable facts, decisions, project summaries"
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
source_types: [compiled-reference]
see_also:
  - openclaw/concept/memory-system.md
  - openclaw/component/user-md.md
  - openclaw/configuration/memory-search.md
  - openclaw/concept/system-prompt-assembly.md
tags: [memory, long-term, curation]
---

# MEMORY.md

## Purpose

Curated, long-term memory that persists across months: decisions,
preferences, project summaries, lessons learned. The file the agent
reads when asking "what do I know about this human and their work over
time?"

Paired with daily logs (`memory/YYYY-MM-DD.md`) to form OpenClaw's
[[openclaw/concept/memory-system]] two-layer architecture. Daily logs
are append-only running context; MEMORY.md is the curated distillation.

## Session gating

**Loaded in main/private sessions only.** Never in group contexts.
Same protection as `USER.md` — enforced by the prompt builder, not an
operator convention. The `AGENTS.md` startup checklist should
explicitly state:

```markdown
If in MAIN SESSION: Also read `MEMORY.md`
```

This reinforces the gating at the behavior level.

## What belongs here

- **Decisions** that span sessions ("We chose Postgres over MongoDB
  because…")
- **Preferences** that survived multiple conversations
- **Project summaries** — one paragraph per major project, enough for
  the agent to orient without re-asking
- **Lessons learned** — things that went wrong once and shouldn't go
  wrong again
- **Recurring patterns** the agent has noticed and you've confirmed
- **Explicit "remember this"** statements from conversations

## What does NOT belong here

- Running context from a single session → daily logs
- Static personal facts (timezone, name, role) → `USER.md`
- Temporary project state (current ticket, active branch) → daily
  logs or the agent's operational tracking
- Anything that would be awkward or sensitive if the agent
  accidentally surfaced it unprompted

## Keep it short

This is the #1 rule. Anything that doesn't need to be in every
main-session load can live in daily logs, and the agent will find it
via `memory_search` when relevant. MEMORY.md is the tier 1 cost of
always-on context; daily logs are the tier 2 cost of occasional
retrieval.

A well-maintained MEMORY.md is under a few thousand characters. If
yours is pushing the `bootstrapMaxChars` limit, it's too big — not
too small. See
[[openclaw/landmine/identity-files-exceed-bootstrap-max-chars]].

## Curation ritual

Weekly:

1. Review daily logs from the past 7–14 days.
2. Extract durable patterns — things that came up multiple times, or
   once but definitively.
3. Update MEMORY.md with the distilled version.
4. Archive or clean up processed daily logs.

The agent can help with this if you ask it to. It's the kind of
bookkeeping LLMs are good at — the hard part is making time for the
conversation.

## Memory tools

The agent reaches into `MEMORY.md` (and daily logs, and any indexed
memory) via two tools:

| Tool | Purpose |
|---|---|
| `memory_search` | Semantic + keyword hybrid over indexed memory |
| `memory_get` | Targeted read by file and line range |

Both respect the session gating — even if you somehow bypass the
prompt-builder injection, `memory_search` running in a group context
won't surface MEMORY.md content without explicit override.

## Memory search internals

See [[openclaw/configuration/memory-search]] for configuration.
Summary: SQLite + `sqlite-vec`, ~400-token chunks with 80-token
overlap, 70% vector / 30% BM25 hybrid, file watcher keeps the index
fresh with 1.5s debounce.

## Lifecycle

Memory grows. ClawHQ's hot/warm/cold tiering summarizes older memory
into compressed forms — see
[[openclaw/concept/memory-system]]. MEMORY.md itself sits in the hot
tier and is the one file you curate manually; the tiering applies to
daily logs and session transcripts, not to MEMORY.md.
