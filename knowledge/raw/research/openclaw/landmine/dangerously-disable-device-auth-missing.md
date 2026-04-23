---
title: Missing dangerouslyDisableDeviceAuth causes device signature invalid loop
subject: openclaw
type: landmine
status: active
severity: critical
affects: "All Docker deployments"
openclaw_version: ">=v2026.4.12"
last_verified: 2026-04-22
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
source_types: [compiled-reference]
see_also:
  - openclaw/configuration/openclaw-json-schema.md
  - openclaw/operation/two-stage-docker-build.md
tags: [auth, device, docker, boot-failure]
landmine_number: 1
---

# Missing `dangerouslyDisableDeviceAuth` causes device signature invalid loop

## What breaks

When the key is absent (or `false`) in `openclaw.json` and the agent runs
inside Docker, the Gateway enters a "device signature invalid" loop on
startup. The agent becomes inaccessible — the Control UI cannot connect,
messaging channels fail to authenticate, and the CLI returns device auth
errors on every call.

## How to detect

- Gateway logs show repeated "device signature invalid" entries.
- `openclaw doctor` flags the config check.
- `clawhq doctor` auto-fix handles this case.

Check the config directly:

```bash
jq '.gateway.dangerouslyDisableDeviceAuth' ~/.openclaw/openclaw.json
# Expected: true (for Docker deployments)
```

## Root cause

OpenClaw's device auth ties a persistent device signature to the Gateway's
install identity. In a containerized deployment, the container's ephemeral
identity collides with the persisted signature on every restart, invalidating
it. The `dangerouslyDisableDeviceAuth` escape hatch bypasses this check for
deployments where transport-level auth (tokens, loopback binding, reverse
proxy auth) already covers the threat model.

## Fix or workaround

Set the key explicitly in `openclaw.json`:

```json5
{
  gateway: {
    dangerouslyDisableDeviceAuth: true,
  },
}
```

Do not rely on the onboarding wizard to preserve this — it can be stripped
by subsequent config writes (see the golden-config pattern in
[[openclaw/operation/golden-config-pattern]]).

## Provenance

Discovered during production container deployment. Documented in the
14-landmine table of the v2026.4.14 compiled reference. ClawHQ's config
generator (`src/design/configure/generate.ts`) sets this by construction;
the validator (`src/config/validate.ts`) enforces continuously.
