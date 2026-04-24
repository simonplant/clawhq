---
title: System prompt assembly
category: Decisions
status: active
date: 2026-04-22
tags: [prompt, boot, context, budget, openclaw, concept]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# System prompt assembly

The prompt builder (`src/agents/prompt-builder.ts`) constructs the
agent's system prompt in a fixed order on every turn. Understanding
this order is essential for managing context budgets and debugging
why the agent is (or isn't) behaving a certain way.

## Assembly order

```
1. Identity Section
   ├── SOUL.md content
   ├── IDENTITY.md content
   └── identity.* from openclaw.json (name, theme, emoji)

2. Skills Section
   ├── ## voice-call
   │   └── Content of voice-call/SKILL.md
   ├── ## lobster
   │   └── Content of lobster/SKILL.md
   └── (each loaded skill whose tools are available)

3. Tools Section
   └── Structured function definitions sent to model API

4. Workspace Bootstrap Files
   ├── AGENTS.md
   ├── USER.md (main session only)
   ├── TOOLS.md
   ├── HEARTBEAT.md
   └── BOOTSTRAP.md (if present and not skipped)

5. Memory Section
   ├── MEMORY.md (main session only, never group contexts)
   └── memory/YYYY-MM-DD.md (today + yesterday)

6. Context Files
   └── Any additional content from hooks (bootstrap-extra-files)
```

## Skill injection rule

A skill is included in the system prompt only if **all three** conditions
hold:

1. The skill is loaded — not disabled, passes the allowlist.
2. At least one of the skill's tools is available — passes tool policy.
3. The session's prompt mode includes skills.

If a skill seems missing, work through these conditions in order.
"Passes the allowlist" and "passes tool policy" are independent checks
that both have to succeed.

## Truncation

Two limits apply:

| Limit | Default | Scope |
|---|---|---|
| `bootstrapMaxChars` | 20,000 chars | Per-file cap |
| `bootstrapTotalMaxChars` | 150,000 chars | Aggregate across all bootstrap files |

Character counts, not tokens (150K chars ≈ 50K tokens). Files that
exceed the per-file cap are silently truncated — see
[[identity-files-exceed-bootstrap-max-chars]].

Use `/context list` in-session to see exactly what was loaded, what was
truncated, and what was missing. This is the first command to run when
debugging unexpected agent behavior.

## Conditional loading

- **Main session only:** `USER.md`, `MEMORY.md`. Group chats and
  shared contexts do not load these, protecting personal information
  from cross-context leakage.
- **Hook-gated:** `BOOT.md` loads only if `hooks.internal.enabled: true`
  and the `boot-md` hook is enabled.
- **Optional:** `BOOTSTRAP.md` is only loaded for brand-new workspaces.
  After initial setup, set `agent.skipBootstrap: true` or delete the
  file.
- **Heartbeat runs:** With `lightContext: true`, only `HEARTBEAT.md`
  loads from the workspace — bypassing the rest to save tokens.

## Implications for context budget

The assembly order determines what gets cut first when the window is
tight. Items at the bottom of the order are more vulnerable to being
squeezed out by growth at the top. Keep SOUL.md and AGENTS.md lean so
that memory and recent conversation have room to breathe.

## See also

- [[files-are-the-agent]]
- [[workspace-as-agent]]
- [[memory-system]]
- [[soul-md]]
- [[agents-md]]
- [[bootstrap-md]] — first-run-only fragment loaded when the workspace has no state
- [[identity-md]]
- [[tools-md]]
- [[heartbeat-md]]
- [[user-md]]
- [[identity-files-exceed-bootstrap-max-chars]]
