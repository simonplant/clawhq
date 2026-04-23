---
title: Credential health probes
subject: openclaw
type: security
status: active
openclaw_version: ">=v2026.4.12"
last_verified: 2026-04-22
location: "src/secure/credentials/probes.ts"
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
source_types: [compiled-reference]
see_also:
  - openclaw/landmine/env-missing-required-variables.md
  - openclaw/operation/integration-layer.md
  - openclaw/finding/production-discoveries.md
tags: [credentials, probes, health, integrations]
---

# Credential health probes

## Purpose

Detect credential failures before they silently break integrations.
Tokens rotate, permissions change, upstream APIs tighten their auth
requirements — credential expiry is one of the eight production
discoveries that motivated ClawHQ's tooling. See
[[openclaw/finding/production-discoveries]].

## Probes

Each probe runs a minimal, authenticated operation against the target
service. Timeout is 10 seconds per probe.

| Integration | Probe | What it tests |
|---|---|---|
| Email (IMAP) | `himalaya account check` | IMAP + SMTP auth, server reachable |
| Calendar (CalDAV) | CalDAV PROPFIND request | Auth valid, calendar accessible |
| Tasks (Todoist) | `todoist projects` list | API key valid, API reachable |
| Code (GitHub) | `gh auth status` | PAT valid, scopes sufficient |
| Research (Tavily) | Search query | API key valid, quota remaining |
| Finance (Yahoo) | Quote fetch | Endpoint reachable (no auth) |

## Behavior

Probes run on a schedule configurable per blueprint. Failures trigger
alerts with specific remediation steps — not just "integration broken"
but "GitHub PAT at path X has insufficient scopes; need `repo`,
currently has `public_repo`."

Where APIs expose credential expiry (OAuth tokens with refresh,
service-specific expiry endpoints), probes track it and emit
7-day-advance warnings. A credential that's about to expire is an
incident waiting for the operator to notice; the probe makes it an
actionable task instead.

## Supply chain security adjacent to probes

Credential probes sit alongside the broader supply-chain security
controls:

| Control | What it does |
|---|---|
| Skill vetting | Regex-based scanning for outbound HTTP, shell execution, file escape patterns |
| Approval gate | High-stakes actions (send, delete, purchase) require user approval via Telegram |
| Egress firewall | Port-aware domain allowlist prevents unauthorized outbound connections |

Secret scanning via [gitleaks](https://github.com/gitleaks/gitleaks)
(800+ patterns, actively maintained) runs as part of `clawhq scan` to
catch secrets that ended up in the wrong file.

## Running probes manually

```bash
clawhq creds              # run all probes
clawhq creds --integration todoist   # run one probe
```

Output includes remediation hints for any failure:

```
FAIL  Todoist API key
      Status: 401 Unauthorized
      Remediation: Rotate TODOIST_API_KEY in ~/.openclaw/.env.
                   Get a new key at https://todoist.com/app/settings/integrations
                   Restart the agent after rotation.
```

## Relationship to .env hygiene

Probes catch the runtime half of credential problems. The startup half
is [[openclaw/landmine/env-missing-required-variables]] — an env var
that was never set at all will manifest as a probe failure with a
specific "missing variable" remediation, rather than as a silent
integration failure.
