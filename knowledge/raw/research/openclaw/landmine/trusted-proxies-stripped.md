---
title: trustedProxies stripped after onboard rejects Docker NAT requests
subject: openclaw
type: landmine
status: active
severity: high
affects: "Docker deployments with reverse proxy or multi-container setups"
openclaw_version: ">=v2026.4.12"
last_verified: 2026-04-22
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
source_types: [compiled-reference]
see_also:
  - openclaw/configuration/openclaw-json-schema.md
  - openclaw/operation/golden-config-pattern.md
  - openclaw/landmine/allowed-origins-stripped.md
tags: [gateway, docker, networking, config-drift]
landmine_number: 3
---

# `trustedProxies` stripped after onboard rejects Docker NAT requests

## What breaks

The Gateway rejects requests forwarded through Docker's NAT bridge, treating
them as untrusted. Requests originating inside the Docker network from
sibling containers or a reverse proxy fail authentication or get rejected
at the transport layer.

## How to detect

- Gateway logs show rejected requests from Docker bridge gateway IPs.
- Internal services that should reach the Gateway via the Docker network
  are unreachable while loopback access still works.

Check the config:

```bash
jq '.gateway.http.trustedProxies' ~/.openclaw/openclaw.json
# Expected: an array containing the Docker bridge gateway IP (e.g., 172.17.0.1)
```

## Root cause

Same mechanism as [[openclaw/landmine/allowed-origins-stripped]]: OpenClaw's
config rewrite-on-startup can strip entries the wizard didn't author.
`trustedProxies` is particularly vulnerable because it's added specifically
for Docker and multi-container topologies that the default onboarding
doesn't assume.

## Fix or workaround

Apply the golden config pattern. Ensure `trustedProxies` contains every IP
that legitimately forwards requests to the Gateway — this typically
includes the Docker bridge gateway (default `172.17.0.1`) and any
additional networks you've created.

```json5
{
  gateway: {
    http: {
      trustedProxies: ["172.17.0.1", "172.20.0.1"],
    },
  },
}
```

Verify after restart with `docker network inspect <network>` to confirm
the bridge gateway IP matches what's in config.

## Provenance

Documented in the 14-landmine table of the v2026.4.14 compiled reference.
ClawHQ's deploy toolchain computes the correct `trustedProxies` set from
the actual Docker network configuration and reapplies on every `docker
compose up`.
