# ClawHQ Architecture

> Architecture for ClawHQ — the agent platform for OpenClaw.

**Status:** Active Development · **Updated:** 2026-03-17

---

## The Model

OpenClaw is a powerful engine with its own control panel (the Gateway UI). ClawHQ is the platform layer that forges purpose-built agents from blueprints — complete operational designs that configure every dimension of OpenClaw for a specific job.

Everything in OpenClaw is either a file or an API call. ClawHQ controls all of it programmatically.

### Three Layers

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 3: Cloud                                              │
│  Managed hosting · Remote monitoring · Blueprint library     │
├─────────────────────────────────────────────────────────────┤
│  LAYER 2: Blueprints (the product)                           │
│  Complete agent designs for specific jobs.                    │
│  During setup, ClawHQ forges a personalized agent:           │
│  asks preferences, connects services, validates credentials, │
│  generates all config, tools, skills, identity, cron.        │
├─────────────────────────────────────────────────────────────┤
│  LAYER 1: Platform (table stakes)                            │
│  Install · Harden · Launch · Ops · Update                    │
│  Acquire engine, secure it, keep it alive.                   │
│  Same for every agent.                                       │
└─────────────────────────────────────────────────────────────┘
```

### Design Principles

- **One install, one CLI, one binary.** Users install one thing (`clawhq`), run flat commands (`clawhq doctor`, `clawhq init`). Modules are internal architecture for developers — never user-facing. (AD-01)
- **Unix philosophy lives in the agent's tools, not in ClawHQ.** `email`, `calendar`, `tasks`, `quote` — small, composable, single-purpose workspace tools. Blueprints compose them into purpose-built agents. (AD-02)
- **ClawHQ is the install.** Users don't install OpenClaw separately. ClawHQ acquires, configures, and manages the engine.
- **Blueprints are complete agent designs.** Each blueprint configures identity, tools, skills, cron, integrations, security, autonomy, memory, model routing, and egress rules for a specific job.
- **Everything is programmatic.** Every aspect of OpenClaw is a file or API call. ClawHQ controls all of it.
- **Tight coupling to OpenClaw.** No abstraction layer. TypeBox schema, WebSocket RPC, file paths, container structure — used directly. (AD-03)
- **TypeScript throughout.** Shares types with OpenClaw. Validates against the actual schema. (AD-04)
- **Security is the baseline.** Hardening happens automatically, not as an opt-in feature. Content access in managed mode is architecturally blocked. (AD-05)

---

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│  Tier 3: ClawHQ Cloud                              │
│  Managed hosting · Remote health · Blueprint library    │
│  ─── optional — product works without this ───          │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS (health status only)
┌────────────────────────┴────────────────────────────────┐
│  Tier 2: ClawHQ Local (THE PRODUCT)                     │
│  Blueprint engine + platform + ops tooling.             │
│  Blueprints → personalized config → running agent.      │
│  ─── works standalone — this is the product ───         │
└────────────────────────┬────────────────────────────────┘
                         │ WebSocket RPC · Docker API · Filesystem
┌────────────────────────┴────────────────────────────────┐
│  Tier 1: OpenClaw (THE ENGINE)                          │
│  Gateway process · Gateway UI · Channels · Agent        │
│  runtime · Tools · Memory · Cron · Skills               │
│  ─── unmodified — ClawHQ configures, never forks ───    │
└─────────────────────────────────────────────────────────┘
```

---

## Layer 2: Blueprints

This is the product. Everything else is infrastructure.

### What a Blueprint Is

A blueprint is a complete agent design — a YAML file that specifies every dimension of an OpenClaw agent for a specific job. During setup, ClawHQ forges a personalized agent from the blueprint:

1. **User picks a blueprint** — "Email Manager," "Stock Trading Assistant," "Meal Planner"
2. **ClawHQ asks customization questions** — communication style, risk tolerance, dietary restrictions
3. **Credentials connected and validated** — each integration tested live
4. **Everything generated** — config, identity, tools, skills, cron, security, egress rules
5. **Agent forged** — not a generic agent with a personality swap, but a fully configured system designed for a specific job

### Compile-Time vs. Runtime

Agent composition is a compile-time problem, not a runtime problem.

OpenClaw is a secure container that runs an LLM with tools. It doesn't need to understand capabilities, personas, or composition. It needs a `config.yaml`, a `SOUL.md`, tool configs, and skill definitions. Full stop. Everything above that is ClawHQ's job — take high-level intent, compile it to flat runtime config.

This separation serves all three non-negotiables:
- **Data sovereignty:** The entire compilation happens locally. No blueprint, persona, or capability data leaves the machine.
- **Security by default:** The compiler bakes in container hardening, egress rules, and landmine prevention. The user never has to think about it.
- **The agent grows:** New capabilities are added through the compiler's validated pipeline — dependency resolution, conflict detection, coherence checking — not by hand-editing config files.

```
┌─────────────────────────────────────┐
│      ClawHQ UX (current: CLI)       │  ← User touches this
│  Wizard · Sliders · Preview         │     (Studio: planned)
├─────────────────────────────────────┤
│      ClawHQ Compiler (Build)        │  ← Capabilities, personas, composition
│  Blueprint + Catalog → Runtime Cfg  │
├─────────────────────────────────────┤
│      OpenClaw Runtime (OSS)         │  ← Runs what it's given
│  config.yaml · SOUL.md · tools · skills │
└─────────────────────────────────────┘
```

No intermediate concepts survive compilation. A user who hand-configures OpenClaw without ClawHQ never needs to know the compiler layer exists.

### Entity Model

The entities that compose an agent. Three primitives exist today. Two catalog entities (Capability, Persona) are planned compiler additions — they make the sovereign option usable at scale without changing the runtime.

```
PRIMITIVE ENTITIES (exist today, independently defined):

  Integration          Tool               Skill
  ┌──────────────┐     ┌──────────────┐   ┌──────────────────┐
  │ name         │◄────│ name         │◄──│ name             │
  │ envKeys[]    │needs│ commands[]   │uses│ schedule (cron)  │
  │ egressDom[]  │     │ integrations │   │ approval rules   │
  │ probes       │     │              │   │ boundaries       │
  └──────────────┘     └──────────────┘   └──────────────────┘

CATALOG ENTITIES (planned — compiler concepts, not runtime):

  Capability                           Persona
  ┌──────────────────────────────┐     ┌──────────────────────────────┐
  │ id            "inbox-manager"│     │ id          "stoic-operator" │
  │ description                  │     │ soul_template   (with slots) │
  │ tools[] ─────→ Tool[]       │     │ voice_examples[]  (concrete) │
  │ skills[] ────→ Skill[]      │     │ dimensions    (slider defaults│
  │ integrations[] → Integration│     │ anti_patterns[]              │
  │ soul_fragments[]   (prose)  │     └──────────────────────────────┘
  │ suggested_crons[]           │
  └──────────────────────────────┘

  Capability = what can it do. Named tool+skill+integration
  bundle with operational doctrine (soul_fragments). Does NOT
  carry personality or autonomy — those are agent-level.

  Persona = how does it talk. Curated prose bundle with
  voice examples, slider defaults, and anti-patterns. NOT
  MBTI. NOT 16P. Just well-crafted presets. ClawHQ ships
  8-12; users can start blank and write their own SOUL.md.

COMPOSITION:

  Blueprint
  ┌──────────────────────────────────────────────┐
  │ name                                         │
  │ persona ─────────→ Persona          (planned)│
  │ capabilities[] ──→ Capability[]     (planned)│
  │ extra_tools[] ───→ Tool[]     (escape hatch) │
  │ dimension_overrides   (fine-tune persona)    │
  │ soul_overrides        (free-text append)     │
  │ toolbelt.tools[] ─→ Tool[]          (current)│
  │ skill_bundle[] ───→ Skill[]         (current)│
  │ personality.dimensions               (current)│
  │ autonomy_model      (single, agent-wide)     │
  │ security_posture                             │
  │ memory_policy                                │
  │ channels                                     │
  │ model_routing                                │
  └──────────────────────┬───────────────────────┘
                         │ compile
                         ▼
  RUNTIME OUTPUT (flat — what OpenClaw actually gets):
  config.yaml + SOUL.md + USER.md + AGENTS.md + tool configs + skill defs
```

**Dependency chain:** Integration ← Tool ← Skill. Each depends on the one before it.

**Current model (flat):** Blueprints directly reference tools and skills via `toolbelt.tools[]` and `skill_bundle.included[]`. Personality dimensions and SOUL.md content are set directly.

**Planned model:** Capabilities and Personas are catalog entries that the compiler resolves at build time. The compiler pipeline has five stages:

```
1. Resolve dependencies
   └── Capability A needs integration X which needs tool Y
   └── Expand full transitive dependency graph

2. Detect conflicts
   └── Capability A says "never share data externally"
   └── Capability B says "post to social media proactively"
   └── → Surface conflict to user, force a choice

3. Compose and coherence pass (LLM-assisted)
   └── Resolve persona → SOUL.md template with {{slots}}
   └── Inject capability soul_fragments into template slots
   └── Apply dimension_overrides + soul_overrides
   └── Read assembled SOUL.md, identify tonal contradictions
   └── Smooth without losing intent
   └── Show diff to user for approval

4. Validate against model capabilities
   └── Blueprint needs tool-use + long context + vision
   └── Selected model doesn't support vision
   └── → Suggest model upgrade or capability removal

5. Cost estimation
   └── Capabilities + model + cron schedules → monthly API cost
   └── User sees this BEFORE deploying
   └── "Adding news-scanner with 15-min cron on Sonnet ≈ $30/month"

6. Emit flat runtime config
   └── config.yaml + SOUL.md + USER.md + AGENTS.md
   └── tool configs + skill definitions + cron + egress allowlist
```

Two escape hatches: `extra_tools[]` for tools outside any capability, `soul_overrides` for personality that doesn't fit a persona. Power users can bypass the whole compiler and write flat config directly.

**Marketplace security constraint (security by default):** Catalog items (capabilities and personas) are config-only — tool references, skill references, and prose. No scripts or custom code. The runtime sandbox is the security boundary. Custom code requires self-hosting or ClawHQ verification. This is AD-05 applied to the ecosystem: security is architectural (no code path for community-injected scripts), not policy (a flag that could be disabled).

**Derived vs. configured:**

| Output | Derived From |
|---|---|
| SOUL.md | persona.soul_template + capability.soul_fragments + overrides |
| Tool list | union of capability.tools[] + extra_tools[] |
| Skill list | union of capability.skills[] |
| Integration list | union of capability.integrations[] |
| Egress allowlist | union of integration.egressDomains[] |
| Cron schedule | skill.schedule + capability.suggested_crons |
| Docker compose | security posture + integrations |
| .env secrets | integration.envKeys[] |

### What a Blueprint Configures (current)

| Dimension | What Gets Generated | Example: "Stock Trading Assistant" |
|---|---|---|
| **Identity** | SOUL.md, AGENTS.md, personality, boundaries | Analytical, data-driven, conservative risk warnings |
| **Tools** | CLI wrappers installed to workspace | `quote` (market data), `web-search` (research), `tasks` (trade log) |
| **Skills** | Autonomous capability scripts | market-scan, portfolio-alert, research-digest |
| **Cron** | Scheduled jobs in OpenClaw-native format | Pre-market scan at 6am, portfolio check hourly during market |
| **Integrations** | Service connections + credential validation | Yahoo Finance, Tavily research, email for alerts |
| **Security** | Posture, egress firewall, sandbox | Hardened, egress to finance APIs + email only |
| **Autonomy** | What agent does alone vs. asks permission | Auto-monitor, auto-alert; flag before any trade suggestion |
| **Memory** | Retention policy, tier configuration | Remember positions, preferences, market patterns |
| **Models** | Local vs. cloud routing per task type | Local for monitoring, cloud for deep research synthesis |
| **Egress** | Domain allowlist for firewall | Finance APIs + research API + email server, nothing else |

### Blueprint Examples

| Blueprint | Use Case | Key Tools | Key Skills | Cron |
|---|---|---|---|---|
| **Email Manager** | Inbox zero, triage, auto-reply | email, calendar, tasks | email-digest, morning-brief, auto-reply | Inbox check 15min, daily digest 8am |
| **Stock Trading Assist** | Market monitoring, research, alerts | quote, web-search, tasks | market-scan, portfolio-alert, research-digest | Pre-market 6am, hourly during market |
| **Meal Planner** | Nutrition, shopping, weekly plans | web-search, tasks, calendar | meal-plan, shopping-list, nutrition-track | Weekly plan Sun 6pm, daily prep |
| **AI Blog Maintainer** | Research, write, publish | web-search, tasks | research-digest, draft-post, publish-review | Daily research, weekly draft |
| **Replace Google Asst** | Full daily orchestration | email, calendar, tasks, web-search | morning-brief, email-digest, schedule-guard | Morning 7am, heartbeat 10min |
| **Founder's Ops** | Inbox zero, investor updates, hiring | email, calendar, tasks, web-search | email-digest, investor-update, hiring-pipeline | Morning triage, weekly investor prep |
| **Family Hub** | Shared calendar, chores, meals | calendar, tasks, web-search | meal-plan, chore-assign, family-brief | Daily brief, weekly meal plan |

### What Gets Generated

```
Blueprint + user customization + credentials
        ↓
    forge(answers: WizardAnswers)
        ↓
┌─────────────────────────────────────────────────────────┐
│ engine/                                                  │
│   openclaw.json        ← runtime config, 14 landmines   │
│                          auto-handled                    │
│   docker-compose.yml   ← hardened container, correct     │
│                          mounts, egress network          │
│   Dockerfile           ← binary layer from integration   │
│                          needs (himalaya, python3, etc.) │
│   .env                 ← secrets (mode 0600)             │
│   credentials.json     ← integration creds (mode 0600)   │
│                                                          │
│ workspace/                                               │
│   identity/            ← SOUL.md, AGENTS.md, HEARTBEAT   │
│                          populated from blueprint         │
│   tools/               ← CLI wrappers generated from     │
│                          integrations (bash/python3)      │
│   skills/              ← skill scripts from blueprint     │
│   memory/              ← hot/warm/cold skeleton           │
│                                                          │
│ cron/                                                    │
│   jobs.json            ← scheduled jobs, OpenClaw-native  │
│                          format, cron syntax validated    │
│                                                          │
│ security/                                                │
│   posture.yaml         ← standard/hardened/paranoid       │
│ ops/firewall/                                                │
│   allowlist.yaml       ← per-integration domain allowlist │
└─────────────────────────────────────────────────────────┘
```

### The 14 Landmine Rules

Every forged config passes 14 validation rules that prevent silent failures. See `docs/OPENCLAW-REFERENCE.md` for full details on each rule.

| # | What Goes Wrong Without It |
|---|---|
| LM-01 | Device signature loop — agent becomes inaccessible |
| LM-02 | CORS errors — can't manage agent via web |
| LM-03 | Gateway rejects requests through Docker NAT |
| LM-04 | Tool execution silently unavailable |
| LM-05 | Tool security restrictions silently applied |
| LM-06 | Volume mount permission errors |
| LM-07 | Container escape vulnerability |
| LM-08 | Identity files silently truncated |
| LM-09 | Cron jobs silently don't run |
| LM-10 | Docker Compose deploy failure |
| LM-11 | Integration APIs silently fail |
| LM-12 | Agent modifies its own config |
| LM-13 | Network egress unfiltered |
| LM-14 | Filesystem access misconfigured |

---

## The Skill System

Skills are the agent's autonomous capabilities — declarative definitions that tell the agent what to do, when, and within what boundaries. Where blueprints define the complete agent design, skills are the individual units of autonomous behavior that blueprints compose.

### What a Skill Is

A skill is a declarative capability definition consisting of two files:

- **SKILL.md** — Human-readable behavior specification: what the skill does step-by-step, its boundaries, and its prompt templates.
- **config.yaml** — Machine-readable configuration: schedule, model requirements, tool dependencies, approval gates, and boundary flags.

Skills are not code. They are instructions that the agent follows at runtime using its existing tools and model. The cron scheduler triggers the agent with "Run skill: `<name>`", the agent reads the SKILL.md for behavior, loads prompt templates from `prompts/`, and executes each step using its workspace tools.

### Skill Lifecycle

```
┌──────────┐     ┌───────────────┐     ┌───────────────┐     ┌────────────┐     ┌──────────────┐
│  Trigger  │────▶│ Prompt Template│────▶│ Model Execution│────▶│  Boundary  │────▶│  Approval    │
│  (cron)   │     │  (SKILL.md +  │     │  (local or    │     │  Check     │     │  Gate        │
│           │     │   prompts/)   │     │   cloud)      │     │            │     │  (if config) │
└──────────┘     └───────────────┘     └───────────────┘     └────────────┘     └──────────────┘
```

1. **Trigger** — The cron scheduler fires based on the skill's `schedule.cron` expression, constrained by `active_hours`.
2. **Prompt template** — The agent reads SKILL.md for the behavior steps and loads step-specific prompt templates from `prompts/`.
3. **Model execution** — The agent executes each step using the configured model (`model.provider`, `model.minimum`). Cloud escalation is per-skill: some skills are local-only (`cloud_escalation: false`), others allow cloud for quality (`cloud_escalation: true`).
4. **Boundary enforcement** — Every action is checked against the skill's `boundaries` flags: `network_access`, `file_write`, `account_changes`, `auto_send`. A skill with `auto_send: false` cannot send emails regardless of what the model produces.
5. **Approval gate** — If `approval.required: true`, proposed actions (draft emails, calendar changes, meal plans) are enqueued with a category and metadata. The user reviews and approves via their messaging channel. Nothing executes without consent.

### config.yaml Schema

Every skill's `config.yaml` follows a consistent schema:

```yaml
name: skill-name
version: "1.0.0"
description: "One-line purpose"

schedule:
  cron: "*/15 * * * *"       # When to trigger (cron syntax)
  active_hours:
    start: 6                  # Earliest hour (24h)
    end: 23                   # Latest hour (24h)

model:
  provider: local             # "local" (Ollama) — always the default
  minimum: "llama3:8b"        # Minimum model capability
  cloud_escalation: false     # Whether cloud models are allowed

dependencies:
  tools:                      # Workspace tools this skill uses
    - email
    - calendar
  skills: []                  # Other skills this skill depends on

approval:
  required: true              # Whether actions need user consent
  category: send_email        # Approval queue category
  auto_approve: false         # Whether ops can auto-approve

boundaries:
  network_access: false       # Can the skill make external requests?
  file_write: false           # Can the skill write to workspace files?
  account_changes: false      # Can the skill modify account state?
  auto_send: false            # Can the skill send messages/emails?
```

### How Blueprints Compose Skills

Blueprints reference skills by name. During setup, ClawHQ installs the referenced skills into the agent's `workspace/skills/` directory and generates corresponding cron entries in `cron/jobs.json`.

| Blueprint | Skills Composed | Why |
|---|---|---|
| **Email Manager** | email-digest, morning-brief, schedule-guard | Inbox triage + daily brief + calendar protection |
| **Stock Trading Assist** | market-scan, morning-brief | Market monitoring + daily brief |
| **Meal Planner** | meal-plan, morning-brief | Weekly meal plans + daily brief |
| **Founder's Ops** | email-digest, investor-update, morning-brief, schedule-guard | Inbox + investor prep + brief + calendar |

Skills are composable units — the same `morning-brief` skill works across Email Manager, Founder's Ops, and Family Hub, configured with different cron times per blueprint.

### Boundary Enforcement

Boundaries are architectural, not advisory. Each boundary flag in `config.yaml` maps to a runtime constraint:

- **`network_access: false`** — Skill execution is restricted to local tool invocations. External API calls are blocked by the egress firewall's per-skill rules.
- **`auto_send: false`** — Any action that would send data externally (email, message) is intercepted and routed to the approval queue instead.
- **`file_write: false`** — Skill cannot modify workspace files. Read-only access only.
- **`account_changes: false`** — Skill cannot modify account state (archive emails, delete events, move folders).

Combined with the egress firewall (`CLAWHQ_FWD` iptables chain) and the approval queue, boundaries ensure that a skill can only do what its configuration explicitly permits. A misconfigured prompt template or unexpected model output cannot bypass these constraints.

### Built-in Skills

| Skill | Purpose | Schedule | Approval |
|---|---|---|---|
| **email-digest** | Inbox triage, categorize, draft responses | Every 15 min | Required — draft responses queued |
| **morning-brief** | Daily briefing (email + calendar + tasks) | Once daily | Not required — read-only |
| **market-scan** | Watchlist tracking, price alerts, news | Hourly during market | Not required — informational |
| **meal-plan** | Weekly meal plan + shopping list | Weekly (Sunday) | Required — plan queued for review |
| **schedule-guard** | Conflict detection, focus block protection | Every 15 min | Required — calendar changes queued |
| **investor-update** | Weekly investor update draft | Weekly (Friday) | Required — draft queued for review |

---

## Layer 1: The Platform

Table stakes. Same for every agent. Handles the lifecycle that OpenClaw doesn't.

### Install Phases

```
Install → Configure → Harden → Tools → Skills → Ops → Launch → Cloud
   ↓         ↓          ↓        ↓       ↓       ↓       ↓        ↓
Engine    Blueprint   Security  Agent's  Agent's  Prod    Running  Remote
acquired  forged     baseline   hands    brain    grade   agent    monitor
```

Each phase produces a working state. The user gets value at every checkpoint.

### Engine Acquisition

| Path | Trust Model | What Happens |
|---|---|---|
| **Trusted cache** (default) | Signed releases from clawhq.com | Download, verify SHA256 + GPG signature |
| **From source** (zero-trust) | User audits code before build | Clone repo, inspect, full Docker build |

### Integration with OpenClaw

ClawHQ integrates through four surfaces — all programmatic:

| Surface | What | How ClawHQ Uses It |
|---|---|---|
| **Config file** | `openclaw.json` | Write via Gateway `config.patch` RPC. Direct write when Gateway is down. |
| **Workspace** | `workspace/` — identity, memory, skills, tools | Read/write as files. Identity read-only at runtime. |
| **Cron** | `cron/` — jobs + execution history | Write `jobs.json`, read run logs. Gateway hot-reloads. |
| **Gateway WebSocket** | `:18789` — config, sessions, health | Token-authenticated. Rate limited (3 req/60s for config writes). |

### What OpenClaw Already Handles (Don't Replicate)

Message routing, model API calls, tool execution, session persistence, channel protocols, config schema validation, and the Gateway UI. See `docs/OPENCLAW-REFERENCE.md` for full details.

---

## Security Architecture

### Container Hardening (Applied Automatically)

| Control | Standard | Hardened | Paranoid |
|---|---|---|---|
| Linux capabilities | `cap_drop: ALL` | `cap_drop: ALL` | `cap_drop: ALL` |
| Filesystem | Read-only rootfs | Read-only rootfs | Read-only rootfs + encrypted workspace |
| Privilege escalation | `no-new-privileges` | `no-new-privileges` | `no-new-privileges` |
| User | Non-root (UID 1000) | Non-root (UID 1000) | Non-root (UID 1000) |
| Network isolation | ICC disabled | ICC disabled | ICC disabled + allowlist egress |
| Resource limits | 4 CPU / 4GB RAM | 2 CPU / 2GB RAM | 1 CPU / 1GB RAM |
| Identity files | Read-only mount | Read-only mount | Read-only mount + integrity hash |

### Egress Firewall

Dedicated iptables chain (`CLAWHQ_FWD`):
1. Allow ESTABLISHED/RELATED
2. Allow DNS (UDP/TCP 53)
3. Allow HTTPS (TCP 443) to allowlisted domains only (per-integration)
4. LOG + DROP everything else

Reapplied automatically after every `docker compose down`.

### Credentials

- Secrets in `.env` (mode 0600)
- Integration credentials in `credentials.json` (mode 0600)
- Never in `openclaw.json`, workspace files, or logs
- Health probes validate each integration on schedule

### Three Audit Systems

| System | Purpose | Integrity |
|---|---|---|
| Tool execution | What the agent did | Append-only JSONL |
| Secret lifecycle | Secret added/rotated/revoked | HMAC-chained |
| Egress | What data left the machine | Append-only JSONL |

---

## Deployment Options

Same platform. Same blueprints. Same security. Different host.

| Option | Who Manages Host | Cost |
|---|---|---|
| User's PC (Linux, macOS, WSL) | User | $0 + compute |
| Mac Mini (home server) | User | $0 + hardware |
| DigitalOcean / Hetzner / Vultr | ClawHQ managed | VPS + managed fee |
| Any VPS | User | VPS cost |

### Managed Mode

In managed mode, the same platform runs with an `agentd` daemon that receives config from a web console, streams health metadata back. The console never sees agent content — only operational status.

| We CAN see | We CANNOT see |
|---|---|
| Container health | Agent conversations |
| Integration status | Email/task/calendar content |
| Memory tier sizes | Memory contents |
| Cost metrics | What the agent does |

---

## Data Flow

```
User ──message──▶ Channel (Telegram/WhatsApp/etc.)
                        │
                        ▼
              ┌─── OpenClaw Gateway ───┐
              │  Route → Agent → Tools │
              │  Memory ← → Workspace  │
              └────────────────────────┘
                        │
            WebSocket RPC│  Filesystem
                        ▼
              ┌─── ClawHQ ─────────────┐
              │  Blueprint Engine ·    │
              │  Monitor · Doctor ·    │
              │  Audit · Firewall      │
              └────────────────────────┘
                        │ (optional)
              HTTPS (health│only)
                        ▼
              ┌─── ClawHQ Cloud ───────┐
              │  Managed hosting ·     │
              │  Blueprint library ·   │
              │  Fleet                 │
              └────────────────────────┘
```

---

## The Deployment Directory

```
~/.clawhq/
├── clawhq.yaml                    # Meta-config (version, install method, cloud token)
│
├── engine/                        # OpenClaw runtime
│   ├── openclaw.json              # Runtime config (forged from blueprint)
│   ├── .env                       # Secrets (mode 0600)
│   ├── docker-compose.yml         # Hardened container config
│   ├── Dockerfile                 # Stage 2 custom layer
│   └── credentials.json           # Integration credentials (mode 0600)
│
├── workspace/                     # Agent's world (mounted into container)
│   ├── identity/                  # Who the agent is (read-only mount)
│   ├── tools/                     # What the agent can do (CLI wrappers)
│   ├── skills/                    # What the agent does autonomously
│   └── memory/                    # What the agent remembers (hot/warm/cold)
│
├── ops/                              # Operational tooling
│   ├── doctor/                    # Diagnostics
│   ├── monitor/                   # Health + alerts
│   ├── backup/snapshots/          # Encrypted backups
│   ├── updater/rollback/          # Pre-update images
│   ├── audit/                     # Tool, secret, egress logs
│   └── firewall/                  # Egress allowlist
│
├── security/                      # Posture + sandbox config
├── cron/                          # Scheduled jobs
└── cloud/                         # Cloud connection (optional)
```

---

## Modules

Six internal modules, each a distinct domain. These are developer-facing source organization — never exposed to users. (AD-01)

| Module | What You're Doing | What It Owns |
|---|---|---|
| **design** | Choosing a blueprint, customizing, configuring | Blueprint engine, setup wizard, tool generators, identity files. THE PRODUCT. |
| **build** | Installing, compiling, deploying | Installer, pre-reqs, engine acquisition, Docker build, deploy orchestration. |
| **secure** | Hardening, credentials, auditing | Container hardening, firewall, credential store, audit trail, scanning, sandbox. |
| **operate** | Monitoring, diagnosing, maintaining | Doctor, monitor daemon, backup/restore, updates, status dashboard, logs. |
| **evolve** | Adding skills, growing capabilities | Skill lifecycle, tool installation, capability evolution, rollback, export, destroy. |
| **cloud** | Remote monitoring, managed hosting | Health heartbeat, command queue, agentd daemon, fleet management, blueprint library. |

**Composition:** build acquires → design forges → secure hardens → operate monitors → evolve grows → cloud optionally wraps it all.

---

## Package Structure

```
clawhq/
├── src/
│   ├── cli/                        # Commander.js CLI (thin layer over modules)
│   │
│   ├── design/                     # Design: blueprint engine (THE PRODUCT)
│   │   ├── blueprints/             # Blueprint library, loader, mapper, customizer
│   │   ├── configure/              # Setup wizard, generate, writer
│   │   ├── tools/                  # CLI tool generators
│   │   └── identity/               # Identity file generators
│   │
│   ├── build/                      # Build: install and deploy
│   │   ├── installer/              # Pre-reqs, engine acquisition, scaffold
│   │   ├── docker/                 # Two-stage build, compose, Dockerfile gen
│   │   └── launcher/               # Deploy orchestration (up/down/restart)
│   │
│   ├── secure/                     # Secure: security and compliance
│   │   ├── sanitizer/              # Input injection detection + sanitization
│   │   ├── credentials/            # Credential store + health probes
│   │   ├── audit/                  # Audit logging (tool, secret, egress, cloud)
│   │   └── scanner/                # PII + secret scanning
│   │
│   ├── operate/                    # Operate: monitoring and maintenance
│   │   ├── doctor/                 # Diagnostics + auto-fix
│   │   ├── monitor/                # Health monitoring daemon
│   │   ├── backup/                 # Encrypted backup/restore
│   │   ├── updater/                # Safe updates + rollback
│   │   ├── status/                 # Dashboard
│   │   └── logs/                   # Log streaming
│   │
│   ├── evolve/                     # Evolve: grow the agent
│   │   ├── skills/                 # Skill install/update/remove + vetting
│   │   ├── capabilities/           # Capability evolution
│   │   ├── rollback/               # Change rollback
│   │   └── lifecycle/              # Export + destroy
│   │
│   ├── cloud/                      # Cloud: remote monitoring + managed hosting
│   │   ├── agentd/                 # Managed mode daemon
│   │   ├── heartbeat/              # Health reporting
│   │   ├── commands/               # Command queue (pull, verify, execute)
│   │   ├── fleet/                  # Multi-agent management
│   │   └── provisioning/           # Cloud instance provisioning engine
│   │       └── providers/          # Provider adapters (DigitalOcean)
│   │
│   ├── web/                        # Web dashboard (Hono + htmx, CQ-040)
│   │   ├── pages/                  # 7 dashboard pages (doctor, logs, approvals, init, etc.)
│   │   └── server.tsx              # Hono server + layout
│   │
│   ├── gateway/                    # OpenClaw Gateway communication (cross-cutting)
│   └── config/                     # Config types + schema (cross-cutting)
│
├── configs/blueprints/             # Built-in blueprint YAML files
├── package.json
└── tsconfig.json
```

**Cross-module security code:** Some security concerns live outside `src/secure/`, co-located with their operational context:
- Container hardening (posture) → `src/build/docker/posture.ts`
- Egress firewall (iptables CLAWHQ_FWD) → `src/build/launcher/firewall.ts`
- Landmine validation (14 rules) → `src/config/validate.ts`

---

## Zero-Trust Remote Admin

The cloud layer is where trust can be destroyed. This is designed so paranoid users can inspect every byte.

### Three Trust Modes

| Mode | Default For | Cloud Connection | Inbound Commands | Outbound Data |
|---|---|---|---|---|
| **Paranoid** | Self-managed | DISABLED | NONE | NONE |
| **Zero-Trust** | Managed | OUTBOUND ONLY (agent initiates) | SIGNED + USER-APPROVED | HEALTH STATUS ONLY |
| **Managed** | Managed (explicit opt-in) | OUTBOUND + WEBSOCKET | SIGNED + AUTO-APPROVED (ops only) | HEALTH + OPERATIONAL METADATA |

### Protocol

**Agent-initiated only.** The cloud never reaches in. No open ports, no SSH, no reverse tunnels.

**Command queue (pull, never push).** The cloud puts commands in a queue. The agent fetches on its schedule, verifies signature, executes or rejects.

**Cryptographic command signing.** Every command signed. Agent verifies against pinned public key.

### Command Classification

| Command | Paranoid | Zero-Trust | Managed |
|---|---|---|---|
| Health check ping | BLOCKED | ALLOWED | ALLOWED |
| Update notify | BLOCKED | ALLOWED | ALLOWED |
| Security advisory | BLOCKED | ALLOWED | ALLOWED |
| Trigger update | BLOCKED | APPROVAL | AUTO |
| Trigger backup | BLOCKED | APPROVAL | AUTO |
| Restart agent | BLOCKED | APPROVAL | AUTO |
| Apply config patch | BLOCKED | APPROVAL | APPROVAL |
| Read health status | BLOCKED | ALLOWED | ALLOWED |
| Read operational metrics | BLOCKED | BLOCKED | ALLOWED |
| **Read memory contents** | **BLOCKED** | **BLOCKED** | **BLOCKED** |
| **Read conversations** | **BLOCKED** | **BLOCKED** | **BLOCKED** |
| **Read credential values** | **BLOCKED** | **BLOCKED** | **BLOCKED** |
| **Read identity files** | **BLOCKED** | **BLOCKED** | **BLOCKED** |
| **Shell access** | **BLOCKED** | **BLOCKED** | **BLOCKED** |

The bottom five are **architecturally blocked** — the `agentd` daemon has no code path for these operations. (AD-05)

### Kill Switch

```bash
clawhq cloud disconnect         # Immediate. No confirmation prompt.
```

Agent keeps running with full functionality.

---

## Architectural Decisions

Settled. Do not revisit without strong reason.

### AD-01: One binary, flat CLI
Modules are internal source organization. Users see flat commands: `clawhq init`, `clawhq doctor`, `clawhq up`. One npm package, one install.

### AD-02: Unix philosophy in agent tools, not in ClawHQ
Small, composable workspace tools (`email`, `calendar`, `tasks`). Blueprints compose them. ClawHQ is the orchestrator.

### AD-03: Tight coupling to OpenClaw
No abstraction layer. TypeBox schema, WebSocket RPC, file paths used directly. If a competing framework appears, that's a rewrite.

### AD-04: TypeScript monorepo, single package
One package. Module boundaries via barrel exports and directory structure.

### AD-05: Security is architecture, not policy
Content access in managed mode is architecturally blocked — no code path exists. Not a permission flag.

---

## Tech Stack

| Component | Choice | Rationale |
|---|---|---|
| **Language** | TypeScript (strict, ESM) | Matches OpenClaw. Shares schema types. |
| **Runtime** | Node.js ≥22 | Same as OpenClaw. |
| **CLI** | commander ^14 | Lightweight, subcommand trees. |
| **Testing** | vitest ^4 | Fast, TypeScript-native. |
| **Distribution** | npm global | Target audience has Node.js. |

---

## Implementation Priority

See `docs/PRODUCT.md` → Build Order for parallel tracks and `backlog/backlog.json` for sprint-ready items.
