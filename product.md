# ClawOps — The Privacy-First Personal Agent Platform

**Your agent. Your data. Your rules.**

---

## The Moment

We are at the beginning of the most intimate technology shift in history. Personal AI agents — systems that check your email, manage your tasks, monitor your health, track your finances, and send you briefings before you wake up — are about to become as common as smartphones.

Google will ship one. Apple will ship one. Microsoft will ship one. Anthropic and OpenAI will ship one. They'll be polished, deeply integrated, and free (or cheap). They'll also see everything: every email, every health condition, every financial anxiety, every relationship, every habit, every weakness. After six months, your agent will hold the most intimate psychological and behavioral profile of you that has ever existed — more complete than your medical records, your email, and your bank account combined.

The question isn't whether you'll have a personal agent. The question is: **who else gets to see that data?**

ClawOps is the answer for people who believe that question matters.

---

## What ClawOps Is

**The Proton of personal AI agents.**

Just as ProtonMail is the privacy-first alternative to Gmail, and ProtonVPN is the privacy-first alternative to trusting your ISP, ClawOps is the privacy-first alternative to trusting a big-tech platform with the most intimate AI relationship you'll ever have.

ClawOps is a full-lifecycle platform for personal AI agents — built on the open-source OpenClaw framework — that handles everything from initial configuration to ongoing operations:

```
Onboard → Configure → Deploy → Secure → Monitor → Evolve → Support
```

You get the power and quality of a big-tech agent. You keep the sovereignty of owning your own data. Even we can't see it.

### Two Modes

**ClawOps Managed** — We operate your agent on isolated infrastructure. We manage the container, not the contents. You never touch a terminal. Even we can't see your data.

**ClawOps Self-Operated** — The same engine as a free, open-source CLI tool. You run it on your own hardware. Complete sovereignty. No dependencies on us.

---

## Why This Exists

### The Spectrum Today

| Option | Quality | Privacy | Effort | Who Owns Your Data |
|---|---|---|---|---|
| **Big-tech agents** (Google, Apple, MS) | Excellent — deeply integrated | None — they see everything | Zero | Platform |
| **ChatGPT / Claude** | Great models, bolted-on memory | Platform sees all conversations | Low | Platform |
| **No-code agents** (Lindy, Relevance AI) | Workflow automation, not true agents | SaaS — they process your data | Low | Platform |
| **Managed OpenClaw hosting** (HostedClaws, xCloud) | Basic — hosting, no personalization | Hoster has VM access | Low | Hoster |
| **Self-hosting OpenClaw** | Excellent (if you survive setup) | Full — your hardware | Extreme | You |
| **ClawOps Managed** | Excellent — hardened, personalized, monitored | **Sovereign — we can't see your data** | Low | **You** |
| **ClawOps Self-Operated** | Excellent — same engine, you run it | Full — your hardware | Medium | **You** |

### The Gap

Today you choose between **easy** (big tech, no privacy) or **private** (self-host, months of expertise). Nobody offers **easy AND private** — a deeply personalized, operationally sound agent where even the service provider can't see your data.

That's ClawOps.

---

## Data Sovereignty

This is not a feature. This is the reason ClawOps exists.

Google will offer a personal agent for free. It will be excellent. And it will feed the most intimate profile of you ever assembled into the same machine that serves you ads. Apple will offer one that's better on privacy — but still locked to their ecosystem, still their hardware, still their rules.

ClawOps exists because this data is too important to hand to any platform. The same way ProtonMail exists because email is too important to let Google read.

### Principles

| Principle | How |
|---|---|
| **We can't see your data** | Agent runs on isolated VM. Workspace encrypted at rest. We manage the container, not the contents. Architecturally enforced, not policy-enforced. |
| **Agent can't modify its own identity** | Identity files mounted read-only. The agent cannot remove its own guardrails or rewrite its own personality. |
| **You can leave anytime** | `clawops export` produces a portable bundle — config, identity, memory, tools, skills. Take it to another provider, self-host, or hand it to a competitor. Zero lock-in. |
| **You can nuke anytime** | `clawops destroy` wipes the VM, all data, all backups. Cryptographic verification of deletion. |
| **Audit everything** | Every tool execution logged. You see exactly what your agent did, when, with what data. Full transparency. |
| **Open source** | The engine is open source. Anyone can audit it. You can verify every privacy claim we make. Big-tech agents are black boxes. |

### What We Can and Cannot See (Managed Mode)

| We CAN see | We CANNOT see |
|---|---|
| Container health (up/down/restarts) | Agent conversations |
| Integration status (healthy/degraded/failed) | Email, task, or calendar content |
| Memory tier sizes (45KB hot, 120KB warm) | Memory contents |
| API cost metrics | What the agent does with the calls |
| Cron job status (running/failed) | Cron job outputs |

---

## The Platform

### Three Layers

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

### Layer 1: Core Platform

The engineering that makes any personal agent safe, observable, and maintainable. Same for every agent, regardless of personality or tools. This is the product — everything else is configuration on top.

**Security** — Container hardening (cap_drop ALL, read-only rootfs, no-new-privileges, non-root user). Egress firewall (DNS + HTTPS only, auto-reapplied). Secrets never in config files. Identity files read-only. All known configuration landmines auto-handled.

**Monitoring & Alerting** — Agent health, integration status, memory usage, cost tracking. Credential expiry alerts (7 days before), memory bloat warnings, silent failure detection, cost overruns, identity staleness, cron circuit breakers.

**Memory Lifecycle** — Hot (≤7 days, in context) → Warm (7-90 days, indexed, searchable) → Cold (90+, archived, summarized). Auto-summarization at each transition. PII masking. Full-text search. Size caps per tier.

**Cron Guardrails** — Exclusive locking, cost estimation, circuit breakers, exponential backoff, quiet hours, timezone-aware scheduling, delivery fallback, budget caps.

**Identity Governance** — Structured YAML as source of truth. Token budgets per file. Versioned changes. Staleness detection. Cross-file contradiction detection. The agent cannot modify its own personality.

**Config Generation** — Questionnaire answers → valid, hardened, complete deployment bundle. Every known landmine encoded as a rule. Schema validation on every change.

### Layer 2: Personality Templates

The personality is a **skin**, not the product — like WordPress themes. Each template defines the agent's relationship dynamic, communication style, and operational stance. Users pick one and customize.

| Template | Relationship | Tone | Proactivity |
|---|---|---|---|
| **Guardian** | Steward, protector | Direct, no sugarcoating | High — surfaces patterns, pushes back |
| **Assistant** | Professional aide | Efficient, measured | Medium — handles routine, flags exceptions |
| **Coach** | Accountability partner | Encouraging, firm | High — tracks goals, celebrates wins |
| **Analyst** | Research partner | Thorough, skeptical | Low — responds to queries, delivers depth |
| **Companion** | Conversational partner | Warm, emotionally aware | Medium — checks in, remembers everything |
| **Custom** | User-defined | User-defined | Guided builder from scratch |

Templates control tone, hard stops, heartbeat frequency, autonomy defaults, memory curation style, and which integrations are recommended. Users customize within any template. Templates can't override Layer 1 security.

Community-contributed templates — like WordPress themes — create an ecosystem: real estate agent, student, chronic illness management, day trader, family coordinator. Each deeply tailored, each bringing users we'd never reach directly.

### Layer 3: Tool Categories

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

Each integration has a manifest, standard interface, health check, credential lifecycle tracking, fallback behavior, and version pinning.

### The Onboarding Questionnaire

Three phases matching the three layers:

**Phase 1: Basics** — Name, timezone, waking hours, briefing time. Auto-configures the core platform.

**Phase 2: Personality** — Pick a template, set autonomy level, define hard stops, add optional context (health, work, family).

**Phase 3: Tools** — Pick providers per category. Guided credential setup. Health check verification. Secrets stored in .env, never in config.

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
clawops update     # Safe runtime upgrade with compatibility check + rollback
clawops backup     # Encrypted workspace snapshot
clawops export     # Portable profile bundle (yours forever, take it anywhere)
clawops destroy    # Nuclear option — wipe everything, cryptographic verification
clawops logs       # Stream agent activity
```

### Managed Service

Same engine, web interface. Onboarding wizard, customer dashboard (agent status, integrations, memory, cost, activity log), fleet console (for our ops), and one button: **"Something's wrong"** → opens support with full diagnostic context auto-attached.

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
│ agentd    │ . . .  │ agentd    │
│ OpenClaw  │        │ OpenClaw  │
│ Guardrails│        │ Guardrails│
│ [encrypted]        │ [encrypted]
└───────────┘        └───────────┘
```

**agentd** (Go binary on each node): receives config, manages Docker lifecycle, applies security, runs health checks, streams metadata (not content) back, executes memory lifecycle, handles encrypted backups.

---

## Competitive Positioning

### The Real Competition

The real competitors aren't other OpenClaw tools. They're the big-tech agents that are coming.

| Option | Experience | Privacy | Your Data |
|---|---|---|---|
| **Google Agent** | Seamless — Gmail, Calendar, Drive, Maps | None — sees everything, trains on it | Google's |
| **Apple Intelligence** | Smooth — iCloud, Health, Messages | Better — on-device where possible | Apple's (mostly) |
| **Microsoft Copilot** | Deep — Office, Teams, Outlook | Enterprise-controlled | Microsoft's |
| **Anthropic/OpenAI** | Powerful — best models, API-first | Platform-dependent | Platform's |
| **ClawOps** | Comparable — same models, open integrations | **Sovereign — even we can't see it** | **Yours** |

### The Proton Playbook

ProtonMail didn't beat Gmail on features. It beat Gmail on values — and built a $1B+ company doing it.

1. **Lead with values, not features.** "We can't read your email" > "We have 15GB storage."
2. **Open source the engine.** Trust through transparency.
3. **Privacy is the premium, not a tax.** People pay MORE for sovereignty.
4. **Free tier builds community.** Proton has free email. ClawOps has the free CLI.
5. **Jurisdiction is brand.** Swiss privacy laws aren't a feature — they're the identity.

### Where We Sit

```
Big tech ←───────────────────────────────→ DIY
Google       CLAWOPS           HostedClaws    OpenClaw
Agent        (sovereign,       (hosted,       (framework)
(integrated,  personalized,    default
 surveilled)  operated)        config)
```

The big-tech agents will be easier. ClawOps will be **yours**.

### The Moat

1. **Data sovereignty architecture** — We literally cannot access your workspace. ProtonMail's "we can't read your email" for agents.
2. **Operational expertise** — Hard-won knowledge (14+ documented landmines, security hardening, identity governance) that makes open-source agents actually work long-term.
3. **Open source trust** — Auditable engine. Verifiable privacy claims. Big-tech agents are black boxes.
4. **Template ecosystem** — Community-built personalities (WordPress model). Network effect: more templates → more users → more templates.
5. **Portability** — `clawops export` gives you everything. Zero lock-in. The anti-platform play.

---

## The Ecosystem

### Template Marketplace

Personality templates are like WordPress themes — they define how the agent behaves, but the underlying engine is the same.

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

heartbeat:
  frequency: "10min"
  checks: [email, calendar, tasks]

integrations_required: [email, calendar, tasks]
skills_included: [morning-brief, meeting-prep, email-digest]
autonomy_default: "handle_routine"
```

**Built-in templates** ship with ClawOps (deeply tested). **Community templates** are contributed via PR and reviewed. **Custom templates** are built via guided builder or YAML. Templates can never override Layer 1 security.

The community creates templates for use cases we'd never design: real estate, student life, chronic illness, day trading, family coordination, solo founder, academic research. Each brings users we'd never reach directly.

### Skill Library

Skills are pre-built capabilities that templates can include:
- **morning-brief** — daily briefing (tasks, calendar, priorities)
- **email-digest** — summarize and triage incoming email
- **meeting-prep** — research attendees, prep talking points
- **session-report** — work session ledger and time tracking
- **construct** — autonomous self-improvement (agent builds its own tools)

Skills are open-source. Community-contributed. Reviewed for safety.

### Integration Catalog

Provider-specific implementations of category interfaces. Swapping providers = swapping one integration for another. Agent behavior unchanged.

Each integration ships with: manifest, health check, credential lifecycle tracking, fallback behavior, version pinning, and upgrade notifications.

---

## Agent-to-Agent (Future Vision)

When thousands of people run ClawOps agents, new possibilities emerge:

- Alice's agent schedules a meeting with Bob's agent (calendar negotiation)
- A family's agents coordinate grocery lists, pickups, meal planning
- A team's agents handle standup summaries, PR reviews, deployment notifications
- A small business's agents triage customer inquiries across timezone coverage

This is where network effects become organic lock-in. Nobody leaves a platform where their agent has relationships with other agents.

**Not building this yet.** But the identity and communication layers are designed to support it from day one:
- Agents need discoverable identities (not just container IDs)
- Cross-agent communication needs a protocol (request/response, not chat)
- Permission model: "Alice allows Bob's agent to see calendar availability but not her task list"

---

## The Foundation

Everything above is grounded in a production system that's been running for months.

### What Was Built

A personal agent (Clawdius Maximus) on a home server — OpenClaw gateway with hardened Docker deployment, Telegram bot, 10-minute heartbeat cycle, 7 cron jobs, Claude Opus primary with Sonnet/Haiku subagents, 6 working integrations, 3 skills, 10 operational scripts, and ~13,500 tokens of configuration across 11+ files.

**What this proved:**
- 40% of configuration is universal (same for any user). 60% is personalized.
- 14 configuration landmines exist that silently break OpenClaw for non-experts.
- Identity files (SOUL.md, USER.md, AGENTS.md) corrupt, bloat, and go stale without governance.
- Memory accumulates at 360KB/3 days without lifecycle management.
- API credentials expire silently. Agents don't notice — they assume nothing to report.
- Security is entirely opt-in. Without hardening, the agent can escalate privileges and read the host.
- Running a production agent requires ongoing SRE work that non-experts won't do.

### What This Means for the Product

Every failure mode above is a product feature. Every landmine is a rule in the config generator. Every script is a module in the CLI. The prototype isn't the product — it's the R&D that makes the product possible.

---

## Strategy

### Service → Product

Don't build the product first. Run the service by hand. The service IS the research.

**Phase 0: Concierge** — Manually set up 3-5 agents for real people. Deploy on VMs. Observe what they use, what breaks, what they ask for. Document every friction point. If people don't use a hand-crafted agent, they won't use a wizard-generated one.

**Phase 1: CLI** — Automate Phase 0. `clawops init` → `clawops up` → `clawops doctor`. One template (Guardian). Three integrations. The marketing screenshot is `clawops doctor` catching real problems.

**Phase 2: Guardrails** — Memory lifecycle, cron guardrails, integration health, identity governance. The invisible work that prevents degradation over months. Success: an agent runs 30+ days without silent breakage.

**Phase 3: Managed** — Web console, agentd, VM provisioning, billing. Non-technical users can now be served. They never see a terminal — just their agent.

**Phase 4: Ecosystem** — Template marketplace, skill library, community contributions, more integrations, agent-to-agent protocol exploration.

---

## Open Questions

1. **Jurisdiction** — Proton chose Switzerland. Where does ClawOps incorporate? Where do managed VMs live? This is a brand decision as much as a legal one.
2. **Encryption model** — Can we achieve true zero-knowledge (we can't decrypt workspace even if compelled)? Or is "we don't look" the realistic starting point? What's the Proton-equivalent trust architecture?
3. **Phase 0 candidates** — Who are the 3-5 people? What are their use cases? This determines everything.
4. **Guardian manifesto** — Publish the philosophy as thought leadership? Frame the sovereignty narrative before big tech ships their agents?
5. **Relationship with OpenClaw** — Inform them? Partner? They might want guardrails upstream.
6. **Template quality gate** — How do community templates get reviewed? Open marketplace vs. curated?
7. **Agent-to-agent protocol** — When to start designing? What's the minimum network size?
8. **Pricing** — Proton proved privacy is a premium. Needs Phase 0 validation.
9. **Team** — Service model is one-person friendly. Platform model might need co-founders.

---

## Philosophy

In an age of digital manipulation — dark patterns, engagement farming, data harvesting — a personal agent should be a **guardian**, not another vector of influence.

The big-tech agents will be more polished. They'll be more integrated. They'll be free.

They'll also know everything about you, and you'll have no say in what happens with that knowledge.

ClawOps exists for people who believe that matters.

**The big-tech agents will be easier. ClawOps will be yours.**
