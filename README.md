# ClawOps

SRE for OpenClaw agents — configure, personalize, harden, deploy, monitor, and evolve personal AI agents across their entire lifecycle.

## The Problem

OpenClaw is a powerful open-source agent framework, but it gives you everything and protects you from nothing. Configuration has ~30 surfaces with landmines. Identity files corrupt, bloat, and go stale. Security is opt-in. Operations require deep Linux/Docker expertise. The result: only infrastructure experts can run a production agent. Everyone else gets burned.

## What ClawOps Does

ClawOps is the operational layer for OpenClaw agents. It handles the full lifecycle:

```
Design → Develop → Deploy → Operate → Support → Evolve → Upgrade
```

Three cleanly separated layers:

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 1: CORE PLATFORM (same for every agent)          │
│  Security · Logging · Auditing · Monitoring · Alerting  │
│  Config safety · Memory lifecycle · Cron guardrails     │
├─────────────────────────────────────────────────────────┤
│  LAYER 2: PERSONALITY (choose one, customize)           │
│  Guardian · Assistant · Coach · Analyst · Companion     │
├─────────────────────────────────────────────────────────┤
│  LAYER 3: TOOLS (pick providers per category)           │
│  Email · Calendar · Tasks · Messaging · Files · Code    │
│  Finance · Research · Notes · Health                    │
└─────────────────────────────────────────────────────────┘
```

## How It Works

```bash
clawops init       # Interactive questionnaire → generates complete config bundle
clawops build      # Build OpenClaw image (two-stage, from source)
clawops up         # Deploy with hardened defaults
clawops status     # Health dashboard (container, integrations, memory, cost)
clawops doctor     # Diagnose issues — surfaces what WOULD have gone wrong
clawops evolve     # Update profile (re-run questionnaire sections)
clawops backup     # Encrypted workspace snapshots
```

## Two Modes

- **OSS tool** — Run the wizard, get a working agent, use the CLI to keep it healthy.
- **Managed service** — Same engine, we handle infrastructure + monitoring + support.

## What's Inside

- **14 configuration landmines** auto-handled (hard-won lessons that break OpenClaw if done wrong)
- **Identity governance** — structured YAML, token budgets, read-only mounts, staleness alerts
- **Memory lifecycle** — hot/warm/cold tiers, auto-summarization, PII masking, search index
- **Cron guardrails** — exclusive locking, circuit breaker, cost estimation, budget caps
- **Security defaults** — container hardening, egress firewall, secrets management, audit logging
- **Integration health** — hourly probes, credential expiry tracking, fallback behavior

## Status

Pre-build / Design phase. See [product.md](product.md) for the full design document.

## Philosophy

In an age of digital manipulation — dark patterns, engagement farming, data harvesting — a personal agent should be a **guardian**, not another vector of influence. ClawOps is built on the principle that agents must be secure by default, transparent in operation, and accountable to their users. The person comes first. The agent serves.
