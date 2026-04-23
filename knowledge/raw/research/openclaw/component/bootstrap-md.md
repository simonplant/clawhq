---
title: BOOTSTRAP.md
subject: openclaw
type: component
status: active
openclaw_version: ">=v2026.4.12"
last_verified: 2026-04-22
location: "{workspace}/BOOTSTRAP.md"
role: "First-run interview — one-time ritual to fill the workspace from conversation"
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
source_types: [compiled-reference]
see_also:
  - openclaw/component/soul-md.md
  - openclaw/component/user-md.md
  - openclaw/component/identity-md.md
  - openclaw/concept/system-prompt-assembly.md
tags: [bootstrap, onboarding, first-run]
---

# BOOTSTRAP.md

## Purpose

One-time first-run ritual. Gathers identity and context from an
initial conversation and writes the results into the proper workspace
files (`SOUL.md`, `IDENTITY.md`, `USER.md`, `AGENTS.md`, etc.).

Only present for a brand-new workspace. After setup, delete it or
use `agent.skipBootstrap: true` to prevent re-runs.

## How it works

The bootstrap ritual is an interview pattern. The agent reads
BOOTSTRAP.md and walks through it — asking the user questions, then
writing their answers to the appropriate workspace files.

A typical first-run session looks like:

```
You: Hey, let's get you set up. Read BOOTSTRAP.md and walk me through it.

Agent: [reads BOOTSTRAP.md, then starts interview]
       What should I call you? And how do you prefer to be addressed?

You: Simon. First name is fine.

Agent: Got it. What's your timezone?
...
```

By the end of the ritual, the workspace has populated `USER.md`,
`SOUL.md` (or the agent's interpretation of it), `IDENTITY.md`, and
any other templates BOOTSTRAP.md guides it through.

## Best practices

- **Run it intentionally** as your first message to a new agent.
  Don't let it fire accidentally on subsequent sessions.
- **Skip future runs** with `agent.skipBootstrap: true` when you're
  managing files manually. The interview is a convenience, not a
  requirement.
- **Delete after use.** A populated BOOTSTRAP.md in an established
  workspace is just wasted context budget.

## Truncation limits

BOOTSTRAP.md is subject to aggressive truncation because it's usually
the longest identity file by design:

| Limit | Default | Scope |
|---|---|---|
| `bootstrapMaxChars` | 20,000 | Per-file cap |
| `bootstrapTotalMaxChars` | 150,000 | Aggregate across all bootstrap files |

Large bootstrap files are truncated silently. If your bootstrap
interview gets cut off partway through, this is why. See
[[openclaw/landmine/identity-files-exceed-bootstrap-max-chars]].

## After bootstrap

The pattern is:

1. Run BOOTSTRAP.md once.
2. Review the generated `SOUL.md`, `USER.md`, `IDENTITY.md`.
3. Edit by hand where the interview missed nuance or picked up too
   much from one conversation.
4. Delete BOOTSTRAP.md (or set `skipBootstrap: true`).
5. Set `chmod 444` on SOUL.md and IDENTITY.md.

Bootstrap is scaffolding — it gets you to a first draft. The real
personality is shaped by your edits afterward and by ongoing curation
of MEMORY.md.
