# ClawOps

The privacy-first personal AI agent platform. Your agent, your data, your rules.

## Why ClawOps Exists

Google, Apple, Microsoft, and Anthropic will all ship personal AI agents. They'll be polished, integrated, easy. They'll also see every email you receive, every task you procrastinate on, every health condition you mention, every financial anxiety you express — and they'll own that data forever.

After 6 months, your agent holds the most intimate dataset about you that exists anywhere. More sensitive than your email, medical records, or bank account — because it's all of them combined, with behavioral patterns on top.

**ClawOps is the Proton of personal agents.** Just as ProtonMail is the privacy-first alternative to Gmail, ClawOps is the privacy-first alternative to trusting a big-tech platform with the most intimate AI relationship you'll ever have.

## How It Works

ClawOps manages the full lifecycle of OpenClaw agents — configuration, deployment, security, monitoring, and evolution — so you get the quality of a big-tech agent with the privacy of your own infrastructure.

```
Onboard → Deploy → Operate → Optimize → Evolve → Support
```

## Two Modes

**ClawOps Managed** — We operate your agent on isolated infrastructure. We manage the container, not the contents. Even we can't see your data.

**ClawOps Self-Operated** — Same engine, open-source CLI. You run everything on your own hardware. Complete sovereignty.

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

**Layer 1** is the engineering that makes any agent safe, observable, and maintainable.

**Layer 2** is the personality — templates like WordPress themes. Guardian, Assistant, Coach, Analyst, Companion, or build your own.

**Layer 3** is tool integration by category, not provider. Swap Gmail for Outlook without changing agent behavior.

## Data Sovereignty

| Principle | How |
|---|---|
| **We can't see your data** | Isolated VM, encrypted at rest, we manage the container not the contents |
| **Agent can't modify its own identity** | Identity files mounted read-only |
| **You can leave anytime** | `clawops export` — portable bundle, no lock-in |
| **You can nuke anytime** | `clawops destroy` — wipes everything, cryptographic verification |
| **Audit everything** | Every tool execution logged, fully transparent |

Architecturally enforced, not policy-enforced. Open source so you can verify.

## What's Inside

- **14 configuration landmines** auto-handled (hard-won lessons that break OpenClaw if done wrong)
- **Identity governance** — structured YAML, token budgets, read-only mounts, staleness alerts
- **Memory lifecycle** — hot/warm/cold tiers, auto-summarization, PII masking, search index
- **Cron guardrails** — exclusive locking, circuit breaker, cost estimation, budget caps
- **Security by default** — container hardening, egress firewall, secrets management, audit logging
- **Integration health** — hourly probes, credential expiry tracking, fallback behavior
- **Template marketplace** — community personality templates (the WordPress ecosystem for agents)

## Philosophy

In an age of digital manipulation — dark patterns, engagement farming, data harvesting — a personal agent should be a **guardian**, not another vector of influence. The big-tech agents will be easier. ClawOps will be **yours**.

## Status

Pre-build / Design phase. See [product.md](product.md) for the full design document.
