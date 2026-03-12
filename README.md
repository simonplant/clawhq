# ClawOps

**The lifecycle management platform for OpenClaw agents.**

---

OpenClaw is the most powerful open-source framework for personal AI agents. It's also nearly impossible to operate. Configuration has 14+ silent landmines. Memory bloats without lifecycle management. Credentials expire without warning. Identity files drift and contradict themselves. Security is entirely opt-in. Running a production agent requires ongoing SRE work that non-experts won't do.

**ClawOps fixes that.** Full-lifecycle management — from initial setup to long-term evolution — so your agent actually works in production:

```
Onboard → Configure → Deploy → Secure → Monitor → Evolve → Support
```

## Two Modes

**ClawOps Managed** — We operate your agent on isolated infrastructure. You never touch a terminal. We manage the container, not the contents.

**ClawOps Self-Operated** — The same engine as a free, open-source CLI. You run it on your own hardware. Full control.

```bash
clawops init       # Questionnaire → complete, hardened config bundle
clawops build      # Build agent image (from source, never pre-built)
clawops up         # Deploy with hardened defaults
clawops status     # Health dashboard: agent, integrations, memory, cost
clawops doctor     # Diagnose issues — surfaces what WOULD have gone wrong
clawops evolve     # Update personality, context, integrations
clawops update     # Safe runtime upgrade with compatibility check + rollback
clawops train      # Refine agent behavior from interaction history
clawops backup     # Encrypted workspace snapshot
clawops export     # Portable profile bundle (yours forever, take it anywhere)
clawops destroy    # Wipe everything — cryptographic verification of deletion
clawops logs       # Stream agent activity
```

## Three Layers

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 1: CORE PLATFORM (same for every agent)          │
│  Security · Monitoring · Config Safety · Memory Mgmt    │
│  Cron Guardrails · Identity Governance · Audit Logging  │
├─────────────────────────────────────────────────────────┤
│  LAYER 2: TEMPLATES (choose one, customize)             │
│  Guardian · Assistant · Coach · Analyst · Companion     │
│  Each: personality + operational profile + security     │
├─────────────────────────────────────────────────────────┤
│  LAYER 3: INTEGRATIONS (pick providers per category)    │
│  Email · Calendar · Tasks · Messaging · Files · Code    │
│  Finance · Research · Notes · Health                    │
└─────────────────────────────────────────────────────────┘
```

**Layer 1** is the product — the engineering that makes any agent safe, observable, and maintainable. Config generation with landmine detection, memory lifecycle (hot/warm/cold tiers), cron guardrails with circuit breakers, identity governance, security hardening, credential health monitoring. All the operational work that non-experts won't do and experts don't want to repeat.

**Layer 2** is the template system. Templates are full operational profiles — not just prompt skins. Each bundles personality, security posture, monitoring thresholds, memory policy, cron configuration, autonomy defaults, and integration recommendations. Community-contributed templates (WordPress model) extend the platform to use cases we'd never design ourselves.

**Layer 3** is integration by category, not provider. The agent talks to "calendar" not "Google Calendar." Swap providers without changing agent behavior. Each integration has health checks, credential lifecycle tracking, fallback behavior, and version pinning.

## What It Handles

| Problem | Without ClawOps | With ClawOps |
|---|---|---|
| **14+ config landmines** | Silent failures, days of debugging | Auto-detected and prevented |
| **Memory bloat** (360KB/3 days) | Context overflow, degraded responses | Hot/warm/cold lifecycle, auto-summarization, size caps |
| **Credential expiry** | Agent silently stops working | 7-day advance alerts, health probes, fallback |
| **Identity drift** | Personality contradicts itself over time | Versioned YAML, staleness detection, token budgets |
| **Security** | Opt-in, defaults are dangerous | Hardened by default (cap_drop, read-only rootfs, egress firewall) |
| **Cron failures** | Silent, cascading, unbounded cost | Circuit breakers, exclusive locking, budget caps |
| **Agent evolution** | Manual YAML edits, trial and error | `clawops evolve` — guided updates, schema validation |
| **Ongoing operations** | Full-time SRE work | Automated monitoring, alerting, self-healing |

## Data Sovereignty

For users who need it, ClawOps supports full data sovereignty — your agent, your infrastructure, your rules:

| Principle | How |
|---|---|
| **Workspace isolation** | Agent runs on isolated infrastructure. We manage the container, not the contents. |
| **Identity integrity** | Identity files mounted read-only. Agent cannot modify its own guardrails. |
| **Portability** | `clawops export` — portable bundle. Zero lock-in. Take it anywhere. |
| **Auditability** | Every tool execution logged. Full transparency into agent behavior. |
| **Open source** | Auditable engine. Verify every claim. |

## Competitive Position

```
Raw framework ←──────────────────────────────→ Platform lock-in
OpenClaw         Basic hosting      CLAWOPS         Big-tech agents
(powerful,       (default config,   (managed,       (polished,
 expert-only)    no lifecycle)      full lifecycle)  captive)
```

ClawOps is the managed service layer that makes OpenClaw production-ready — the same way RightScale made cloud infrastructure manageable, or WordPress.com made WordPress accessible.

## Built on Production Experience

Everything in ClawOps is grounded in a production agent that's been running for months — hardened Docker deployment, 10-minute heartbeat cycles, multiple cron jobs, multi-model architecture, 6+ working integrations, and ~13,500 tokens of configuration across 11+ files. Every failure mode became a product feature. Every landmine became a rule in the config generator. Every script became a module in the CLI.

## Status

Pre-build / Design phase. See [product.md](product.md) for the full design document.
