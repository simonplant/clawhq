---
title: USER.md
subject: openclaw
type: component
status: active
openclaw_version: ">=v2026.4.12"
last_verified: 2026-04-22
location: "{workspace}/USER.md"
role: "Context about the human — preferences, timezone, work context"
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
source_types: [compiled-reference]
see_also:
  - openclaw/component/memory-md.md
  - openclaw/component/soul-md.md
  - openclaw/concept/system-prompt-assembly.md
tags: [user, personalization, context]
---

# USER.md

## Purpose

Who you are, how to address you, your preferences, timezone, work
context, communication style. The personalization layer — what makes
the agent feel like it *knows* you rather than starting cold.

## Session gating

**Loaded in main/private sessions only.** Never loads in group chats
or shared contexts. Same gating as MEMORY.md. This is enforced by the
prompt builder; it is not an operator convention.

Rationale: a group chat is a shared context where the agent might
respond to multiple people. Leaking the main user's preferences or
personal facts into that context is both an information leak and a
behavioral hazard (the agent addressing group members as if they were
the main user).

## What belongs here

- Your name and how you prefer to be addressed
- Timezone and location (relevant for scheduling, weather, etc.)
- Professional context (role, company, current projects)
- Communication preferences (direct answers vs. explanations,
  verbosity level)
- Dietary restrictions, health context, or other personal facts the
  agent needs
- Authorization levels (e.g., "Can approve refunds up to $50")
- Output formatting preferences
- Recurring constraints the agent should know

## What does NOT belong here

- The agent's own persona → `SOUL.md`
- Operating rules → `AGENTS.md`
- Tool environment details → `TOOLS.md`
- Time-bounded context (ongoing conversations) → daily memory logs
- Things you'd be uncomfortable having loaded every session (sensitive
  history, one-off context) → `MEMORY.md` (retrieved on demand)

## Best practices

- **Static file.** USER.md stays static until you manually update it
  — it's not a live database.
- **Explicit beats implicit.** "Direct answers. No filler.
  Copy-pasteable commands." shapes behavior far more than hoping the
  agent figures it out.
- **Include what's awkward to re-explain.** Anything you'd otherwise
  say at the start of every conversation.
- **No strict size limit, but still reasonable.** Subject to
  `bootstrapMaxChars`. If USER.md keeps growing, some of it probably
  belongs in `MEMORY.md` (retrieved on demand via
  `memory_search`) rather than loaded every session.
- **Sensitive info:** consider whether it truly needs to be in every
  session. If not, move it to `MEMORY.md` and let semantic search find
  it when relevant.

## The main-session-only property

Combined with `MEMORY.md`, `USER.md` forms the private-context pair.
Both files:

- Load in the main (DM) session.
- Do not load in group/multi-user contexts.
- Are controlled by `session.dmScope` configuration and the prompt
  builder's conditional logic.

For multi-user workspaces or team agents, the pattern is:

- Shared operating rules in `AGENTS.md` (always loads).
- Shared persona in `SOUL.md` (always loads).
- Per-user context in `USER.md`, loaded only in that user's main
  session.

## Drift and evolution

Over time, the agent may notice patterns and suggest promoting them
from daily notes into USER.md or MEMORY.md. Explicit instructions are
more reliable than hoping the agent figures it out — if there's a
pattern you want the agent to remember, tell it to write it to
USER.md directly.
