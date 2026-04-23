---
title: Identity files exceed bootstrapMaxChars and silently truncate
category: Decisions
status: active
date: 2026-04-22
tags: [workspace, truncation, bootstrap, silent-failure, openclaw, landmine]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# Identity files exceed `bootstrapMaxChars` and silently truncate

## What breaks

Identity files that grow past the per-file character limit are silently
truncated before injection into the system prompt. The agent loses
personality context, operating rules, or user details depending on which
file was clipped — with no warning that anything was lost. Behavior drifts
without obvious cause.

Truncation operates at two levels:

| Limit | Default | Scope |
|---|---|---|
| `bootstrapMaxChars` | 20,000 | Per-file cap |
| `bootstrapTotalMaxChars` | 150,000 | Aggregate across all bootstrap files |

These are character counts, not tokens (150K chars ≈ 50K tokens).

## How to detect

In-session:

```
/context list
```

This command shows exactly what's loaded, what was truncated, and what's
missing. Truncated files are flagged.

From the host:

```bash
wc -c ~/.openclaw/workspace/{SOUL,AGENTS,USER,TOOLS,HEARTBEAT,IDENTITY,BOOTSTRAP,MEMORY}.md \
  | awk '$2 != "total" { print $1, $2, ($1 > 20000 ? "OVER" : "ok") }'
```

Agents that suddenly forget their persona, stop following operating rules,
or lose awareness of user details are strong symptoms.

## Root cause

The `bootstrapMaxChars` limit exists to bound context budget used by the
auto-loaded files (see [[system-prompt-assembly]]). Without
it, a runaway SOUL.md or AGENTS.md could consume the entire context window
before the conversation even starts. The truncation is silent by design
(to avoid failing the session), but silent truncation is the failure mode
when file growth isn't monitored.

The 8 auto-loaded files are: `SOUL.md`, `AGENTS.md`, `USER.md`, `TOOLS.md`,
`IDENTITY.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, `MEMORY.md`. Any of these
can trip the limit.

## Fix or workaround

Keep each identity file under 20,000 characters. Guidelines:

- **SOUL.md**: 50–150 lines recommended. A few well-chosen rules beat
  many vague ones.
- **AGENTS.md**: Use the checklists routing table. Move operation-specific
  checklists to `workspace/checklists/` rather than bloating AGENTS.md.
- **MEMORY.md**: Aggressive curation. Durable facts only — running context
  belongs in daily memory logs.
- **USER.md**: Static preferences and context. If it keeps growing, some
  of it probably belongs in MEMORY.md or daily logs.

Monitor with a pre-commit hook or `clawhq doctor` — both flag files
approaching the limit before truncation silently kicks in.

## Provenance

Documented in the 14-landmine table of the v2026.4.14 compiled reference.
ClawHQ's identity generator (`src/design/identity/`) enforces the token
budget at generation time; `clawhq doctor` continuously validates the
`identity-size` check.

## See also

- [[soul-md]]
- [[agents-md]]
- [[user-md]]
- [[system-prompt-assembly]]
