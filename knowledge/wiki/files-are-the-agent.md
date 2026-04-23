---
title: Files are the agent
category: Decisions
status: active
date: 2026-04-22
tags: [philosophy, workspace, identity, openclaw, concept]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# Files are the agent

The agent's identity, behavior, memory, and operating rules live in plain
Markdown files on disk. The LLM is the raw intelligence; the files are
the personality, constraints, and accumulated knowledge.

## Why it matters

This is OpenClaw's key architectural commitment. Every other design
choice follows from it:

- You can edit an agent with `vim`. No database migration, no API call,
  no dashboard.
- You can version-control an agent with git. Personality evolves as a
  diffable history.
- You can copy a workspace to another server and get an identical agent.
  No vendor lock-in, no serialization format specific to OpenClaw.
- You can reason about what the agent knows by reading the files it
  loads — there is no hidden state, no "learned" behavior the operator
  can't inspect.
- If the agent forgets something important, the question is always
  "did it get written to disk?" — not "did the model retain it?"

## How it works

OpenClaw assembles the agent at session start by reading a specific set
of files from the workspace and injecting them into the system prompt.
See [[system-prompt-assembly]] for the exact order.

Eight filenames are auto-loaded at boot: `SOUL.md`, `AGENTS.md`,
`USER.md`, `TOOLS.md`, `IDENTITY.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, and
`MEMORY.md`. Files with other names are not injected — the agent can
only see them by explicit tool call. This is a constraint, not a bug:
it forces the operator to separate "what the agent knows at all times"
from "what the agent can fetch when needed."

The corollary: **the model only remembers what gets written to files.**
Conversation context doesn't survive compaction. If it matters, persist
it. See [[memory-system]].

## Related principles

- [[workspace-as-agent]] — the workspace is the complete
  agent definition, not a subset of it.
- [[key-principles]] — "Start with least privilege,
  expand deliberately" and "Treat external input as hostile" both depend
  on the file-level transparency this principle provides.

## See also

- [[workspace-as-agent]]
- [[system-prompt-assembly]]
- [[soul-md]]
- [[agents-md]]
