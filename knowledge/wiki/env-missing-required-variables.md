---
title: .env missing required variables causes silent integration failures
category: Decisions
status: active
date: 2026-04-22
tags: [env-vars, integrations, silent-failure, credentials, openclaw, landmine]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# `.env` missing required variables causes silent integration failures

## What breaks

The container starts cleanly. The agent reports operational status.
Integrations — email, calendar, todoist, research APIs — silently fail
because the environment variables they need aren't present. The agent
says it tried and got an error; the operator assumes the integration
is flaky.

## How to detect

Cross-reference the environment variables declared in `docker-compose.yml`
against those defined in `~/.openclaw/.env`:

```bash
# Vars the compose file expects
grep -oP '\$\{[A-Z_]+\}' docker-compose.yml | sort -u

# Vars actually defined
grep -oP '^[A-Z_]+=' ~/.openclaw/.env | sed 's/=$//' | sort -u

# Diff reveals the gap
```

Per-integration smoke tests catch the rest:

- `himalaya account check` for email
- `todoist projects` for Todoist
- `gh auth status` for GitHub
- `tavily search test` for Tavily research
- `quote AAPL` for Yahoo Finance (no auth, but exercises the path)

## Root cause

Each integration the init wizard enables adds required env vars to the
generated `.env`, but those vars aren't present if:

- `.env` was created manually (outside the wizard)
- An integration was added later and `.env` wasn't updated
- `.env` was copied from a template that didn't match the enabled
  integration set
- A secret rotated and only the value changed in some places

The compose file will accept missing vars (compose uses them as empty
strings unless `${VAR?error}` syntax is used), and the integration tool
will launch but fail auth at runtime.

## Fix or workaround

Use the integration layer's declared env var registry as the source of
truth. For each enabled integration:

| Integration | Required Env Vars |
|---|---|
| Email (himalaya) | — (uses himalaya config) |
| Calendar (iCal) | `ICAL_USER`, `ICAL_PASS`, `ICAL_SERVER` |
| Tasks (Todoist) | `TODOIST_API_KEY` |
| Research (Tavily) | `TAVILY_API_KEY` |
| Code (GitHub) | `GITHUB_TOKEN` (via `gh auth`) |

File permissions on `.env` must be `0600`:

```bash
chmod 600 ~/.openclaw/.env
```

Token format validation catches malformed values before the container
starts. Credential health probes (see
[[credential-health-probes]]) catch rotations that
invalidated existing keys.

## Provenance

Documented in the 14-landmine table of the v2026.4.14 compiled reference.
ClawHQ's generator emits a `.env` containing exactly the variables the
enabled integrations require, with mode 0600, and validates token formats
at write time.

## See also

- [[integration-layer]]
- [[credential-health-probes]]
