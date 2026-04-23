---
title: TOOLS.md
subject: openclaw
type: component
status: active
openclaw_version: ">=v2026.4.12"
last_verified: 2026-04-22
location: "{workspace}/TOOLS.md"
role: "Environment-specific tool usage notes — guidance, not permissions"
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
source_types: [compiled-reference]
see_also:
  - openclaw/configuration/openclaw-json-schema.md
  - openclaw/component/agents-md.md
tags: [tools, environment, ssh, devices]
---

# TOOLS.md

## Purpose

Documents environment-specific notes and conventions for your setup.
**Guidance only** — does not grant or revoke tool permissions. Those
are handled in `openclaw.json` via `tools.allow` / `tools.deny`.

## What belongs here

- Camera names and locations
- SSH hosts and aliases
  (e.g., `home-server → 192.168.1.100, user: admin`)
- Preferred voices for TTS
- Speaker and room names
- Device nicknames
- Notes about local tool quirks
- Preferred tools for specific tasks
- Tools that should be avoided and why
- Custom CLI wrappers or scripts the agent can use
- Skill-specific environment notes
  ("If you need local-only notes, put them in TOOLS.md")

## What does NOT belong here

- Tool definitions themselves
- Tool permissions (allow/deny)
- Anything that should be enforced rather than suggested

Those all go in `openclaw.json`. TOOLS.md is context the agent
*consults*; the config file is policy the runtime *enforces*.

## Example

```markdown
## SSH Hosts

- `home-server` → 192.168.1.100, user: admin (Linux server)
- `nas` → 192.168.1.50, user: simon (Synology)

## TTS Preferences

- Default voice: Rachel (ElevenLabs)
- For long-form: use `elevenlabs-conversational` model
- Avoid robotic voices for morning briefs

## Custom CLI Wrappers

- `todoist` — custom Python wrapper, see workspace/todoist.py
- `quote AAPL` — fetches latest quote; no auth needed

## Avoid

- Direct `ffmpeg` calls — use the wrapped `media` tool instead
- `git push --force` unless explicitly requested
```

## Relationship to openclaw.json

TOOLS.md documents *what tools exist and how to use them well*; the
config file documents *which tools the agent is allowed to call at
all*. A tool can be listed in TOOLS.md without being enabled, and a
tool can be enabled without being documented here — but neither
situation is ideal. Keep them in sync.
