---
title: Two-stage Docker build
category: Features
status: active
date: 2026-04-22
tags: [docker, build, deployment, openclaw, operation]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# Two-stage Docker build

## Purpose

Separate the OpenClaw runtime (stable, cacheable) from per-deployment
customizations (integrations, blueprint-specific binaries,
configuration). Two images, two layers of caching, one composed
result.

## Structure

```
Stage 1: openclaw:local (base image)
├── OpenClaw source (upstream)
├── apt packages: tmux, ffmpeg, jq, ripgrep (configurable per blueprint)
├── Node.js runtime + dependencies
└── Gateway + CLI + channel adapters

Stage 2: openclaw:<blueprint> (deployment image)
├── FROM openclaw:local
├── Integration binaries (himalaya, gh, etc. based on selections)
├── Blueprint-specific workspace seeding
└── Entry point + runtime config
```

Stage 1 is rebuilt when OpenClaw itself changes. Stage 2 is rebuilt
when integrations or blueprints change. Most operational deployments
hit the Stage 1 cache and only rebuild Stage 2.

## Preconditions

- Docker installed on the host.
- `docker compose` v2 available.
- External networks pre-created. See
  [[external-networks-not-created]].
- Host user UID matches the container's expected UID (1000). See
  [[container-user-not-uid-1000]].

## Build procedure

```bash
# Stage 1 — base image (cached aggressively)
docker build \
  -f Dockerfile.base \
  -t openclaw:local \
  .

# Stage 2 — deployment image (per blueprint)
docker build \
  -f Dockerfile \
  -t openclaw:clawdius \
  --build-arg BLUEPRINT=clawdius \
  .

# Deploy
docker compose up -d
```

ClawHQ's `clawhq build` wraps this with blueprint-aware composition:
it emits the right `Dockerfile`, computes the integration binary set,
and chains both stages.

## Dockerfile generator

The Dockerfile generator composes binary install fragments from
integration selections:

- **Always included:** curl, jq, rg.
- **Conditional:** himalaya (email), gh (GitHub), git from source,
  ffmpeg (media), whisper (transcription, optional ~2GB).

This is why Stage 2 rebuilds are cheap — the fragment set changes only
when the blueprint's integration list changes.

## Config generator output

`clawhq init` produces a deployment bundle. The landmines each
generated file prevents:

| File | Purpose | Landmines handled |
|---|---|---|
| `openclaw.json` | Runtime config | 1–5, 14 |
| `.env` | Secrets (mode 0600) | 11 |
| `docker-compose.yml` | Container orchestration | 6, 7, 10, 12 |
| `Dockerfile` | Custom layer | Composed from integrations |
| `workspace/SOUL.md` | Mission + principles | 8 |
| `workspace/USER.md` | User context | 8 |
| `workspace/IDENTITY.md` | Name, emoji, avatar | — |
| `workspace/AGENTS.md` | Operating rules | 8 |
| `workspace/HEARTBEAT.md` | Heartbeat checklist | 9 (cron) |
| `workspace/TOOLS.md` | Tool inventory | — |
| `workspace/MEMORY.md` | Memory skeleton | 8 |
| `workspace/<tools>` | CLI tool scripts | Cross-checked vs. installed binaries |
| `workspace/skills/` | Skill templates | — |
| `cron/jobs.json` | Scheduled jobs | 9 |

Every generated file is a point where the generator enforces a landmine
rule by construction. The validator re-checks continuously.

## Postconditions

- Base image `openclaw:local` present in the Docker image cache.
- Deployment image `openclaw:<blueprint>` present.
- External networks exist with ICC disabled.
- Egress firewall applied to the agent network.
- Container running as UID 1000 with cap_drop:ALL and
  no-new-privileges.

## Validation

```bash
clawhq doctor
# 40 checks; expect all green for a healthy deployment

clawhq verify
# End-to-end integration test from inside the container
```

## Related

- [[container-hardening]] — the full hardened compose.
- [[integration-layer]] — what integrations pull in
  which binaries.
- [[golden-config-pattern]] — preserve config across
  restarts.

## See also

- [[container-hardening]]
- [[integration-layer]]
- [[container-user-not-uid-1000]]
- [[external-networks-not-created]]
