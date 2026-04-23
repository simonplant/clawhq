---
title: Threat model
subject: openclaw
type: security
status: active
openclaw_version: ">=v2026.4.12"
last_verified: 2026-04-22
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
source_types: [compiled-reference]
see_also:
  - openclaw/security/container-hardening.md
  - openclaw/security/egress-firewall.md
  - openclaw/security/prompt-injection-defense.md
  - openclaw/finding/key-principles.md
tags: [security, threat-model, hardening]
---

# Threat model

## Primary threats

An OpenClaw agent faces four primary threat categories. Each one has
concrete mitigations that together form the hardened deployment
posture.

### 1. Prompt injection

External content (messages, links, attachments, fetched web pages,
document contents) contains instructions intended to override the
agent's system prompt or behavior.

Mitigations:

- Prompt injection sanitizer on inbound content. See
  [[openclaw/security/prompt-injection-defense]].
- Strong model selection (the strongest available model for
  tool-enabled agents) — smaller models are easier to jailbreak.
- Hard boundaries in SOUL.md that survive injection attempts.
- Tool-level approval gates on high-stakes actions (send, delete,
  purchase) — model compliance with an injection does not translate
  to execution without human approval.

### 2. Data exfiltration

A compromised agent attempts to send sensitive data (secrets,
personal information, memory contents) to an external destination.

Mitigations:

- Egress firewall — allowlist-only or air-gap mode. See
  [[openclaw/security/egress-firewall]].
- Secret scanning on outbound content.
- Workspace sandboxing — agent tools scoped to workspace only.
  See [[openclaw/landmine/fs-workspace-only-misconfigured]].
- Credential health probes detect tokens that shouldn't have been
  used and alert on anomalies.

### 3. Self-modification

Prompt injection convinces the agent to rewrite its own SOUL.md,
AGENTS.md, or `openclaw.json` to lower its own defenses.

Mitigations:

- `chmod 444` on identity files.
- Read-only volume mounts for config, credentials, identity. See
  [[openclaw/landmine/config-credentials-not-read-only]].
- Git-backed workspace — any identity change is visible as a diff.
- `soul-evil` hook illustrates the risk by swapping SOUL.md in
  memory; the disk-level protection is what stops the real attack
  from persisting.

### 4. Lateral movement

A compromised sandbox or browser container reaches a sibling
container it shouldn't.

Mitigations:

- Inter-container communication disabled. See
  [[openclaw/landmine/icc-enabled-on-agent-network]].
- Dedicated sandbox-browser network separate from main agent
  network.
- Non-root container user (UID 1000). See
  [[openclaw/landmine/container-user-not-uid-1000]].
- Capability dropping (`cap_drop: ALL`) and `no-new-privileges`.

## Security checklist

### Configuration

- [ ] `dangerouslyDisableDeviceAuth: true` present for Docker deploys
- [ ] `allowedOrigins` and `trustedProxies` preserved via golden config
- [ ] `tools.exec.host: "gateway"` and `tools.exec.security: "full"`
- [ ] `fs.workspaceOnly` matches the expected security posture
- [ ] DM policies start at `pairing`, not `open`
- [ ] `@mention` gating required in group chats
- [ ] High-risk tools (`exec`, `browser`, `web_fetch`) restricted to
      trusted agents
- [ ] Strongest available model for tool-enabled agents
- [ ] Destructive commands blocked: recursive deletes, force pushes,
      arbitrary network calls

### Container

- [ ] `security_opt: no-new-privileges:true`
- [ ] `read_only: true` on rootfs
- [ ] `user: "1000:1000"`
- [ ] `cap_drop: [ALL]`
- [ ] `tmpfs` for /tmp with `noexec,nosuid`
- [ ] ICC disabled on all networks
- [ ] Config and credentials mounted read-only
- [ ] Egress firewall active and reapplied after network recreate

### Inputs

- [ ] Treat all external content (links, attachments, pasted text) as
      hostile
- [ ] Prompt injection sanitizer enabled
- [ ] Confusable normalization enabled

### Skills and plugins

- [ ] Never install skills blindly — review GitHub repo first
- [ ] ClawHub VirusTotal scanning is present but not a substitute for
      review
- [ ] ClawHQ vetting pipeline: stage → vet → approve → activate, with
      rollback snapshot per install

### Monitoring and recovery

- [ ] Session and action logging enabled
- [ ] Nightly backups of `~/.openclaw/` (state + workspace)
- [ ] Workspace git-backed (credentials and openclaw.json excluded)
- [ ] Token rotation plan documented — if leaked, rotate immediately
- [ ] Recovery plan: scripts to rebuild the Gateway from a fresh OS

## Posture levels

Three postures from development-friendly to maximum lockdown:

| Control | Minimal | Hardened (default) | Under-Attack |
|---|---|---|---|
| Capabilities | cap_drop ALL | cap_drop ALL | cap_drop ALL |
| Privilege escalation | no-new-privileges | no-new-privileges | no-new-privileges |
| Filesystem | Writable rootfs | Read-only rootfs | Read-only + encrypted workspace |
| User | UID 1000 | UID 1000 | UID 1000 |
| Temp storage | 512MB nosuid | 256MB nosuid | 128MB noexec/nosuid |
| Network | ICC not enforced | ICC disabled, firewall | ICC disabled + air-gap |
| Resource limits | None | 2 CPU, 2GB, 256 PIDs | 1 CPU, 1GB, 128 PIDs |
| Runtime sandbox | — | gVisor | gVisor |
| Identity files | — | Read-only, immutable | Read-only + integrity hash |

Hardened is ClawHQ's default — operators get hardened containers
without knowing what `cap_drop` means. Implementation:
`src/build/docker/posture.ts`.

See [[openclaw/security/container-hardening]] for the full matrix.

## Known security issues (Snyk Labs, Feb 2026)

Two sandbox bypass vulnerabilities were disclosed and patched:

1. `/tools/invoke` endpoint wasn't merging sandbox allow/deny lists
   into runtime policy, allowing sandboxed sessions to invoke
   management tools.
2. TOCTOU race condition in `assertSandboxPath` via symlink
   manipulation, allowing filesystem escape.

Both patched. Run `openclaw update` to ensure you have the fixes.
