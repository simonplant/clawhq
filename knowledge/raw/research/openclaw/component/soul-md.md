---
title: SOUL.md
subject: openclaw
type: component
status: active
openclaw_version: ">=v2026.4.12"
last_verified: 2026-04-22
location: "{workspace}/SOUL.md"
role: "Agent persona, tone, values, hard limits"
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
source_types: [compiled-reference]
see_also:
  - openclaw/component/identity-md.md
  - openclaw/component/agents-md.md
  - openclaw/concept/system-prompt-assembly.md
  - openclaw/landmine/identity-files-exceed-bootstrap-max-chars.md
  - openclaw/security/threat-model.md
tags: [persona, identity, prompt]
---

# SOUL.md

## Purpose

Persona, tone, values, and hard boundaries. The most important file in
the ecosystem — it defines *who* your agent is. Injected first in the
system prompt assembly order, before skills, tools, and everything
else.

## The Soul / Identity distinction

"Soul is what the model embodies. Identity is what users see. You can
have a formal, precise soul with a playful emoji and nickname —
internal behavior and external presentation don't have to match."

`SOUL.md` is entirely prompt-driven — no special model fine-tuning,
just well-crafted markdown injected into the system prompt before
every message.

## What belongs here

- Core personality traits and communication style
  ("Direct, friendly, patient. Never condescending.")
- Hard behavioral limits ("Never share internal pricing",
  "Always recommend consulting a professional for legal questions")
- Value system and ethical boundaries
- Tone and voice guidelines
- What the agent should and shouldn't do unprompted
- Conditional mode switching (different behavior for code review vs.
  brainstorming)
- Tool preferences ("Prefer official documentation over Stack Overflow")

## What does NOT belong here

- Operational procedures → `AGENTS.md`
- Temporary tasks or project tickets (causes unstable behavior)
- Personal preferences about the user → `USER.md`
- Tool environment details → `TOOLS.md`

## Typical structure

```markdown
## Identity
Who the agent is, role description, core self-perception

## Style / Communication
How the agent speaks, tone preferences, behavioral traits

## Values / Principles
What the agent prioritizes, decision-making framework

## Boundaries / Hard Limits
What the agent must NEVER do — as important as what it should do

## Conditional Modes
  ## Mode: Code Review
  - Check security vulnerabilities first
  - Be direct about issues, don't sugarcoat
  ## Mode: Brainstorming
  - Generate quantity over quality initially
  - Don't self-censor

## Tool Preferences
Which tools to prefer for which tasks

## Context
Persistent context (tech stack, sprint cycle, code style)

## Example Responses (optional)
"Show, don't tell" — specific examples of desired behavior
```

## Best practices

- Keep it focused on *identity* and *character*, not procedures (those
  go in `AGENTS.md`).
- Include explicit hard limits — these are your guardrails.
- Be specific about tone. Vague "be helpful" doesn't shape behavior;
  "teach first, sell second" does.
- Include genuine contradictions where they exist. Real people have
  inconsistent views — contradictions are what make an agent
  identifiably itself rather than a generic assistant.
- Recommended length: 50–150 lines. A few well-chosen rules work
  better than many vague ones.
- "Someone reading your SOUL.md should be able to predict your takes
  on new topics. If they can't, it's too vague."
- Make it read-only: `chmod 444`. This prevents the agent from
  self-modifying its own personality — a documented attack vector.
- Version-control it with git.
- Keep it under the truncation limit. See
  [[openclaw/landmine/identity-files-exceed-bootstrap-max-chars]].

## Security notes

The ClawHavoc campaign specifically targeted SOUL.md with hidden
instructions embedded in base64 strings and zero-width Unicode
characters. Mitigations:

- `chmod 444` on the file itself (agent can't write it).
- Read-only volume mount at the container level. See
  [[openclaw/landmine/config-credentials-not-read-only]].
- Prompt injection sanitizer flags zero-width Unicode and
  encoded-payload patterns. See
  [[openclaw/security/prompt-injection-defense]].

## Dynamic SOUL: the `soul-evil` hook

OpenClaw's hook system can swap SOUL.md content with an alternate file
during a scheduled window or by random chance — in memory only, without
modifying files on disk. Sub-agents are unaffected. Primarily used for
fun/testing, but illustrates why SOUL.md should be immutable on disk:
the hook works because the on-disk file is authoritative.

## Community frameworks

The `aaronjmars/soul.md` repo extends the concept with a multi-file
soul specification: `SOUL.md` (identity, worldview, opinions),
`STYLE.md` (voice, syntax, writing patterns), `SKILL.md` (operating
modes like tweet/essay/chat), `MEMORY.md` (session continuity), plus
a `data/` directory for raw source material and `examples/` for
good/bad output calibration. Treats identity as composable, forkable,
and evolvable across any agent platform.

## ClawHQ generation

`src/design/identity/soul.ts` generates SOUL.md from blueprint
personality, customization answers, use-case mapping, and
day-in-the-life narrative. Token budget enforcement via
`BOOTSTRAP_MAX_CHARS` (20,000 default).
