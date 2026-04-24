---
title: Container hardening
category: Decisions
status: active
date: 2026-04-22
tags: [docker, hardening, security, posture, openclaw]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# Container hardening

## Hardened compose reference

The baseline hardened compose for an OpenClaw agent:

```yaml
services:
  openclaw:
    image: openclaw/agent:latest
    security_opt:
      - no-new-privileges:true
    read_only: true
    user: "1000:1000"
    cap_drop:
      - ALL
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=256m
    volumes:
      # Read-only: config, credentials, identity
      - ~/.openclaw/openclaw.json:/config/openclaw.json:ro
      - ~/.openclaw/.env:/config/.env:ro
      - ~/.openclaw/credentials:/config/credentials:ro
      - ~/.openclaw/workspace/SOUL.md:/workspace/SOUL.md:ro
      - ~/.openclaw/workspace/IDENTITY.md:/workspace/IDENTITY.md:ro
      # Read-write: memory, sessions, cron runs
      - ~/.openclaw/workspace/memory:/workspace/memory
      - ~/.openclaw/workspace/MEMORY.md:/workspace/MEMORY.md
      - ~/.openclaw/sessions:/sessions
      - ~/.openclaw/cron/runs:/cron/runs
    networks:
      - openclaw-agent
    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: 2G
          pids: 256

networks:
  openclaw-agent:
    driver: bridge
    driver_opts:
      com.docker.network.bridge.enable_icc: "false"
      com.docker.network.bridge.name: openclaw0
```

## Posture matrix

Three postures in increasing order of lockdown:

| Control | Minimal | Hardened (default) | Under-Attack |
|---|---|---|---|
| Linux capabilities | cap_drop: ALL | cap_drop: ALL | cap_drop: ALL |
| Privilege escalation | no-new-privileges | no-new-privileges | no-new-privileges |
| Filesystem | Writable rootfs | Read-only rootfs | Read-only + encrypted workspace |
| User | Non-root (UID 1000) | Non-root (UID 1000) | Non-root (UID 1000) |
| Temp storage | tmpfs 512MB, nosuid | tmpfs 256MB, nosuid | tmpfs 128MB, noexec/nosuid |
| Network isolation | ICC not enforced | ICC disabled, auto-firewall | ICC disabled + air-gap |
| Resource limits | None | 2 CPU, 2GB, 256 PIDs | 1 CPU, 1GB, 128 PIDs |
| Runtime sandbox | — | gVisor | gVisor |
| Identity files | — | Read-only mount, immutable | Read-only + integrity hash |
| Workspace | Writable | Writable (scoped) | Writable (encrypted at rest) |

Hardened is the default ClawHQ posture. Minimal exists only for
development; Under-Attack is for incident response or known-hostile
environments.

## Network and access hardening

| Control | What it prevents | Implementation |
|---|---|---|
| Gateway binding | Publicly exposed instances via `0.0.0.0` | Enforce loopback-only binding by default |
| WebSocket origin validation | Cross-site WebSocket hijacking (ClawJacked vector) | Origin header validation on all upgrade requests |
| CSRF protections | Unauthorized state changes via cross-site requests | Token-based guards on all state-changing operations |
| mDNS/Bonjour control | Network reconnaissance via service discovery | Disable service discovery broadcasts in container |
| Secure remote access | Raw port exposure | Tailscale, SSH tunnels, or Cloudflare Tunnel only |
| Device pairing | Silent auto-pairing on localhost | Explicit device registration approval required |
| Auth failure tracking | Brute-force attacks | Failed auth logging with fail2ban integration |

## Rationale by landmine

Each hardening control maps to at least one landmine it prevents:

| Control | Prevents |
|---|---|
| `user: "1000:1000"` | [[container-user-not-uid-1000]] |
| `cap_drop: ALL` + `no-new-privileges` | Privilege escalation attacks |
| `read_only: true` on rootfs | Runtime binary modification |
| Read-only config/creds mounts | [[config-credentials-not-read-only]] |
| ICC disabled on networks | [[icc-enabled-on-agent-network]] |
| Egress firewall reapply | [[firewall-not-reapplied-after-network-recreate]] |
| Pre-created networks | [[external-networks-not-created]] |

The hardened compose file is a product of these landmines — every
control in it is there because the absence of that control produced
a production incident.

## ClawHQ defaults

ClawHQ ships the hardened posture by default. Operators opt into
Minimal explicitly for development, not by accident. Under-Attack is a
one-command escalation: `clawhq posture set under-attack`.

`clawhq doctor` continuously verifies that the running container
matches the declared posture. Drift is flagged as a specific failed
check.

## See also

- [[threat-model]]
- [[egress-firewall]]
- [[container-user-not-uid-1000]]
- [[icc-enabled-on-agent-network]]
- [[config-credentials-not-read-only]]
- [[doctor-diagnostics]] — continuous enforcement; flags posture drift as a failed check
