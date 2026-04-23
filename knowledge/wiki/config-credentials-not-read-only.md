---
title: Config and credentials not mounted read-only lets agent modify itself
category: Decisions
status: active
date: 2026-04-22
tags: [docker, volumes, security, self-modification, openclaw, landmine]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# Config and credentials not mounted read-only lets agent modify itself

## What breaks

The agent can modify its own `openclaw.json` and its own credentials.
This is a security problem on its face — a prompt injection attack can
rewrite the agent's tool policy, channel config, or identity files — and
it also causes config drift in benign cases where the agent makes
"helpful" edits during a session.

The ClawHavoc campaign specifically targeted SOUL.md with hidden
instructions embedded in base64 strings and zero-width Unicode
characters, which is a downstream consequence of the same mount
permissions.

## How to detect

Inspect the compose file for volume flags:

```bash
grep -A3 'volumes:' docker-compose.yml | grep -E 'openclaw\.json|\.env|credentials'
# Expected: mounts end with ":ro"
```

At runtime, verify from inside the container:

```bash
docker exec <container> touch /config/openclaw.json
# Expected: "Read-only file system" error
```

## Root cause

Docker bind mounts are read-write by default. Without the `:ro` flag or
`read_only: true` on specific volumes, the container has full write
access to whatever the host exposed. For most application data this is
fine; for the agent's own configuration and its credentials, it is not.

The agent's threat model assumes untrusted input can reach the model at
any time (via messages, web fetches, document reads). If the agent can
write to its own config, that untrusted input has a path to persistent
privilege escalation.

## Fix or workaround

Mount config, credentials, and identity files read-only. The workspace's
memory directory and daily logs need to stay writable — scope the
read-only flag to specific paths:

```yaml
services:
  openclaw:
    volumes:
      # Read-only: config, credentials, identity
      - ~/.openclaw/openclaw.json:/config/openclaw.json:ro
      - ~/.openclaw/.env:/config/.env:ro
      - ~/.openclaw/credentials:/config/credentials:ro
      - ~/.openclaw/workspace/SOUL.md:/workspace/SOUL.md:ro
      - ~/.openclaw/workspace/IDENTITY.md:/workspace/IDENTITY.md:ro

      # Read-write: memory, sessions, cron runs
      - ~/.openclaw/workspace/memory:/workspace/memory
      - ~/.openclaw/workspace/MEMORY.md:/workspace/MEMORY.md
      - ~/.openclaw/sessions:/sessions
      - ~/.openclaw/cron/runs:/cron/runs
```

Additionally `chmod 444` on SOUL.md and IDENTITY.md on the host side —
belt and suspenders.

## Provenance

Documented in the 14-landmine table of the v2026.4.14 compiled reference.
Related to the ClawHavoc campaign's SOUL.md-targeting attacks.
ClawHQ's generated compose applies read-only flags to config, credentials,
and identity paths by default.

## See also

- [[container-hardening]]
- [[threat-model]]
- [[soul-md]]
