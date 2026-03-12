# ClawOps — Product Design Document

**The lifecycle management platform for OpenClaw agents.**

---

## The Problem

OpenClaw is the most powerful open-source framework for personal AI agents. It gives you a persistent agent with tools, memory, cron jobs, and messaging integrations — running in a Docker container you control.

It's also nearly impossible to operate.

Setting up a production OpenClaw agent takes weeks of trial and error. Keeping it running requires ongoing SRE work. The framework is excellent — the operational burden is the bottleneck.

### What Goes Wrong

These aren't hypothetical. Every item below was discovered running a production agent for months:

- **14 configuration landmines** that silently break the agent. No errors, no warnings — just an agent that doesn't work. Each one takes hours to diagnose.
- **Memory bloat** — 360KB in 3 days without lifecycle management. Context windows overflow. Agent quality degrades.
- **Credential rot** — API keys and tokens expire silently. The agent doesn't notice — it assumes there's nothing to report. The user thinks everything is fine.
- **Identity drift** — Personality files (SOUL.md, USER.md, AGENTS.md) corrupt, bloat, and go stale without governance. The agent slowly becomes someone else.
- **Security is opt-in** — Default configuration lets the agent escalate privileges and read the host filesystem. Most users never harden it.
- **Configuration fragmentation** — ~13,500 tokens across 11+ files. 40% is universal (same for any user), 60% is personalized. No tooling separates the two.
- **Ongoing SRE burden** — Cron jobs fail silently, integrations degrade, costs accumulate, backups don't happen. Running an agent is a full-time ops job.

### The Gap

Today you choose between **raw framework** (powerful, months of expertise required) or **basic hosting** (someone runs the container, but with default config, no lifecycle management, no hardening). Nobody offers the full lifecycle — from guided setup through long-term evolution — that makes an OpenClaw agent production-ready and keeps it that way.

That's ClawOps.

---

## What ClawOps Is

A full-lifecycle management platform for OpenClaw agents. Think RightScale for personal agents — or WordPress.com for OpenClaw.

ClawOps handles everything from initial configuration to ongoing operations, evolution, and support:

```
Onboard → Configure → Deploy → Secure → Monitor → Evolve → Train → Support
```

Every known failure mode is encoded as a rule. Every operational script is a module. Every hard-won lesson is baked into the platform so users never have to learn them the hard way.

### Two Modes

**ClawOps Managed** — We operate your agent on isolated infrastructure. We manage the container lifecycle, not the contents. You never touch a terminal.

**ClawOps Self-Operated** — The same engine as a free, open-source CLI tool. You run it on your own hardware. Full control. No dependencies on us.

---

## The Platform

### Three Layers

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 1: CORE PLATFORM (same for every agent)          │
│  Config Safety · Security · Monitoring · Alerting       │
│  Memory Lifecycle · Cron Guardrails · Identity Gov      │
│  Audit Logging · Credential Health · Backup/Restore     │
├─────────────────────────────────────────────────────────┤
│  LAYER 2: TEMPLATES (operational profiles)              │
│  Guardian · Assistant · Coach · Analyst · Companion     │
│  Each: personality + security posture + monitoring      │
│  + memory policy + cron config + autonomy defaults      │
├─────────────────────────────────────────────────────────┤
│  LAYER 3: INTEGRATIONS (pick providers per category)    │
│  Email · Calendar · Tasks · Messaging · Files · Code    │
│  Finance · Research · Notes · Health                    │
└─────────────────────────────────────────────────────────┘
```

### Layer 1: Core Platform

The engineering that makes any personal agent safe, observable, and maintainable. Same for every agent, regardless of template or integrations. **This is the product** — everything else is configuration on top.

**Config Generation & Safety** — Questionnaire answers → valid, hardened, complete deployment bundle. Every known landmine encoded as a rule. Schema validation on every change. Impossible to generate a broken config.

**Security Hardening** — Container hardening (cap_drop ALL, read-only rootfs, no-new-privileges, non-root user). Egress firewall (DNS + HTTPS only, auto-reapplied after network changes). Secrets in .env, never in config files. Identity files mounted read-only. Security posture configurable per template.

**Monitoring & Alerting** — Agent health, integration status, memory usage, cost tracking. Credential expiry alerts (7 days advance), memory bloat warnings, silent failure detection, cost overruns, identity staleness, cron circuit breakers. Configurable thresholds per template.

**Memory Lifecycle** — Hot (≤7 days, in context) → Warm (7-90 days, indexed, searchable) → Cold (90+, archived, summarized). Auto-summarization at each transition. PII masking. Full-text search. Size caps per tier. Without this, agents degrade within a week.

**Cron Guardrails** — Exclusive locking, cost estimation, circuit breakers, exponential backoff, quiet hours, timezone-aware scheduling, delivery fallback, budget caps. Prevents cascading failures and runaway costs.

**Identity Governance** — Structured YAML as source of truth. Token budgets per file. Versioned changes. Staleness detection. Cross-file contradiction detection. The agent cannot modify its own personality or remove its own guardrails.

**Credential Health** — Integration-aware health probes. Expiry tracking. Renewal notifications. Fallback behavior when a provider degrades. The agent never silently stops working.

**Audit Logging** — Every tool execution logged. Reviewable activity history. Cost attribution. Full transparency into agent behavior.

### Layer 2: Templates

Templates are **full operational profiles** — not prompt skins. Each template defines a complete configuration that spans personality, operations, and policy. Like WordPress themes, they're the primary way users customize their agent without touching YAML.

A template controls:

| Dimension | What It Sets | Example Variation |
|---|---|---|
| **Personality** | Tone, relationship, communication style | Guardian: direct, no sugarcoating. Coach: encouraging, firm. |
| **Security posture** | Hardening level, egress rules, isolation | Paranoid: full lockdown, sovereignty mode. Standard: hardened defaults. |
| **Monitoring** | Alert thresholds, check frequency | Guardian: aggressive alerting. Analyst: minimal interruption. |
| **Memory policy** | Tier sizes, summarization style, retention | Companion: long retention, emotional context. Assistant: aggressive pruning. |
| **Cron config** | Heartbeat frequency, quiet hours, budget | Coach: frequent check-ins. Analyst: on-demand only. |
| **Autonomy** | What the agent handles vs. flags | Guardian: high autonomy, pushes back. Assistant: handles routine, flags exceptions. |
| **Integrations** | Recommended/required providers | Coach: tasks + calendar required. Analyst: research + code. |

```yaml
# template.yaml — example
name: "Business Assistant"
version: "1.2.0"
author: "clawops-community"
category: "professional"
description: "Email triage, calendar management, meeting prep"

personality:
  tone: measured
  style: "professional, concise, proactive on logistics"
  relationship: "executive assistant"

security:
  posture: standard          # standard | hardened | paranoid
  egress: default            # default | restricted | allowlist-only

heartbeat:
  frequency: "10min"
  checks: [email, calendar, tasks]
  quiet_hours: "22:00-07:00"

memory:
  hot_max: "50KB"
  warm_retention: "60d"
  summarization: aggressive

integrations_required: [email, calendar, tasks]
skills_included: [morning-brief, meeting-prep, email-digest]
autonomy_default: "handle_routine"
```

**Built-in templates** ship with ClawOps (deeply tested):

| Template | Relationship | Operational Profile |
|---|---|---|
| **Guardian** | Steward, protector | High autonomy, aggressive monitoring, paranoid security option, pushes back |
| **Assistant** | Professional aide | Medium autonomy, balanced monitoring, handles routine, flags exceptions |
| **Coach** | Accountability partner | High check-in frequency, goal tracking, encouraging tone |
| **Analyst** | Research partner | Low proactivity, deep on demand, minimal interruption |
| **Companion** | Conversational partner | Long memory retention, emotional context, regular check-ins |
| **Custom** | User-defined | Guided builder or raw YAML |

**Community templates** extend the platform to use cases we'd never design: real estate agent, student, chronic illness management, day trader, family coordinator, solo founder, academic research. Contributed via PR, reviewed for safety. Templates can never override Layer 1 security baselines.

### Layer 3: Integrations

Tools are organized by **category**, not provider. The agent talks to "calendar" not "Google Calendar." Swapping providers doesn't change agent behavior.

| Category | Example Providers | Interface |
|---|---|---|
| **Email** | Gmail, iCloud, Outlook, Fastmail, ProtonMail | `email inbox`, `email send`, `email search` |
| **Calendar** | Google, iCloud, Outlook, Fastmail | `calendar today`, `calendar create` |
| **Tasks** | Todoist, TickTick, Linear, Notion | `tasks list`, `tasks add`, `tasks complete` |
| **Messaging** | Telegram, WhatsApp, Slack, Discord | Channel config |
| **Files** | Google Drive, Dropbox, iCloud Drive | `files list`, `files get` |
| **Code** | GitHub, GitLab | `code repos`, `code issues` |
| **Finance** | Yahoo Finance, Alpha Vantage | `quote AAPL` |
| **Research** | Tavily, Perplexity | `research <query>` |
| **Notes** | Notion, Obsidian | `notes search`, `notes create` |
| **Health** | Apple Health, manual entry | `health log`, `health summary` |

Each integration ships with: manifest, standard interface, health check, credential lifecycle tracking, fallback behavior, version pinning, and upgrade notifications.

---

## The Onboarding Experience

Three phases matching the three layers:

**Phase 1: Basics** — Name, timezone, waking hours, briefing time. Auto-configures the core platform with hardened defaults.

**Phase 2: Template** — Pick a template, set autonomy level, define hard stops, add optional context (work, interests, health, family). Template applies its full operational profile.

**Phase 3: Integrations** — Pick providers per category. Guided credential setup. Health check verification. Secrets stored in .env, never in config files.

Output: a complete, valid, hardened deployment bundle. Every known landmine already handled. Ready to run.

---

## The Toolchain

### Self-Operated (CLI)

```bash
# Install
curl -fsSL https://get.clawops.dev | sh

# Full lifecycle
clawops init       # Questionnaire → complete, hardened config bundle
clawops build      # Build agent image (from source, never pre-built)
clawops up         # Deploy with hardened defaults
clawops connect    # Connect messaging channel (Telegram, etc.)
clawops status     # Health dashboard: agent, integrations, memory, cost
clawops doctor     # Diagnose issues — surfaces what WOULD have gone wrong
clawops evolve     # Update personality, context, integrations
clawops train      # Refine agent behavior from interaction history
clawops update     # Safe runtime upgrade with compatibility check + rollback
clawops backup     # Encrypted workspace snapshot
clawops export     # Portable profile bundle (yours forever, take it anywhere)
clawops destroy    # Wipe everything — cryptographic verification of deletion
clawops logs       # Stream agent activity
```

**`clawops doctor` is the hero feature.** It runs every diagnostic, checks every known failure mode, and tells you exactly what's wrong (or what would go wrong if left unchecked). The marketing screenshot is `clawops doctor` catching five problems a user didn't know they had.

### Managed Service

Same engine, web interface:

- **Onboarding wizard** — guided setup, same three phases
- **Customer dashboard** — agent status, integration health, memory usage, cost tracking, activity log
- **Fleet console** — our ops view for managing infrastructure
- **"Something's wrong" button** — opens support with full diagnostic context auto-attached
- **Evolution UI** — update personality, context, and integrations without YAML

### Architecture (Managed)

```
┌────────────────────────────────────────────┐
│           ClawOps Console (web)            │
│  Onboarding · Dashboard · Fleet · Support  │
│             WebSocket Hub                   │
└────────────────┬───────────────────────────┘
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

**agentd** (Go binary on each node): receives config, manages Docker lifecycle, applies security hardening, runs health checks, streams operational metadata back, executes memory lifecycle, manages credential health, handles encrypted backups, applies updates with rollback.

---

## Data Sovereignty

For users and templates that require it, ClawOps supports full data sovereignty. This is a configuration choice — the paranoid security posture — not a universal requirement. But it's a powerful differentiator.

### Principles

| Principle | How |
|---|---|
| **Workspace isolation** | Agent runs on isolated infrastructure. We manage the container lifecycle, not the contents. |
| **Identity integrity** | Identity files mounted read-only. Agent cannot modify its own personality or remove guardrails. |
| **Portability** | `clawops export` produces a portable bundle — config, identity, memory, tools, skills. Zero lock-in. |
| **Deletion** | `clawops destroy` wipes everything. Cryptographic verification. |
| **Auditability** | Every tool execution logged. Full transparency into agent behavior. |
| **Open source** | Auditable engine. Verifiable claims. |

### Managed Mode — Operational Boundary

| We CAN see | We CANNOT see |
|---|---|
| Container health (up/down/restarts) | Agent conversations |
| Integration status (healthy/degraded/failed) | Email, task, or calendar content |
| Memory tier sizes (45KB hot, 120KB warm) | Memory contents |
| API cost metrics | What the agent does with the calls |
| Cron job status (running/failed) | Cron job outputs |

This boundary is architecturally enforced. For the paranoid template, it can be extended with user-held encryption keys for at-rest workspace encryption.

---

## Competitive Positioning

### The Landscape

| Option | What You Get | What's Missing |
|---|---|---|
| **Raw OpenClaw** | Full power, full control | Months of setup, ongoing SRE, no lifecycle management |
| **Basic OpenClaw hosting** | Someone runs the container | Default config, no hardening, no memory mgmt, no evolution |
| **No-code agent builders** (Lindy, Relevance AI) | Workflow automation | Not true persistent agents, SaaS data handling |
| **Big-tech agents** (Google, Apple, MS) | Polished, integrated, easy | Platform lock-in, no data sovereignty, black box |
| **ChatGPT / Claude** (direct) | Best models, growing memory | Platform-controlled, no customization, no operational layer |
| **ClawOps** | **Full lifecycle: setup → hardening → monitoring → evolution → support** | — |

### Where We Sit

```
Raw framework ←──────────────────────────────→ Platform lock-in
OpenClaw         Basic hosting      CLAWOPS         Big-tech agents
(powerful,       (default config,   (managed,       (polished,
 expert-only)    no lifecycle)      full lifecycle)  captive)
```

ClawOps competes with raw OpenClaw on ease and with basic hosting on depth. Big-tech agents are market context (why personal agents matter) — they demonstrate the demand that ClawOps serves with an open, manageable alternative.

### The Moat

1. **Operational expertise** — 14+ documented landmines, security hardening, identity governance, memory lifecycle, cron guardrails. Hard-won knowledge that makes open-source agents actually work long-term. This compounds — every new user surfaces new failure modes that get encoded as rules.
2. **Template ecosystem** — Community-built operational profiles (WordPress model). Network effect: more templates → more use cases → more users → more templates.
3. **Full lifecycle** — Nobody else covers onboard → configure → deploy → secure → monitor → evolve → train → support. Basic hosting stops at deploy.
4. **Portability** — `clawops export` gives you everything. Zero lock-in. Users choose ClawOps because it's good, not because they're trapped.
5. **Open source trust** — Auditable engine. Every claim is verifiable. Big-tech agents are black boxes.

---

## The Ecosystem

### Template Marketplace

Templates are the primary way the platform scales beyond built-in use cases. Like WordPress themes, they let the community extend ClawOps to domains we'd never design ourselves.

**Built-in templates** — ship with ClawOps, deeply tested, maintained by the core team.

**Community templates** — contributed via PR, reviewed for safety and quality. Templates can never override Layer 1 security baselines.

**Custom templates** — built via guided builder or raw YAML. For users who know exactly what they want.

Use cases the community enables: real estate agent, student life, chronic illness management, day trading, family coordination, solo founder, academic research, executive assistant, creative writing partner.

### Skill Library

Skills are pre-built capabilities that templates can include:

- **morning-brief** — daily briefing (tasks, calendar, priorities)
- **email-digest** — summarize and triage incoming email
- **meeting-prep** — research attendees, prep talking points
- **session-report** — work session ledger and time tracking
- **construct** — autonomous self-improvement (agent builds its own tools)

Skills are open-source. Community-contributed. Reviewed for safety. Templates declare which skills they include.

### Integration Catalog

Provider-specific implementations of category interfaces. Swapping providers = swapping one integration for another. Agent behavior unchanged.

Each integration ships with: manifest, health check, credential lifecycle tracking, fallback behavior, version pinning, and upgrade notifications.

---

## The Foundation

Everything above is grounded in a production system that's been running for months.

### What Was Built

A personal agent on a home server — OpenClaw gateway with hardened Docker deployment, Telegram bot, 10-minute heartbeat cycle, multiple cron jobs, Claude Opus primary with Sonnet/Haiku subagents, 6 working integrations, 3 skills, 10 operational scripts, and ~13,500 tokens of configuration across 11+ files.

### What This Proved

| Discovery | Implication for ClawOps |
|---|---|
| 40% of config is universal, 60% is personalized | Config generator separates the two — universal is hardened defaults, personalized comes from the questionnaire |
| 14 config landmines silently break agents | Every landmine is a rule in the config generator — impossible to ship a broken config |
| Identity files corrupt, bloat, and go stale | Identity governance: structured YAML, token budgets, versioning, staleness detection |
| Memory accumulates at 360KB/3 days | Memory lifecycle: hot/warm/cold tiers, auto-summarization, size caps |
| Credentials expire silently | Credential health: probes, expiry tracking, renewal notifications |
| Security is opt-in, defaults are dangerous | Security hardened by default — every template starts secure |
| Production agents need ongoing SRE | The entire platform exists because this is true |

Every failure mode became a product feature. Every landmine became a rule. Every script became a module. The prototype isn't the product — it's the R&D that makes the product possible.

---

## Strategy

### Service → Product

Don't build the product first. Run the service by hand. The service IS the research.

**Phase 0: Concierge** — Manually set up 3-5 agents for real people. Deploy on VMs. Observe what they use, what breaks, what they ask for. Document every friction point. If people don't use a hand-crafted agent, they won't use a wizard-generated one.

**Phase 1: CLI** — Automate Phase 0. `clawops init` → `clawops up` → `clawops doctor`. One template (Guardian). Three integrations. The marketing screenshot is `clawops doctor` catching real problems.

**Phase 2: Lifecycle** — Memory lifecycle, cron guardrails, integration health, identity governance, `clawops train`. The invisible operational work that prevents degradation over months. Success metric: an agent runs 30+ days without silent breakage.

**Phase 3: Managed** — Web console, agentd, VM provisioning, billing. Non-technical users can now be served. They never see a terminal — just their agent and a dashboard.

**Phase 4: Ecosystem** — Template marketplace, skill library, community contributions, integration catalog. The platform becomes self-extending.

---

## Open Questions

1. **Phase 0 candidates** — Who are the 3-5 people? What are their use cases? This determines the initial template and integration priorities.
2. **Relationship with OpenClaw** — Inform them? Partner? They might want lifecycle tooling upstream.
3. **Template quality gate** — How do community templates get reviewed? Open marketplace vs. curated garden?
4. **Training pipeline** — What does `clawops train` actually look like? Interaction logs → behavior refinement? Feedback loops? Supervised fine-tuning of prompts?
5. **Pricing** — What does it cost to run one managed agent? What's the price point that works? Needs Phase 0 validation.
6. **Jurisdiction** — Where does ClawOps incorporate? Where do managed VMs live? Matters for the sovereignty-conscious segment.
7. **Encryption model** — For the paranoid template: can we achieve user-held encryption keys for at-rest workspace encryption? What's the trust architecture?
8. **Team** — Service model is one-person friendly. Platform model might need co-founders.
9. **Agent-to-agent** — When agent density is high enough, cross-agent coordination (calendar negotiation, family coordination) becomes possible. When to start designing the protocol?

---

## Philosophy

Personal AI agents are about to become as common as smartphones. The question isn't whether you'll have one — it's whether it works reliably, evolves with you, and operates on your terms.

ClawOps exists because the best open-source agent framework in the world still needs an operational layer to be production-ready. We're that layer — from first setup to long-term evolution.

**OpenClaw is the engine. ClawOps makes it run.**
