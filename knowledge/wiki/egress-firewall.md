---
title: Egress firewall
category: Decisions
status: active
date: 2026-04-22
tags: [firewall, iptables, egress, isolation, openclaw, security]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# Egress firewall

## Purpose

Restrict what the agent's containers can reach on the network. The
inbound side is guarded by the Gateway's access control and the prompt
injection sanitizer; the outbound side is guarded here. Together they
form the agent's network trust boundary.

## Rule set

iptables rules on a dedicated chain (`CLAWHQ_FWD`) attached to the
Docker bridge interface:

- Allow established/related connections (return traffic).
- Allow DNS (UDP/TCP 53) — required for API resolution.
- Allow HTTPS (TCP 443) — required for API calls.
- **Allowlist-only mode:** restrict HTTPS to specific domains
  (e.g., `imap.gmail.com`, `api.todoist.com`).
- **Air-gap mode:** block all egress except ESTABLISHED/RELATED.
- Log and drop everything else.

## Modes

| Mode | Use case | Egress allowed |
|---|---|---|
| Open | Development only | DNS + HTTPS to any destination |
| Allowlist | Production default | DNS + HTTPS to declared integration domains |
| Air-gap | Incident response / high-sensitivity | Only ESTABLISHED/RELATED (no new outbound) |

Allowlist is the default for ClawHQ deployments. The allowlist is
computed from the enabled integrations: if an agent has email +
calendar + Todoist, the firewall allows exactly the domains those
integrations reach.

## Implementation

```
iptables chain: CLAWHQ_FWD
  ├── ESTABLISHED/RELATED → ACCEPT
  ├── DNS (53/udp, 53/tcp) → ACCEPT
  ├── HTTPS (443/tcp) to allowlist domains → ACCEPT
  └── * → LOG + DROP
```

The chain attaches to FORWARD with a **source-scoped jump** matching
the agent's compose network subnet (e.g.,
`-A FORWARD -s 172.28.0.0/16 -j CLAWHQ_FWD`), so it governs only the
agent's traffic. Build containers on `docker0` and unrelated host
workloads on other Docker networks are not affected. The subnet is
auto-detected via `docker network inspect` at deploy time.

This was previously a global jump (`-A FORWARD -j CLAWHQ_FWD`) that
filtered every container on the host — see
[[firewall-attached-globally-blocks-builds]] for the bug, the fix, and
the IPv6 caveat.

## Critical operational detail

After every `docker compose down`, Docker destroys the bridge
interface and recreates it on the next `up`. This **invalidates the
iptables chain** — the rules still exist but point at an interface
that's gone, and the new interface comes up unfiltered.

ClawHQ detects this via filesystem events and reapplies automatically.
Manual setups need to wire the reapply into their deploy script. See
[[firewall-not-reapplied-after-network-recreate]]
for the full mitigation.

Doctor verifies continuously — a firewall that was supposed to be
active but isn't produces a specific `firewall-active` failed check.

## Verification

```bash
# Is the chain defined and populated?
sudo iptables -L CLAWHQ_FWD -n --line-numbers

# Is it attached to the bridge?
sudo iptables -L FORWARD -n --line-numbers | grep CLAWHQ_FWD

# Test: can the agent reach a non-allowlisted domain?
docker exec <container> curl -v https://example.com 2>&1 | head
# Expected: connection refused or timeout (blocked)

# Test: can the agent reach an allowlisted domain?
docker exec <container> curl -v https://api.todoist.com 2>&1 | head
# Expected: successful TLS handshake
```

Log messages for dropped packets appear in the host's syslog
(`/var/log/syslog` or `journalctl`). A normal deployment generates
occasional drops from scanning or misbehaving libraries — a sudden
spike warrants investigation.

## Relationship to other controls

The firewall restricts what goes out. The prompt injection sanitizer
restricts what comes in. See
[[prompt-injection-defense]]. These are complementary:

- If inbound content contains instructions to exfiltrate data, the
  sanitizer flags and blocks them at the content layer.
- If a compromised agent or skill attempts to exfiltrate anyway, the
  firewall drops the outbound connection at the network layer.

Defense in depth — neither layer is trusted alone.

## See also

- [[threat-model]]
- [[container-hardening]]
- [[firewall-not-reapplied-after-network-recreate]]
- [[firewall-attached-globally-blocks-builds]]
- [[prompt-injection-defense]]
