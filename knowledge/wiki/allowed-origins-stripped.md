---
title: allowedOrigins stripped after onboard breaks Control UI
category: Decisions
status: active
date: 2026-04-22
tags: [cors, gateway, control-ui, config-drift, openclaw, landmine]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# `allowedOrigins` stripped after onboard breaks Control UI

## What breaks

The Control UI returns CORS errors and cannot manage the agent via the web
interface. API calls from the browser fail at the CORS preflight stage.

## How to detect

- Browser devtools console shows CORS errors for requests to the Gateway.
- `gateway.http.allowedOrigins` is missing or empty in `openclaw.json`.
- The Control UI loads but all actions silently fail.

Check the config:

```bash
jq '.gateway.http.allowedOrigins' ~/.openclaw/openclaw.json
# Expected: an array containing your Control UI origin
```

## Root cause

OpenClaw rewrites `openclaw.json` on startup and can strip entries the
onboarding wizard didn't originally know about. `allowedOrigins` is
frequently added after initial onboard (when a user adds a non-default
Control UI origin) and can be lost on subsequent Gateway restarts that
trigger config rewrite.

## Fix or workaround

Use the golden config pattern — see
[[golden-config-pattern]]. In short:

```bash
cp ~/.openclaw/openclaw.json ~/.openclaw/config-backups/openclaw.json.golden

# On startup, restore after the gateway's config touch (~10s):
sleep 15 && cp ~/.openclaw/config-backups/openclaw.json.golden \
              ~/.openclaw/openclaw.json
```

The Gateway picks up the restored config via its dynamic config watcher —
no second restart needed.

## Provenance

Documented in the 14-landmine table of the v2026.4.14 compiled reference.
ClawHQ's config generator preserves `allowedOrigins` by construction and
the validator catches regressions on every config write.

## See also

- [[openclaw-json-schema]]
- [[golden-config-pattern]]
