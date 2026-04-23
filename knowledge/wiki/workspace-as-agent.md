---
title: Workspace as agent
category: Decisions
status: active
date: 2026-04-22
tags: [workspace, architecture, identity, openclaw, concept]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# Workspace as agent

A workspace is the complete definition of an agent. Everything that
makes one agent different from another — persona, operating rules, user
context, memory, environment — lives in `~/.openclaw/workspace/` (or
whatever path the agent is configured with).

## Why it matters

OpenClaw supports multiple agents via `agents.list[]` with per-agent
workspace paths. Each agent binds to its own workspace, and the
workspace is the distinguishing artifact. Two agents pointed at the
same workspace are the same agent, even if they're registered under
different IDs. Two agents with different workspaces are different
agents, even if they share every config field.

This means the interesting unit for backup, migration, cloning, and
version control is the workspace directory — not `openclaw.json` and
not the container image.

## How it works

A workspace contains:

```
workspace/
├── SOUL.md          ← persona (see [[soul-md]])
├── IDENTITY.md      ← name, emoji, avatar
├── AGENTS.md        ← operating rules (see [[agents-md]])
├── USER.md          ← user context (main session only)
├── TOOLS.md         ← environment notes
├── HEARTBEAT.md     ← periodic check-in checklist
├── BOOT.md          ← startup ritual (optional)
├── BOOTSTRAP.md     ← first-run interview (one-time)
├── MEMORY.md        ← curated long-term memory
├── memory/
│   ├── YYYY-MM-DD.md ← daily logs (append-only)
│   └── archive/      ← old logs (> 30 days)
├── skills/           ← workspace-specific skills
├── hooks/            ← workspace-specific hooks (highest precedence)
├── checklists/       ← operation checklists referenced by AGENTS.md
├── canvas/           ← files for node displays
└── docs/             ← on-demand docs (NOT auto-loaded)
```

The first eight Markdown files are the "auto-loaded" set — OpenClaw
injects them into the system prompt on every session boot (conditionally
for some; see each component's page). The rest are either loaded on
demand or govern runtime behavior adjacent to the agent.

## Constraints and gotchas

- **Symlinks are silently rejected.** OpenClaw's `resolveAgentWorkspaceFilePath()`
  verifies each file's `realpath` stays strictly inside the workspace
  root. Symlinks pointing outside are ignored with no error logged.
  Maintain a source-of-truth repo separately and copy files in on
  deploy.
- **Truncation applies.** See
  [[identity-files-exceed-bootstrap-max-chars]].
- **USER.md and MEMORY.md are main-session-only.** They don't load in
  group contexts — this protects private info from leaking to group
  chats and is enforced by the prompt builder, not an operator
  convention.

## Multi-agent setups

With `agents.list[]`, each agent can have its own workspace:

```json5
{
  agents: {
    list: [
      { id: "clawdius", default: true, workspace: "/home/node/.openclaw/workspace" },
      { id: "clawdia",  workspace: "/home/node/.openclaw/agents/clawdia/agent/workspace" },
    ],
  },
}
```

Share a common `AGENTS.md` (same operating rules) while giving each a
unique `SOUL.md` (different personality). This is the pattern for an
agent fleet with a shared runbook but distinct voices.

## See also

- [[files-are-the-agent]]
- [[system-prompt-assembly]]
- [[soul-md]]
- [[agents-md]]
- [[user-md]]
