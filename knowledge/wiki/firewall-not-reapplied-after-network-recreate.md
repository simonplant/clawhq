---
title: Egress firewall not reapplied after Docker network recreate
category: Decisions
status: active
date: 2026-04-22
tags: [firewall, iptables, docker, silent-failure, openclaw, landmine]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# Egress firewall not reapplied after Docker network recreate

## What breaks

After `docker compose down` followed by `docker compose up`, the agent
runs with no egress filtering. Every outbound connection the container
wants to make succeeds, including connections that should have been
blocked by the allowlist. The agent is silently running under the wrong
security posture.

## How to detect

Check whether the dedicated iptables chain exists and has rules:

```bash
sudo iptables -L CLAWHQ_FWD -n --line-numbers
# Expected: a populated chain with ACCEPT rules for allowed destinations
# and a trailing LOG + DROP
```

If the chain is missing or empty, the firewall is not in force. A
deployment that was previously filtered and is now wide open is the
classic symptom of this landmine.

## Root cause

The ClawHQ egress firewall is implemented as iptables rules in a
dedicated chain (`CLAWHQ_FWD`) attached to the Docker bridge interface.
`docker compose down` destroys the bridge interface; `docker compose up`
creates a new one. The old chain becomes orphaned (still defined, but
attached to an interface that no longer exists), and the new bridge
comes up with no attached filtering.

Docker's network lifecycle is not iptables-aware — it doesn't know that
a sibling tool has rules depending on the specific interface it just
destroyed.

## Fix or workaround

Reapply the firewall after every compose up. Wire this into your
deploy script:

```bash
#!/usr/bin/env bash
set -euo pipefail

docker compose up -d
sleep 3   # let the bridge settle
clawhq firewall apply
```

ClawHQ's deploy toolchain detects compose-down events and reapplies
automatically. For manual setups, the reapply command must run after
every stack lifecycle event that could rebuild the bridge interface.
`clawhq doctor` verifies continuously — include it in health checks.

## Provenance

Documented in the 14-landmine table of the v2026.4.14 compiled reference
and in `src/build/launcher/firewall.ts`. Caused "hours of debugging" in
manual setups prior to ClawHQ's auto-reapply logic.

## See also

- [[egress-firewall]]
- [[container-hardening]]
- [[external-networks-not-created]]
