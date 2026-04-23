---
title: ICC enabled on agent network breaches container isolation
category: Decisions
status: active
date: 2026-04-22
tags: [docker, networking, isolation, security, openclaw, landmine]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# ICC enabled on agent network breaches container isolation

## What breaks

Inter-container communication (ICC) on the agent's Docker network is left
enabled, meaning all containers on the same network can talk to each other
on any port. A compromised sandbox container can reach the Gateway, a
compromised browser container can reach credentials — defeating the
per-container isolation the hardening matrix is supposed to provide.

## How to detect

```bash
docker network inspect <network-name> \
  | jq '.[0].Options."com.docker.network.bridge.enable_icc"'
# Expected: "false"
```

If ICC is enabled (true or unset defaulting to true), any container on the
network can initiate connections to any other. Check by exec-ing into one
container and attempting to reach another on the Gateway port.

## Root cause

Docker's default bridge networks have ICC enabled. Custom networks inherit
this unless explicitly disabled via the
`com.docker.network.bridge.enable_icc=false` option. Compose files that
define networks without this option produce networks that allow all
container-to-container traffic.

## Fix or workaround

Define the network explicitly with ICC disabled:

```yaml
networks:
  openclaw-agent:
    driver: bridge
    driver_opts:
      com.docker.network.bridge.enable_icc: "false"
      com.docker.network.bridge.name: openclaw0
```

Combine with the egress firewall (see
[[egress-firewall]]) for the complete isolation model:
ICC-disabled networks prevent lateral movement between containers, and
the egress firewall restricts what any single container can reach
externally.

## Provenance

Documented in the 14-landmine table of the v2026.4.14 compiled reference.
ClawHQ's generated `docker-compose.yml` sets ICC-disabled on every network
it creates; `clawhq doctor` verifies continuously.

## See also

- [[container-hardening]]
- [[egress-firewall]]
