# ClawOps

The managed service provider for personal AI agents. We onboard, configure, secure, monitor, and evolve OpenClaw agents so they stay healthy, useful, and safe — for months and years, not just the first week.

## The Problem

OpenClaw is a powerful open-source agent framework, but it gives you everything and protects you from nothing. Configuration has ~30 surfaces with landmines. Identity files corrupt, bloat, and go stale. Security is entirely opt-in. Operations require deep Linux/Docker expertise. The result: only infrastructure experts can run a production agent. Everyone else gets burned within weeks.

Hosting is solved (HostedClaws, xCloud). What's not solved is **keeping an agent healthy over time** — configuration intelligence, personalization, operational guardrails, memory lifecycle, credential management, cost tracking, and security hardening.

## What ClawOps Does

We manage the full agent lifecycle:

```
Onboard → Deploy → Operate → Optimize → Evolve → Support
```

Your agent checks your email, monitors your tasks, watches your portfolio, and sends you a morning briefing — all before you open your phone. ClawOps keeps it running, secure, and getting better over time. You just talk to your agent.

## Two Modes

**ClawOps Managed** — We operate your agent. Onboarding, deployment, monitoring, maintenance, support, evolution. You never touch a terminal.

**ClawOps Self-Operated** — Same engine, open-source CLI. You run everything.

```bash
clawops init       # Questionnaire → complete config bundle
clawops up         # Deploy with hardened defaults
clawops status     # Health dashboard
clawops doctor     # Surfaces what WOULD have gone wrong
clawops evolve     # Update personality/integrations
clawops export     # Portable profile bundle (yours forever)
```

## Three Layers

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

**Layer 1** is the MSP value — the engineering that makes any agent safe, observable, and maintainable. Same for every agent.

**Layer 2** is the personality — templates like WordPress themes. Pick Guardian (direct, proactive), Assistant (efficient, measured), Coach (encouraging, goal-focused), or build your own.

**Layer 3** is tool integration — organized by category, not provider. The agent talks to "calendar" not "Google Calendar." Swap providers without changing agent behavior.

## What's Inside

- **14 configuration landmines** auto-handled (hard-won lessons that break OpenClaw if done wrong)
- **Identity governance** — structured YAML, token budgets, read-only mounts, staleness alerts, contradiction detection
- **Memory lifecycle** — hot/warm/cold tiers, auto-summarization, PII masking, search index
- **Cron guardrails** — exclusive locking, circuit breaker, cost estimation, budget caps, quiet hours
- **Security by default** — container hardening, egress firewall, secrets management, audit logging
- **Integration health** — hourly probes, credential expiry tracking, fallback behavior
- **Data sovereignty** — your data is yours, we can't see it, you can export or destroy anytime
- **Template marketplace** — community-contributed personality templates (the WordPress ecosystem for agents)

## Philosophy

In an age of digital manipulation — dark patterns, engagement farming, data harvesting — a personal agent should be a **guardian**, not another vector of influence. ClawOps is built on the principle that agents must be secure by default, transparent in operation, and accountable to their users. The person comes first. The agent serves.

## Status

Pre-build / Design phase. See [product.md](product.md) for the full design document.
