---
title: External Docker networks not created before compose up
category: Decisions
status: active
date: 2026-04-22
tags: [docker, networking, compose, deployment, openclaw, landmine]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# External Docker networks not created before `compose up`

## What breaks

`docker compose up` fails with "network not found" errors, or containers
start but can't reach the services they expect to reach. External networks
declared in the compose file are assumed to exist — compose doesn't create
them automatically.

## How to detect

```bash
grep -A1 'networks:' docker-compose.yml | grep external
# Lists networks declared as external: true

docker network ls
# Compare against the external list
```

Any external network referenced by the compose file but missing from
`docker network ls` will cause compose failures.

## Root cause

Docker Compose has two kinds of network definitions:

- **Internal** (default) — compose creates and destroys the network along
  with the stack.
- **External** (`external: true`) — compose expects the network to already
  exist, managed outside the stack's lifecycle.

External networks are the right choice when multiple stacks share a
network, or when the network is managed by an orchestration layer outside
compose. But they fail hard if the assumed network isn't present.

## Fix or workaround

Pre-create any external networks before running compose:

```bash
# Standard ClawHQ agent network
docker network create \
  --driver bridge \
  --opt com.docker.network.bridge.enable_icc=false \
  openclaw-agent

# Sandbox browser network (separate from agent network)
docker network create \
  --driver bridge \
  --opt com.docker.network.bridge.enable_icc=false \
  openclaw-sandbox-browser
```

Script this in your deployment entry point so it runs before every
`compose up`. `docker network create` is idempotent if you check existence
first:

```bash
docker network inspect openclaw-agent >/dev/null 2>&1 \
  || docker network create --driver bridge \
       --opt com.docker.network.bridge.enable_icc=false openclaw-agent
```

## Provenance

Documented in the 14-landmine table of the v2026.4.14 compiled reference.
ClawHQ's deploy toolchain pre-creates every external network referenced
by the generated compose file, with ICC disabled per
[[icc-enabled-on-agent-network]].

## See also

- [[two-stage-docker-build]]
- [[icc-enabled-on-agent-network]]
