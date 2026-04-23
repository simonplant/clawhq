---
title: Container user not UID 1000 causes volume permission errors
category: Decisions
status: active
date: 2026-04-22
tags: [docker, uid, permissions, volumes, openclaw, landmine]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# Container user not UID 1000 causes volume permission errors

## What breaks

Permission errors on mounted volumes. The agent fails to read or write
workspace files, credentials, or session transcripts. Docker-level file
ownership doesn't match the host user's UID, so bind-mounted directories
appear read-only or invisible to the container process.

## How to detect

- Container logs show EACCES or EPERM on workspace operations.
- `ls -la ~/.openclaw/` on the host shows files owned by UIDs other than
  the container's running UID.
- `docker exec <container> id` returns a UID other than 1000.

Check the compose file:

```bash
grep -E 'user:' docker-compose.yml
# Expected: user: "1000:1000"
```

## Root cause

OpenClaw's container image is built expecting UID 1000 for its runtime
user. When a deployment overrides this (either by leaving `user:`
unspecified and inheriting root, or by specifying a different UID),
volume ownership on the host side no longer matches the container-side
UID — and with `no-new-privileges` set, the container can't fix up
ownership at runtime.

The specific failure mode is:

- Host workspace directory is owned by the operator's UID (often 1000).
- Container runs as root (UID 0) or a different non-root user.
- Writes to bind-mounted volumes fail permission checks, or succeed but
  create host-side files with wrong ownership.

## Fix or workaround

Specify UID 1000 explicitly in compose:

```yaml
services:
  openclaw:
    image: openclaw/agent:latest
    user: "1000:1000"
    security_opt:
      - no-new-privileges:true
    # ... rest of hardening
```

And ensure host-side `~/.openclaw/` is owned by UID 1000:

```bash
sudo chown -R 1000:1000 ~/.openclaw/
```

If your operator account isn't UID 1000, adjust both sides to match.
Never use UID 0 (root) — see [[container-hardening]].

## Provenance

Documented in the 14-landmine table of the v2026.4.14 compiled reference.
ClawHQ's generated `docker-compose.yml` hardcodes `user: "1000:1000"`.

## See also

- [[two-stage-docker-build]]
- [[container-hardening]]
