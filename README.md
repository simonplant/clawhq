# ClawOps

**Your agent. Your data. Your rules.**

The privacy-first personal AI agent platform. The Proton of personal agents.

---

Google, Apple, Microsoft, and Anthropic will all ship personal AI agents. They'll be polished, integrated, easy. They'll also see every email, every health condition, every financial anxiety, every relationship — and after six months, your agent holds the most intimate dataset about you that has ever existed.

**ClawOps is the privacy-first alternative.** Just as ProtonMail is the privacy-first alternative to Gmail, ClawOps is the privacy-first alternative to trusting a big-tech platform with the most intimate AI relationship you'll ever have.

Full-lifecycle management for personal AI agents — built on the open-source [OpenClaw](https://github.com/nicepkg/openclaw) framework:

```
Onboard → Configure → Deploy → Secure → Monitor → Evolve → Support
```

## Two Modes

**ClawOps Managed** — We operate your agent on isolated infrastructure. We manage the container, not the contents. You never touch a terminal. Even we can't see your data.

**ClawOps Self-Operated** — The same engine as a free, open-source CLI. You run it on your own hardware. Complete sovereignty. No dependencies on us.

```bash
clawops init       # Questionnaire → complete, hardened config bundle
clawops build      # Build agent image (from source, never pre-built)
clawops up         # Deploy with hardened defaults
clawops status     # Health dashboard: agent, integrations, memory, cost
clawops doctor     # Surfaces what WOULD have gone wrong
clawops evolve     # Update personality, context, integrations
clawops update     # Safe runtime upgrade with rollback
clawops export     # Portable profile bundle (yours forever)
clawops destroy    # Nuclear option — wipe everything, verified
```

## Data Sovereignty

This is not a feature. This is the reason ClawOps exists.

| Principle | How |
|---|---|
| **We can't see your data** | Isolated VM, encrypted at rest. We manage the container, not the contents. Architecturally enforced. |
| **Agent can't modify its own identity** | Identity files mounted read-only |
| **You can leave anytime** | `clawops export` — portable bundle, zero lock-in |
| **You can nuke anytime** | `clawops destroy` — wipes everything, cryptographic verification |
| **Audit everything** | Every tool execution logged, fully transparent |
| **Open source** | Auditable engine. Verify every privacy claim. |

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

**Layer 1** is the engineering that makes any agent safe, observable, and maintainable. Security hardening, memory lifecycle, cron guardrails, identity governance, config generation — all the operational work that non-experts won't do. This is the product.

**Layer 2** is the personality — templates like WordPress themes. Guardian (direct, proactive steward), Assistant (efficient professional aide), Coach (encouraging accountability partner), Analyst (thorough research partner), Companion (warm conversational partner), or build your own. Community-contributed templates create an ecosystem for use cases we'd never design ourselves.

**Layer 3** is tool integration by category, not provider. The agent talks to "calendar" not "Google Calendar." Swap Gmail for Outlook without changing agent behavior. Each integration has health checks, credential lifecycle tracking, fallback behavior, and version pinning.

## What's Inside

- **14+ configuration landmines** auto-handled — hard-won lessons that silently break agents if done wrong
- **Identity governance** — structured YAML, token budgets, read-only mounts, staleness detection, contradiction detection
- **Memory lifecycle** — hot/warm/cold tiers, auto-summarization, PII masking, full-text search, size caps
- **Cron guardrails** — exclusive locking, circuit breakers, cost estimation, budget caps, quiet hours
- **Security by default** — container hardening, egress firewall, secrets management, audit logging
- **Integration health** — hourly probes, credential expiry tracking, fallback behavior
- **Template marketplace** — community personality templates (the WordPress ecosystem for agents)
- **Skill library** — pre-built capabilities: morning briefs, email digest, meeting prep, session reports

## Competitive Position

```
Big tech ←───────────────────────────────────→ DIY
Google       CLAWOPS           HostedClaws    OpenClaw
Agent        (sovereign,       (hosted,       (framework)
(integrated,  personalized,    default
 surveilled)  operated)        config)
```

The big-tech agents will be more polished. They'll be more integrated. They'll be free. They'll also know everything about you, and you'll have no say in what happens with that knowledge.

**The big-tech agents will be easier. ClawOps will be yours.**

## Philosophy

In an age of digital manipulation — dark patterns, engagement farming, data harvesting — a personal agent should be a **guardian**, not another vector of influence. ClawOps exists for people who believe that matters.

## Status

Pre-build / Design phase. See [product.md](product.md) for the full design document.
