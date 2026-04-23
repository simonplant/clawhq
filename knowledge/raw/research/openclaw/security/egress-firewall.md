---
title: Egress firewall
subject: openclaw
type: security
status: active
openclaw_version: ">=v2026.4.12"
last_verified: 2026-04-22
location: "src/build/launcher/firewall.ts"
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
source_types: [compiled-reference]
see_also:
  - openclaw/security/threat-model.md
  - openclaw/security/container-hardening.md
  - openclaw/landmine/firewall-not-reapplied-after-network-recreate.md
  - openclaw/security/prompt-injection-defense.md
tags: [firewall, iptables, egress, isolation]
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

The chain attaches to the Docker bridge interface (e.g., `openclaw0`)
via a FORWARD rule, so it governs inter-container traffic routed
through the bridge as well as external egress.

## Critical operational detail

After every `docker compose down`, Docker destroys the bridge
interface and recreates it on the next `up`. This **invalidates the
iptables chain** — the rules still exist but point at an interface
that's gone, and the new interface comes up unfiltered.

ClawHQ detects this via filesystem events and reapplies automatically.
Manual setups need to wire the reapply into their deploy script. See
[[openclaw/landmine/firewall-not-reapplied-after-network-recreate]]
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
[[openclaw/security/prompt-injection-defense]]. These are complementary:

- If inbound content contains instructions to exfiltrate data, the
  sanitizer flags and blocks them at the content layer.
- If a compromised agent or skill attempts to exfiltrate anyway, the
  firewall drops the outbound connection at the network layer.

Defense in depth — neither layer is trusted alone.
