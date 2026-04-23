---
title: Managed mode architecture
subject: clawhq
type: architecture
status: active
last_verified: 2026-04-22
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
source_types: [compiled-reference]
see_also:
  - clawhq/architecture/blueprint-system.md
  - clawhq/concept/lifecycle-management-gap.md
  - openclaw/security/threat-model.md
tags: [clawhq, managed, architecture, agentd]
---

# Managed mode architecture

## Two deployment modes

ClawHQ runs in two modes:

- **Self-operated.** The operator runs `clawhq` CLI on their own
  host. ClawHQ talks to the local OpenClaw Gateway directly.
- **Managed.** A hosted ClawHQ console manages fleet deployments.
  Each agent host runs `agentd` (a daemon), which receives
  instructions from the console and drives the local OpenClaw
  Gateway.

This page covers Managed mode. Self-operated is the simpler case and
follows the same data flow as the CLI.

## Architecture diagram

```
┌────────────────────────────────────────────┐
│          ClawHQ Console (web)              │
│  Onboarding · Dashboard · Fleet · Support  │
│             WebSocket Hub                  │
└────────────────────┬───────────────────────┘
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
    ┌───────────┐        ┌───────────┐
    │ Node 1    │        │ Node N    │
    │ agentd    │        │ agentd    │
    │ OpenClaw  │ . . .  │ OpenClaw  │
    │ Guardrails│        │ Guardrails│
    │ Monitoring│        │ Monitoring│
    └───────────┘        └───────────┘
```

## agentd

`agentd` is the self-operated CLI running as a daemon. On each node:

- Receives config from the console via authenticated HTTPS.
- Manages Docker lifecycle (compose up/down, image pulls, rollbacks).
- Applies all seven toolchains (configure, design, build, deploy,
  operate, evolve, audit).
- Streams operational metadata back to the console.

The console is a **thin coordination layer.** It orchestrates and
observes. It never sees agent contents.

## Operational boundary

The core commitment of Managed mode is **the platform cannot see
agent data.** The specific boundary:

| Platform CAN see | Platform CANNOT see |
|---|---|
| Container health (up/down/restarts) | Agent conversations |
| Integration status (healthy/degraded/failed) | Email, task, or calendar content |
| Memory tier sizes (45KB hot, 120KB warm) | Memory contents |
| API cost metrics | What the agent does with the calls |
| Cron job status (running/failed) | Cron job outputs |

This boundary is enforced by what agentd reports, not by vendor
promise. The reports are structured metrics; content stays on the
node. An operator can audit agentd's outbound traffic to verify.

## Why this boundary matters

The boundary is what distinguishes Managed mode from big-tech hosted
agents. With a big-tech agent:

- The platform sees everything — it has to, because the model runs on
  platform infrastructure.
- Policy decisions about retention, usage for training, deletion, and
  export are platform-controlled and can change.
- The operator has no technical means to verify claims about privacy.

With Managed ClawHQ:

- The model still runs on your Anthropic / OpenAI / local account.
- Conversation content never transits the ClawHQ console.
- The operational boundary is verifiable by inspecting agentd's
  traffic.

This is the sovereignty-preserving property that
[[clawhq/comparison/clawhq-vs-alternatives]] relies on.

## Infrastructure provisioning

Managed mode handles the underlying infrastructure for operators who
don't want to:

- Provisions cloud instances (or registers existing ones).
- Installs Docker, agentd, and prerequisite packages.
- Bootstraps the agent via blueprint.
- Registers health probes and monitoring.
- Manages updates and rollbacks centrally.

Operators who want more control can run agentd on their own hardware
and register the node to the console — the platform doesn't require
hosted instances, it just offers them.

## Update pipeline

Updates flow from the console to each agent node:

1. **Stage** — new image built, available for rollout.
2. **Vet** — health probes and automated checks run against staged
   image on a canary subset.
3. **Approve** — operator confirms rollout (or auto-approves per
   policy).
4. **Activate** — image rolled out to remaining nodes.
5. **Verify** — post-update doctor on each node; rollback on
   failure.

Every step creates a rollback snapshot. "Update broke the agent" is
not a state ClawHQ leaves the operator in.

## Related

- [[clawhq/architecture/blueprint-system]] — what gets deployed.
- [[clawhq/concept/lifecycle-management-gap]] — why this architecture
  exists at all.
- [[openclaw/security/threat-model]] — the agent-level security model
  that Managed mode's operational boundary sits on top of.
