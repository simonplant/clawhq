---
title: Golden config pattern
subject: openclaw
type: operation
status: active
openclaw_version: ">=v2026.4.12"
last_verified: 2026-04-22
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
source_types: [compiled-reference]
see_also:
  - openclaw/landmine/allowed-origins-stripped.md
  - openclaw/landmine/trusted-proxies-stripped.md
  - openclaw/landmine/dangerously-disable-device-auth-missing.md
  - openclaw/configuration/openclaw-json-schema.md
tags: [config, resilience, startup, operations]
---

# Golden config pattern

## Purpose

Prevent OpenClaw's config-rewrite-on-startup behavior from silently
stripping fields the onboarding wizard didn't originally author.
Affected landmines:

- [[openclaw/landmine/allowed-origins-stripped]]
- [[openclaw/landmine/trusted-proxies-stripped]]
- [[openclaw/landmine/dangerously-disable-device-auth-missing]]

## Preconditions

- The deployment has a known-good `openclaw.json` containing all
  required fields.
- A writable location for backups (`~/.openclaw/config-backups/`).
- Ability to run a post-start script in your deployment (compose
  entrypoint, systemd unit, or cron `@reboot` entry).

## Procedure

Save the current config as the "golden" copy:

```bash
mkdir -p ~/.openclaw/config-backups
cp ~/.openclaw/openclaw.json \
   ~/.openclaw/config-backups/openclaw.json.golden
```

Arrange for the golden copy to be restored after each Gateway
startup. The Gateway performs its config-rewrite within roughly 10
seconds of start; the restore should happen after that window:

```bash
#!/usr/bin/env bash
# /usr/local/bin/restore-golden-config.sh
set -euo pipefail

sleep 15  # let the gateway's config touch complete
cp ~/.openclaw/config-backups/openclaw.json.golden \
   ~/.openclaw/openclaw.json
```

Wire this into your deployment:

**systemd:**

```ini
[Unit]
After=openclaw-gateway.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/restore-golden-config.sh
```

**compose (via healthcheck or post-start command):**

```yaml
services:
  config-restore:
    image: alpine
    depends_on:
      - openclaw
    volumes:
      - ~/.openclaw:/config
    command: >
      sh -c "sleep 15 &&
             cp /config/config-backups/openclaw.json.golden
                /config/openclaw.json"
    restart: "no"
```

## Why the delay works

The Gateway's startup sequence:

1. Load config from disk.
2. Validate, normalize, write back.
3. Enter the main loop with a dynamic config watcher active.

The write-back in step 2 is what strips fields. The watcher in step 3
reacts to subsequent changes. If we overwrite after step 3 begins,
the watcher picks up the restored config and applies it live — no
second restart needed.

## Postconditions

- `openclaw.json` on disk matches the golden copy.
- The Gateway's in-memory config reflects the golden values.
- Fields that were at risk of being stripped (`allowedOrigins`,
  `trustedProxies`, `dangerouslyDisableDeviceAuth`) are present.

## Validation

```bash
# Confirm the fields survived
jq '{
  allowedOrigins: .gateway.http.allowedOrigins,
  trustedProxies: .gateway.http.trustedProxies,
  deviceAuth: .gateway.dangerouslyDisableDeviceAuth
}' ~/.openclaw/openclaw.json
```

All three should return expected values, not `null`.

## When to update the golden copy

Any time you intentionally change the config:

```bash
# After making intentional changes
cp ~/.openclaw/openclaw.json \
   ~/.openclaw/config-backups/openclaw.json.golden
```

Otherwise the restore script will roll back your changes on the next
restart — the opposite of what you want.

## ClawHQ alternative

ClawHQ's config management manages this for you — every config write
goes through a validator that enforces required fields and a golden
snapshot mechanism that survives Gateway restarts. The manual pattern
documented here is for non-ClawHQ deployments.
