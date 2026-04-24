---
title: AGENTS.md
category: Features
status: active
date: 2026-04-22
tags: [workflow, sop, memory, safety, openclaw, component]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# AGENTS.md

## Purpose

Operating instructions, workflow rules, memory management directives,
behavioral priorities. If `SOUL.md` answers "who are you?", `AGENTS.md`
answers "what do you do and how?"

The top-level operating contract: priorities, boundaries, workflow,
and quality bar. For agents with complex workflows, this is the
largest and most important file.

## What belongs here

- Session startup checklist (what to read, in what order)
- Memory management rules (when to write, what goes where)
- Safety rules and approval gates
- Communication rules (when to speak vs. stay quiet, especially in
  group chats)
- Git workflow and commit conventions
- Tool usage guidelines and restrictions
- Checklists routing table (mapping operations to files in
  `workspace/checklists/`)
- Skill notes and tool-specific guidance
- Shared spaces configuration (for multi-agent setups)

## What does NOT belong here

- Personal preferences about the user → `USER.md`
- Temporary tasks or project tickets (causes drift)
- Environment-specific details like SSH hosts → `TOOLS.md`
- Persona, tone, values → `SOUL.md`

## Best practices

- **Stable rules, not temporary tasks.** If something is time-bounded,
  it belongs in daily memory, not here.
- **Explicit memory hygiene instructions.** This is where you
  prevent the agent from losing important context.
- **Gate MEMORY.md loading to main sessions.** Include the rule
  "Main session only: Read MEMORY.md". Prevents private memory from
  leaking into group chats.
- **Use the checklists routing table.** Reference operation-specific
  checklists in `workspace/checklists/` (deploy, gateway restart,
  config patch) rather than bloating AGENTS.md itself.
- **Default safety template:** "Don't dump directories or secrets into
  chat. Don't run destructive commands unless explicitly asked. Don't
  send partial/streaming replies to external messaging surfaces."

## Example structure

```markdown
## Every Session

Before doing anything else:
1. Read `SOUL.md` — this is who you are
2. Read `USER.md` — this is who you're helping
3. Read `memory/YYYY-MM-DD.md` (today + yesterday) for recent context
4. If in MAIN SESSION: Also read `MEMORY.md`

## Memory Rules

- Decisions, preferences, durable facts → `MEMORY.md`
- Day-to-day notes and running context → `memory/YYYY-MM-DD.md`
- If someone says "remember this," write it immediately
- After completing meaningful work: git commit + push

## Safety

- Show the plan, get explicit approval, then execute
- No autonomous bulk operations
- No destructive commands without confirmation

## Checklists

| Operation | Checklist |
|---|---|
| Deploy | `checklists/deploy.md` |
| Gateway restart | `checklists/gateway-restart.md` |
| Config patch | `checklists/config-patch.md` |
```

## Truncation limit

Subject to the same `bootstrapMaxChars` cap as other identity files —
20,000 chars per file, 150,000 aggregate. Long AGENTS.md files are the
most common cause of silent truncation. Use the checklists routing
table rather than inlining everything. See
[[identity-files-exceed-bootstrap-max-chars]].

## ClawHQ generation

`src/design/identity/agents.ts` generates AGENTS.md from blueprint
toolbelt (tools with categories), skill inventory, and autonomy model
(what requires approval).

## See also

- [[soul-md]]
- [[user-md]]
- [[system-prompt-assembly]]
- [[memory-system]]
- [[identity-files-exceed-bootstrap-max-chars]]
- [[tools-md]] — sibling file: environment-specific tool notes (guidance, not policy)
