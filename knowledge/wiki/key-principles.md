---
title: Key principles
category: Metrics
status: active
date: 2026-04-22
tags: [principles, philosophy, operations, openclaw, finding]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# Key principles

Seven principles distilled from running OpenClaw in production. Each
one has consequences across the rest of the wiki — landmines, security
decisions, configuration choices.

## 1. Files are the agent

Everything about identity, behavior, and memory is plain Markdown on
disk. You can edit with any text editor, version-control with git, and
copy to another server for an identical agent. See
[[files-are-the-agent]].

## 2. Separate identity from operations from knowledge

- `SOUL.md` = who the agent is.
- `AGENTS.md` = how it operates.
- `USER.md` = context about the human.
- `MEMORY.md` = accumulated knowledge.

Don't cross the streams. Each file has a scope, and the scopes are
chosen so that edits to one don't cascade into the others. The
temptation to put operating rules in SOUL.md or persona in AGENTS.md
leads to drift — see [[soul-md]] and
[[agents-md]] for the boundaries.

## 3. Write to disk or lose it

The model only "remembers" what gets written to files. Conversation
context doesn't survive compaction. If it matters, persist it — either
by having the agent write to daily logs or by curating MEMORY.md. This
is the one principle that most new OpenClaw operators get wrong on
their first runaway session. See
[[memory-system]].

## 4. Start with least privilege, expand deliberately

Begin with `pairing` DM policy, minimal tool access, and a single
messaging channel (Telegram is the usual pick). Add capabilities as
you gain confidence in the specific agent's behavior.

The reverse — enabling everything upfront and removing capabilities
after something goes wrong — is how most production incidents happen.
See [[threat-model]].

## 5. Treat external input as hostile

Every message, link, attachment, and web page the agent processes
could contain adversarial instructions. Use the strongest available
model, sandbox tool execution, keep secrets out of reach, and layer
defenses rather than trusting any single control.

This is not paranoia. Prompt injection and data exfiltration via
seemingly innocuous content are routine in production — the ClawHavoc
campaign targeted SOUL.md with encoded instructions, and community
memory plugins have been shown to cache adversarial content. See
[[prompt-injection-defense]].

## 6. Make identity files immutable

`chmod 444` on `SOUL.md` and `IDENTITY.md`. The agent should not be
able to rewrite its own personality. This is a documented attack
vector — if a prompt injection convinces the agent to "update its
instructions," filesystem permissions are the last line of defense
before that change becomes persistent.

Combine with read-only volume mounts at the container level. See
[[config-credentials-not-read-only]].

## 7. Monitor costs

Heartbeat and memory search can become token sinks. Two specific
recommendations:

- Use isolated cron sessions instead of native heartbeat (see
  [[heartbeat-md]] on the 170–210k input tokens
  per run observation).
- Check `/context list` regularly to see what's consuming your
  context window. Unexpected growth usually traces back to daily logs
  or a bloated `AGENTS.md`.

Costs compound silently. A heartbeat running full-context every 30
minutes for a week consumes the same tokens as ~336 conversations.
Treat the runtime cost as part of the agent's design, not an
afterthought.

## See also

- [[files-are-the-agent]]
- [[workspace-as-agent]]
- [[memory-system]]
- [[threat-model]]
- [[production-discoveries]]
