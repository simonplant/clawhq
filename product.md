# ClawOps — SRE for OpenClaw Agents

**Date**: 2026-03-11
**Author**: Simon Plant + Claude Code (research & synthesis)
**Status**: Design / Pre-build
**Brand**: ClawOps — the complete lifecycle platform for OpenClaw agents (design → deploy → operate → evolve)
**Philosophy**: KAHU — the design principles behind how agents should serve people

---

## 1. Purpose

**One sentence**: SRE for OpenClaw — configure, personalize, harden, deploy, monitor, and evolve personal AI agents across their entire lifecycle.

**The problem**: OpenClaw gives you everything and protects you from nothing. Configuration has ~30 surfaces with landmines. Identity files corrupt, bloat, and go stale. Operations require deep Linux/Docker expertise. Security is opt-in. The result: only infrastructure experts can build a production agent. Everyone else gets burned.

**The solution**: ClawOps is the operational layer for OpenClaw agents. It sits at the console outside — loading the right configuration, monitoring health, catching silent failures, managing memory lifecycle, and pulling the emergency brake when things go wrong. Not a hosting platform (HostedClaws and xCloud already do that). Not a no-code builder (Lindy and Relevance AI do that). The SRE toolkit that makes OpenClaw agents reliable at scale.

**The metaphor**: Your agent is in the field. ClawOps is at the console — watching vitals, loading programs, spotting threats before the agent does, pulling the emergency brake when things go sideways. It doesn't go in. It keeps everything inside alive and effective.

**Two modes, same engine:**
1. **OSS tool** — Run the wizard, get a working agent, use the CLI to keep it healthy.
2. **Managed service** — Same engine, we handle infrastructure + monitoring + support.

---

## 2. Why Not Just Use What Exists?

### Existing Options and Their Gaps

| Option | What It Does | What It Doesn't Do |
|---|---|---|
| **ChatGPT / Claude** | Stateless conversations with bolted-on memory | No proactive behavior, no tool execution, no scheduling, no autonomy |
| **Custom GPTs** | Custom personality via system prompt + file upload | No persistent memory, no integrations, no cron, can't leave ChatGPT web |
| **Lindy.ai** ($20-50/mo) | No-code workflow automation with AI | Workflow-first not agent-first. No identity, no memory evolution, credit-metered |
| **Dust.tt** ($29/user/mo) | Enterprise AI agents connected to company data | Team-oriented, not personal. SaaS-only. |
| **HostedClaws / xCloud** | Managed OpenClaw hosting (deploy in 5 min) | Just hosting. No personalization wizard. No guardrails. Same config nightmares. |
| **Clawbot AI** | OpenClaw SaaS with model selection UI | Cloud-only. No deep personalization. No operational guardrails. |
| **Self-hosting OpenClaw** | Full control, maximum customization | Requires Simon-level expertise. ~30 config surfaces. Months of trial and error. |

### The Gap

Nobody does: "Tell me about yourself → here's a deeply personalized agent with safe defaults, managed memory, health-checked integrations, cost guardrails, and the 14 configuration landmines already handled."

Hosting is solved. Configuration intelligence is not.

---

## 3. The Prototype: What Simon Built

### The System

A production personal agent (Clawdius Maximus) running on a home server:
- Ubuntu 24.04, Ryzen 9 9950X3D, RTX 5090 32GB
- 5 Docker Compose stacks (infra, AI, home, dev, OpenClaw)
- OpenClaw gateway with custom two-stage Docker image (built from source, never pre-built)
- Telegram bot, 10-minute heartbeat cycle, 7 cron jobs
- Claude Opus 4.6 (primary), Sonnet 4.6 (subagents), Haiku 4.5 (heartbeat)
- Local embeddings via Ollama on RTX 5090

### What It Took

| Category | Components | Effort |
|---|---|---|
| **Identity** | SOUL.md (80 lines), USER.md (94 lines), AGENTS.md (150 lines), HEARTBEAT.md (72 lines), TOOLS.md (84 lines) | Weeks of iteration |
| **Configuration** | openclaw.json (128 lines), docker-compose.yml (121 lines), .env (40 lines), cron/jobs.json (158 lines) | Dozens of debugging sessions |
| **Tools** | todoist (186 LOC), todoist-sync (234), quote (278), ical (406), tavily (91), airtable | ~1,200 LOC |
| **Skills** | morning-brief (111 LOC), session-report (119 LOC), construct-weekly | 3 skills |
| **Operations** | 10 bash scripts (firewall, backup, permissions, config-fix, update, scanner) | Continuous |
| **Security** | Container hardening, egress firewall, PII scanner, encrypted backups | Ongoing |
| **Total** | ~1,069 lines of config/identity, ~1,200 lines of tools, 10 operational scripts | Months |

### The Numbers

The deployed agent produces **~13,500 tokens** of configuration across 11+ files:
- **40% universal** (same structure for any user)
- **60% personalized** (varies per user's life, systems, preferences)
- **14 hard-won lessons** encoded (things that break if not done exactly right)

### Hard-Won Lessons (What Breaks Without Expertise)

These are non-negotiable implementation details. Getting any one wrong causes failure:

1. `dangerouslyDisableDeviceAuth: true` — upstream bug; removing it = infinite auth loop
2. `tools.exec.host: "gateway"` — must be gateway; "node" bypasses sandbox, "sandbox" fails silently
3. `user: "1000:1000"` — must be node user; 65534 causes permission failures on mounts
4. Cron schedule field is `expr` not `cron` in jobs.json
5. Config mounts must be `:ro` (read-only) — agent can't modify its own config
6. Read-only root filesystem with `/tmp:noexec,nosuid`
7. Every `openclaw onboard` silently strips `allowedOrigins` and `trustedProxies` — must restore
8. `trustedProxies` must match Docker bridge IP (auto-detected, not hardcoded)
9. Paths in exec must use `/home/node/.openclaw/workspace/`, not `~/workspace/` (~ doesn't expand)
10. MEMORY.md must only load in main session (never in group chats — PII leak risk)
11. Heartbeat must respond `HEARTBEAT_OK` for silent pass (suppresses notification spam)
12. `cap_drop: ALL` + `no-new-privileges` + `read_only: true` — container hardening trio
13. ICC disabled on openclaw-net (containers can't talk to each other, only egress)
14. Egress firewall: DNS + HTTPS only (re-apply after every `docker compose down`)

---

## 4. Failure Modes (What Happens Without Guardrails)

### Configuration

| Failure | What Happens | Likelihood for Non-Expert |
|---|---|---|
| Remove `dangerouslyDisableDeviceAuth` | Gateway enters infinite auth loop, completely inaccessible | Likely (name suggests it should be false) |
| Run `openclaw onboard` | Silently strips allowedOrigins + trustedProxies. Control UI breaks. | Certain (every time) |
| Set `exec.host: "node"` | Bypasses all sandboxing. Agent runs commands on host process. | Possible |
| Leave `fs.workspaceOnly: false` without path scoping | Agent can read any file on the host | Likely |
| Put API keys in openclaw.json | Keys exposed if backup/config leaked | Certain |

### Identity

| Failure | What Happens | Likelihood |
|---|---|---|
| SOUL.md grows past 20K chars | Silently truncated (head 70%, tail 20%). Identity becomes incoherent. | Certain (weeks) |
| Agent edits its own SOUL | Safety guardrails removed. No audit trail. | Possible |
| Health data goes stale | Agent gives advice based on 8-month-old lab values | Certain |
| Cross-file contradictions | SOUL says one thing, AGENTS says another. Unpredictable behavior. | Likely |

### Memory

| Failure | What Happens | Likelihood |
|---|---|---|
| Daily logs accumulate forever | 360KB in 3 days → 43MB/year. Context window starved. No archival. | Certain |
| No curation mechanism | "Review periodically" = never. Manual curation doesn't scale. | Certain |
| PII in daily logs | Names, emails, health data in plaintext. No masking. | Certain |
| No search | Finding past events = manual grep through hundreds of files | Certain |

### Operations

| Failure | What Happens | Likelihood |
|---|---|---|
| API credentials expire | Tool returns empty data. Agent assumes nothing to report. Silently broken for weeks. | Certain |
| Cron jobs overlap | Duplicate work, context interleaving, cost explosion | Likely |
| No backups | Disk fail = all agent knowledge gone | Certain (without manual setup) |
| No cost visibility | 10-min Opus heartbeat = surprise API bill | Likely |
| Logs grow unbounded | Disk fills after weeks/months | Certain |

---

## 5. The Engine — Three Layers

The product separates three concerns that are currently tangled together:

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

### Layer 1: Core Platform (What We Engineer)

This is the same for EVERY agent, regardless of personality or tools. This is the product — the engineering that makes any personal agent safe, observable, and maintainable.

**Security Engineering:**
- Container hardening: `cap_drop: ALL`, `read_only: true`, `no-new-privileges`, `tmpfs /tmp`, user 1000:1000
- Egress firewall: DNS + HTTPS only, re-applied automatically
- Secrets management: env var injection only, never in config files
- Identity files: read-only mount (agent can't modify its own personality)
- All 14 configuration landmines auto-handled (see Section 3)

**Logging:**
- Audit log of every tool execution (who, what, when, args, result)
- Session logs with structured metadata
- Log rotation (prevent unbounded growth)

**Monitoring:**
- Agent health (container status, uptime, restarts)
- Integration health (per-tool status: healthy/degraded/failed/expired)
- Memory usage (hot/warm/cold tier sizes, approach to token budgets)
- Cost tracking (API token usage per model, per day)

**Alerting:**
- Credential expiry (7 days before, with renewal guidance)
- Memory bloat (approaching truncation thresholds)
- Silent failures (tool returns empty data, cron job errors)
- Cost overruns (daily/monthly budget thresholds)
- Identity staleness (health data >6 months old, stale context)
- Cron failures (circuit breaker after 3 consecutive errors)

**Memory Lifecycle:**
- Hot (≤7 days, in context) → Warm (7-90 days, indexed) → Cold (90+, archived)
- Auto-summarization at each transition
- PII masking before write
- Full-text search index
- Size caps per tier

**Cron Guardrails:**
- Exclusive locking (no overlapping jobs)
- Cost estimation before enabling schedules
- Circuit breaker (auto-disable after consecutive failures)
- Exponential backoff on failures
- Quiet hours enforcement
- Timezone-aware scheduling (DST handled)
- Delivery fallback (primary channel down → try secondary)
- Budget caps (pause agent, not kill)

**Config Generation:**
- Questionnaire answers → valid openclaw.json + docker-compose.yml + .env
- All 14 landmines encoded as rules (see Section 3)
- Post-onboard config restoration (automated)
- Schema validation on every change

### Layer 2: Personality Templates (Choose One, Customize)

The personality is a **skin**, not the product. Each template defines the agent's relationship dynamic, communication style, and operational stance. Users pick one and customize.

| Template | Relationship | Tone | Proactivity | Focus |
|---|---|---|---|---|
| **Guardian** (KAHU) | Steward, protector | Direct, no sugarcoating | High — surfaces patterns, pushes back | Accountability, long-term health |
| **Assistant** | Professional aide | Efficient, measured | Medium — handles routine, flags exceptions | Task execution, email triage |
| **Coach** | Accountability partner | Encouraging, firm | High — tracks goals, celebrates wins | Progress tracking, habit building |
| **Analyst** | Research partner | Thorough, skeptical | Low — responds to queries, delivers depth | Research, data analysis, synthesis |
| **Companion** | Conversational partner | Warm, emotionally aware | Medium — checks in, remembers everything | Relationship, memory, daily rhythm |
| **Custom** | User-defined | User-defined | User-defined | Guided builder from scratch |

**What a template controls:**
```yaml
# Example: Guardian template
personality:
  tone: direct
  style: "proactive, no sugarcoating, pattern recognition"
  relationship: "guardian, not assistant"
  principles: ["accountability", "long-term over short-term", "name patterns"]

hard_stops:  # template defaults + user additions
  - "Never delete files (use trash)"
  - "Never take irreversible actions without confirmation"
  - "Never share personal data outside approved channels"

heartbeat:
  frequency: "10min"         # Guardian checks often
  checks: [email, tasks, calendar]
  silent_when_clear: true

autonomy_default: "handle_routine"  # Guardian is proactive by default

memory_policy:
  curation_style: "pattern_focused"  # Guardian looks for behavioral patterns
  health_tracking: true              # Guardian monitors health context
```

**Customization within any template:**
- Communication style override
- Additional hard stops
- Heartbeat frequency adjustment
- Autonomy level override
- Memory policy tweaks

### Layer 3: Tool Categories (Pick Providers)

Tools are organized by **category**, not by provider. The agent talks to "calendar" not "Google Calendar." Swapping providers changes the underlying CLI tool but not the agent's behavior.

| Category | Providers | Interface | Auth |
|---|---|---|---|
| **Email** | Gmail, iCloud, Outlook, Fastmail, ProtonMail | `email inbox`, `email send`, `email search` | IMAP/SMTP creds or OAuth |
| **Calendar** | Google Calendar, iCloud, Outlook, Fastmail | `calendar today`, `calendar create`, `calendar list` | CalDAV or OAuth |
| **Tasks** | Todoist, TickTick, Linear, Notion, Apple Reminders | `tasks list`, `tasks add`, `tasks complete` | API key or OAuth |
| **Messaging** | Telegram, WhatsApp, Slack, Discord | (channel config, not a tool) | Bot token |
| **Files** | Google Drive, Dropbox, iCloud Drive | `files list`, `files get`, `files upload` | OAuth |
| **Code** | GitHub, GitLab | `code repos`, `code issues`, `code prs` | PAT or OAuth |
| **Finance** | Yahoo Finance, Alpha Vantage | `quote AAPL`, `quote --watch` | None or API key |
| **Research** | Tavily, Perplexity | `research <query>`, `research --deep` | API key |
| **Notes** | Notion, Obsidian (local) | `notes search`, `notes create` | API key or local path |
| **Health** | Apple Health export, manual entry | `health log`, `health summary` | Local file |

**Each integration has:**
- **Manifest**: name, version, category, auth schema, config fields
- **Standard interface**: category-level commands that work regardless of provider
- **Health check**: periodic probe (hourly)
- **Credential lifecycle**: creation date, estimated expiry, renewal guidance
- **Fallback**: on failure → "Calendar unreachable, using cached data from 1h ago"
- **Version pinning**: locked version, upgrade notifications

**Provider swaps are seamless:**
```bash
clawops tools calendar switch --from icloud --to google
# → Migrates calendar config
# → Updates auth credentials
# → Agent behavior unchanged (still uses `calendar today`)
```

### The Questionnaire (Revised)

Three phases matching the three layers:

**Phase 1: Basics + Core** (auto-configured, minimal input)
```
What's your name?             → USER.md
What timezone?                → Cron schedules, waking hours
Waking hours? (e.g. 6am-11pm)→ Quiet hours, heartbeat bounds
Daily briefing time?          → morning-brief cron
```

**Phase 2: Personality** (choose + customize)
```
Pick a personality:
  [1] Guardian — proactive, direct, holds you accountable
  [2] Assistant — professional, efficient, handles routine
  [3] Coach — encouraging, tracks goals, celebrates progress
  [4] Analyst — thorough, research-focused, data-driven
  [5] Companion — warm, conversational, emotionally aware
  [6] Custom — build your own

Customize:
  Autonomy level?  [Ask first] [Handle routine] [Full auto]
  Anything it should NEVER do? (free text → hard stops)
  Any context it should know? (health, work, family — optional)
```

**Phase 3: Tools** (pick providers per category)
```
Email?      [Gmail] [iCloud] [Outlook] [Skip]
Calendar?   [Google] [iCloud] [Outlook] [Skip]
Tasks?      [Todoist] [TickTick] [Linear] [Skip]
Messaging?  [Telegram] [WhatsApp] [Slack] [Discord]
Code?       [GitHub] [GitLab] [Skip]
Finance?    [Yes — stock quotes] [Skip]
Research?   [Tavily] [Perplexity] [Skip]

For each enabled:
  → Guided credential setup
  → Health check verification
  → Stored in .env (never in config)
```

---

## 6. Guardrail System (Ongoing Management)

The engine doesn't stop at deploy. It keeps the agent healthy.

### 6.1 Identity Governance

**How it works:**
- Identity defined as structured YAML (source of truth, validated against schema)
- YAML auto-generates markdown for LLM consumption (SOUL.md, USER.md, AGENTS.md)
- Generated markdown is mounted **read-only** — agent cannot modify its own identity
- Token budget enforced: SOUL ≤ 2K tokens, USER ≤ 2.5K, AGENTS ≤ 3.5K
- Every change versioned with diff, timestamp
- Health data tagged with `source_date` and `refresh_by` — system alerts when stale (>6 months)
- Cross-file contradiction detection on every edit

**User experience:**
```bash
clawops evolve           # Re-run personality/context sections of questionnaire
                      # Shows diff: "SOUL.md: changed tone from 'warm' to 'direct'"
                      # Requires confirmation before applying

clawops doctor identity  # Check for issues:
                      # "⚠ Health data is 8 months old (refresh recommended)"
                      # "⚠ SOUL.md approaching token budget (1,850/2,000)"
                      # "✓ No contradictions detected across identity files"
```

### 6.2 Memory Lifecycle

**How it works:**
```
Hot  (≤7 days)  → Loaded into context. Size cap: 50KB.
Warm (7-90 days) → Indexed, searchable, NOT loaded. Weekly summaries auto-generated.
Cold (90+ days)  → Compressed, archived. Monthly summaries.
Permanent        → User-promoted facts. Structured, versioned. Cap: 100KB.
```

- Hot → warm: automatic after 7 days. Daily logs compressed to weekly summary.
- Warm → cold: automatic after 90 days. Weekly summaries compressed to monthly.
- PII masking: API keys, passwords, health metrics scrubbed before writing.
- Full-text search index (SQLite FTS5) over all tiers.
- Deduplication: detect repeated facts across tiers, consolidate.

**User experience:**
```bash
clawops doctor memory    # "Memory: 45KB hot, 120KB warm, 0 cold"
                      # "⚠ 3 daily logs approaching hot→warm transition"
                      # "✓ Search index up to date (847 entries)"

clawops memory search "email setup"  # Search across all tiers
```

### 6.3 Cron Guardrails

| Guardrail | What It Does |
|---|---|
| **Exclusive locking** | One agent turn at a time. Jobs queue, don't overlap. |
| **Cost estimation** | Before enabling: "10-min Opus heartbeat ≈ $45/month" |
| **Circuit breaker** | 3 consecutive failures → auto-disable + alert |
| **Exponential backoff** | Failed jobs retry at 1x, 2x, 4x intervals |
| **Quiet hours** | No jobs during user's sleep hours |
| **Timezone-aware** | User sets timezone once. DST handled automatically. |
| **Delivery fallback** | Telegram down → try email. Both down → queue for later. |
| **Budget cap** | Daily/monthly API spend limit. Agent paused when exceeded. |

### 6.4 Integration Health

| Feature | What It Does |
|---|---|
| **Health checks** | Hourly probe per integration. `todoist projects` → 200 OK? |
| **Status** | Healthy / degraded / failed / expired |
| **Credential alerts** | Track creation date, estimate expiry, alert 7 days before |
| **Fallback** | On failure: "Calendar unreachable, using cached data from 1h ago" |
| **Version pinning** | Lock tool version. Alert when upgrade available. |

**User experience:**
```bash
clawops status           # Agent: running (uptime: 14d 3h)
                      # Integrations: ✓ Todoist ✓ Calendar ⚠ Email (credential expires in 5d)
                      # Memory: 42KB hot, 98KB warm
                      # Cost: $12.40 this month (budget: $50)
                      # Cron: 4 active, 0 failing
```

### 6.5 Security (Default, Not Opt-In)

**Always-on (non-negotiable):**
- Container: cap_drop ALL, read_only rootfs, no-new-privileges, tmpfs /tmp, non-root user
- Network: egress firewall (DNS + HTTPS only), ICC disabled
- Secrets: env var injection only (never in config files)
- Identity: read-only mount (agent can't modify own personality)
- Audit: every tool execution logged

**User-configurable (safe defaults):**
- Autonomy level (which actions require approval)
- Filesystem scope (explicit path allowlist)

---

## 7. Architecture

### For OSS (CLI Tool)

```bash
# Install
curl -fsSL https://get.clawops.dev | sh

# Setup (interactive questionnaire)
clawops init
# → Use case selection
# → Identity questions
# → System discovery
# → Context (optional)
# → Credential setup
# → Generates config bundle in ./clawops/

# Deploy
clawops build    # Build OpenClaw image (two-stage, from source)
clawops up       # docker compose up with hardened config
clawops connect  # Guide for connecting messaging channel

# Operate
clawops status   # Health dashboard (CLI)
clawops doctor   # Diagnose issues (identity, memory, integrations, cost)
clawops evolve   # Update profile (re-run questionnaire sections)
clawops update   # Update OpenClaw (compatibility check + rollback)
clawops backup   # Snapshot workspace (encrypted)
clawops logs     # Stream agent logs
```

**What `clawops init` produces:**
```
./clawops/
├── openclaw.json          # Generated, all landmines handled
├── docker-compose.yml     # Hardened (cap_drop, read_only, etc.)
├── .env                   # Secrets (gitignored)
├── firewall.sh            # Egress rules (DNS + HTTPS only)
├── workspace/
│   ├── SOUL.md            # Generated from template + answers
│   ├── USER.md            # Generated from answers
│   ├── AGENTS.md          # Generated from template + autonomy level
│   ├── HEARTBEAT.md       # Generated from template + schedule
│   ├── TOOLS.md           # Generated from enabled integrations
│   ├── MEMORY.md          # Empty (initialized)
│   ├── memory/            # Empty (initialized)
│   ├── todoist            # If Todoist enabled
│   ├── todoist-sync       # If Todoist enabled
│   ├── ical               # If iCloud Calendar enabled
│   ├── tavily             # If Tavily enabled
│   ├── quote              # If finance enabled
│   └── skills/
│       └── morning-brief/ # Pre-installed
└── cron/
    └── jobs.json          # Generated from template + schedule
```

### For Managed Service (ClawOps Managed)

Same engine, we handle infrastructure + monitoring + support:

```
┌────────────────────────────────────────────┐
│          ClawOps Console (web app)         │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │ Question-│ │  Config  │ │ Dashboard │  │
│  │ naire UI │ │ Generator│ │ (status,  │  │
│  │ (wizard) │ │ (engine) │ │ logs, etc)│  │
│  └──────────┘ └──────────┘ └───────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │ Fleet    │ │ Billing  │ │ Support   │  │
│  │ View     │ │ (Stripe) │ │ Tools     │  │
│  └──────────┘ └──────────┘ └───────────┘  │
│           WebSocket Hub                     │
└────────────────┬───────────────────────────┘
                 │
      ┌──────────┴──────────┐
      ▼                     ▼
┌───────────┐        ┌───────────┐
│ Node 1    │        │ Node N    │
│ agentd    │        │ agentd    │
│ OpenClaw  │        │ OpenClaw  │
│ Profile   │        │ Profile   │
│ Guardrails│        │ Guardrails│
└───────────┘        └───────────┘
```

**agentd** (Go binary on each node): receives config from the console, manages Docker lifecycle, applies security, runs health checks, streams status back, executes memory lifecycle jobs, handles backups.

---

## 8. Business Model

### Pricing

| Mode | What You Get | Price |
|---|---|---|
| **OSS** | Full engine (CLI), all templates, all guardrails | Free |
| **Managed** | We deploy, manage, and support your agent | $29-199/mo |
| **Premium OSS** | OSS + hosted dashboard + managed updates | $19/mo |

### Managed Tiers

| Tier | Price | Default Model | Integrations | Target |
|---|---|---|---|---|
| Starter | $29/mo | Haiku (or BYOK) | 3 | Non-technical individuals |
| Pro | $79/mo | Sonnet (or BYOK) | Unlimited | Technical/lazy, consultants |
| Max | $199/mo | Opus (or BYOK) | Unlimited + custom | Power users, small business |

### Unit Economics

- Compute: ~$6/mo per agent (Hetzner CX22: 2 vCPU, 4GB RAM, 40GB disk)
- LLM: $0 (user's API key or subscription — never in our cost chain)
- **COGS: ~$7/mo**
- **Gross margin at Starter: ~76%**
- **Gross margin at Pro: ~91%**

### Open Source Strategy

| Open Source | Proprietary |
|---|---|
| Engine (questionnaire, templates, config generation) | ClawOps console (fleet dashboard) |
| Guardrail system (identity, memory, cron, health) | Managed hosting infrastructure (the nodes) |
| agentd binary | Support tools |
| Profile format spec | Billing system |
| CLI tool | Premium templates |

---

## 9. Competitive Positioning

### The Landscape (Early 2026)

The AI agent market is extremely crowded (~120+ companies) but segmented:

| Segment | Players | What They Solve |
|---|---|---|
| **Consumer chat** | ChatGPT, Claude, Gemini | Stateless conversation |
| **No-code agents** | Lindy, Relevance AI, Cofounder | Workflow automation |
| **Enterprise agents** | Dust, Microsoft Foundry | Team knowledge + process |
| **Agent frameworks** | OpenClaw, LangGraph, CrewAI, AutoGen | Building blocks for developers |
| **Managed hosting** | HostedClaws, xCloud, Clawbot AI | Deploy OpenClaw in 5 min |

### Where We Sit

None of these do **configuration intelligence + personalization + operational guardrails**. We sit between "agent framework" (too hard) and "managed hosting" (too shallow):

```
Too hard ←──────────────────────────────────→ Too shallow
OpenClaw     CLAWOPS           HostedClaws    ChatGPT
(framework)  (configured,      (hosted,       (chat)
              personalized,     default
              operated)         config)
```

### The Moat (ordered by defensibility)

1. **Configuration intelligence** — 14 encoded landmines, template system, auto-hardening. Competitors would need months of trial-and-error to discover these. Or they'd read our code (OSS) but still lack the operational context.

2. **Guardrail system** — Identity governance, memory lifecycle, cron safety, integration health. This is the ongoing value that prevents churn. Hosting is commodity; keeping an agent healthy over months is not.

3. **Questionnaire → personalization pipeline** — The 60% of config that's personalized (from our analysis: 40% universal, 60% personalized across ~13,500 tokens). The templates and questionnaire design encode product decisions about what makes a good agent.

4. **Operational encoding** — The scripts, the fix-after-onboard logic, the firewall rules, the permission management. Invisible but essential. Without it, agents degrade silently.

---

## 10. Critical Challenges (The Actual Hard Problems)

These aren't reasons not to build. They're the problems that whoever solves them owns the category. The ambiguity is the opportunity.

### Challenge 1: The Non-Technical Paradox
Non-technical users are the biggest market but can't use a CLI. Technical users can use a CLI but might just DIY it. The managed farm (web app) reaches non-technical users but takes months to build. **Resolution path**: Start with service (manually set up agents for people), learn what matters, then automate what you learned into the engine. The service IS the research for the product.

### Challenge 2: Questionnaire Depth vs. Agent Quality
A wizard that asks "any health conditions?" and accepts free text isn't dramatically better than writing USER.md by hand. The real magic in Clawdius isn't the file format — it's months of Simon iterating on what to tell the agent. A questionnaire produces a starting point, not a finished agent. **Resolution path**: The questionnaire is the floor, not the ceiling. The real value is `clawops evolve` — the ongoing refinement loop. First deployment is 70% good; it gets to 95% over weeks of use + iteration. The tool makes that iteration safe (guardrails prevent the 70% from degrading to 30%).

### Challenge 3: Template Quality at Scale
We deeply understand ONE template (Personal Guardian = Clawdius). The other 6 are ideas, not designs. Shipping 7 mediocre templates is worse than shipping 1 great one. **Resolution path**: Ship Guardian only in MVP. Each subsequent template requires the same depth of real-world testing that Clawdius got. Templates are the ongoing product, not a launch feature. They're earned through deployment experience.

### Challenge 4: Invisible Guardrail Value
Memory lifecycle, integration health, contradiction detection — users only notice when things DON'T break. Hard to market invisible value. **Resolution path**: Make the value visible. `clawops doctor` doesn't just prevent problems — it surfaces what WOULD have gone wrong. "Your SOUL.md was 47 tokens from silent truncation. Compressed." "Your Todoist API key expires in 3 days." The diagnostic output IS the marketing. Screenshots of `clawops doctor` catching real problems sell the product.

### Challenge 5: OpenClaw Dependency
No relationship with the project. HostedClaws/xCloud already in the ecosystem. Config schema could change. **Resolution path**: Build the engine as a config-generation layer that's useful regardless of runtime. The questionnaire, templates, guardrails, and operational scripts have value independent of OpenClaw's specific config format. If we need to support a different runtime later, the engine adapts — the config generator is the only part that's OpenClaw-specific.

### Challenge 6: Is This a Product or a Service?
Setting up a truly personalized agent requires depth that software alone can't provide. **Resolution path**: Both. The service (we set up your agent) generates revenue and learning. The product (the engine) codifies what we learn. The service becomes more efficient as the product improves. Eventually the product is good enough that the service becomes optional. This is the classic productized service → product transition.

### Challenge 7: Pricing vs. ChatGPT
$29/mo vs ChatGPT Plus at $20/mo. Why pay more? **Resolution path**: The value proposition isn't "better chat" — it's "works while you sleep." ChatGPT waits for you. This agent checks your email, monitors your tasks, watches your portfolio, reminds you about your health, and sends you a morning briefing — all before you open your phone. That's a personal assistant, not a chatbot. Personal assistants cost $2-5K/mo. $29/mo for an AI version is cheap.

### Challenge 8: The KAHU Philosophy Ceiling
Buddhist principles, health accountability, "no sacred cows" — deeply personal to Simon. **Resolution path**: KAHU is the design philosophy, not the user-facing brand. It informs how we build (security-first, identity governance, pattern recognition) without requiring users to share the philosophy. The templates express different relationship dynamics — Guardian is KAHU-flavored, but Assistant and Developer Ally are not.

---

## 11. Achievable Plan

### The Strategy: Service → Product

Don't build the product first. Build the service. The service IS the research.

**Phase 0: Concierge Service** (weeks 1-4)
- Manually set up 3-5 agents for real people Simon knows
- Use Simon's system as the template — adapt SOUL.md, USER.md, etc. by hand for each person
- Deploy on Hetzner VMs (manually, using Simon's scripts)
- Observe: What do they actually use? What confuses them? What breaks? What do they ask for?
- Document every friction point — these become engine requirements
- Charge nothing or a token amount — the learning is the value
- **This is the cheapest possible validation.** If people don't use a hand-crafted agent, they won't use a wizard-generated one.

**Phase 1: The Engine (CLI)** (weeks 5-10)
- Automate what was done manually in Phase 0
- `clawops init` — interactive questionnaire (informed by real onboarding conversations)
- 1 template only: Personal Guardian (the only one we deeply understand)
- Config generator: questionnaire → all 11+ files, all 14 landmines handled
- `clawops up` — deploy with hardened defaults
- `clawops status` — basic health check
- `clawops doctor` — surfaces what WOULD have gone wrong (the marketing screenshot)
- 3 integrations: Todoist, Google Calendar, Gmail
- morning-brief skill pre-installed
- Firewall auto-applied
- **Success criteria**: A technical friend can go from zero to working agent in 30 minutes

**Phase 2: Guardrails** (weeks 11-16)
- Memory lifecycle (hot/warm/cold transitions, auto-summarization)
- Cron guardrails (exclusive locking, circuit breaker, cost estimation)
- Integration health checks (hourly probes, credential expiry, fallback)
- Identity governance (token budgets, staleness alerts)
- `clawops evolve` — update profile via questionnaire re-run
- `clawops update` — safe OpenClaw updates with compatibility check
- `clawops backup` — encrypted workspace snapshots
- 2nd template (Business Assistant or Developer Ally — whichever Phase 0 users wanted most)
- **Success criteria**: An agent runs for 30+ days without silent degradation

**Phase 3: ClawOps Managed** (weeks 17-24)
- agentd (Go binary on each node)
- ClawOps console (web app): questionnaire UI, dashboard, fleet view
- VM provisioning (Hetzner API + cloud-init)
- Billing (Stripe)
- Now non-technical users can be served — they never see the console, just the agent
- **Success criteria**: A non-technical person has a working agent without touching a terminal

**Phase 4: Growth** (ongoing)
- More templates (earned through deployment experience, not designed in advance)
- More integrations
- Skill library
- Profile export/import
- WhatsApp/Slack channels
- Community templates
- Local LLM option

---

## 12. Reference: Simon's System → Product

| Source (home-server repo) | Adapts To |
|---|---|
| `openclaw/workspace/SOUL.md` (80 lines, 850 tokens) | "Guardian" template personality |
| `openclaw/workspace/USER.md` (94 lines, 1,200 tokens) | User profile questionnaire structure |
| `openclaw/workspace/AGENTS.md` (150 lines, 1,600 tokens) | Operational rules presets |
| `openclaw/workspace/HEARTBEAT.md` (72 lines, 900 tokens) | Heartbeat schedule presets |
| `openclaw/workspace/TOOLS.md` (84 lines, 1,000 tokens) | Integration manifest template |
| `openclaw/workspace/MEMORY.md` (62 lines) | Permanent memory tier model |
| `openclaw/workspace/todoist` (186 LOC) | Todoist integration |
| `openclaw/workspace/todoist-sync` (234 LOC) | Task polling integration |
| `openclaw/workspace/quote` (278 LOC) | Finance integration |
| `openclaw/workspace/ical` (406 LOC) | Calendar integration |
| `openclaw/workspace/tavily` (91 LOC) | Web research integration |
| `openclaw/workspace/skills/morning-brief/` (111+31 LOC) | First pre-installed skill |
| `openclaw/openclaw.json.example` (128 lines) | Config generator landmine database |
| `openclaw/docker-compose.yml` (121 lines) | Deployment manifest template |
| `openclaw/.env.example` (40 lines) | Secret injection template |
| `openclaw/Dockerfile` (97 lines) | Custom image build template |
| `scripts/setup-openclaw-firewall.sh` | Firewall module |
| `scripts/backup-openclaw-workspace.sh` | Backup module |
| `scripts/fix-openclaw-config.sh` | Post-onboard config restoration |
| `scripts/fix-openclaw-perms.sh` | Permissions module |
| `scripts/scan-clawdius-repos.sh` | PII scanning feature |
| `CLAUDE.md` (30+ hard-won lessons) | Config generator rules |
| `cron/jobs.json` (158 lines) | Cron template + guardrail test cases |

### OpenClaw Internals to Know

| Constant | Value | Why It Matters |
|---|---|---|
| `bootstrapMaxChars` | 20,000 | Per-file truncation threshold (silent!) |
| `bootstrapTotalMaxChars` | 150,000 | Total truncation threshold |
| `DEFAULT_JOB_TIMEOUT_MS` | 600,000 (10 min) | Generic job timeout |
| `AGENT_TURN_SAFETY_TIMEOUT_MS` | 3,600,000 (60 min) | Agent turn timeout |

---

## 13. Open Questions

1. **Product name** — **ClawOps**. SRE for OpenClaw agents. KAHU is the design philosophy. Runtime-neutral rebrand possible later if needed.
2. **Phase 0 candidates** — Who are the 3-5 people for the concierge service? What are their use cases? (This determines the first template's real-world test.)
3. **KAHU manifesto** — Publish the philosophy as thought leadership? Define the category before anyone else does?
4. **Relationship with OpenClaw** — Inform them? Partner? They might want guardrails upstream.
5. **Where to build** — New repo? New GitHub org? Language (Go / TypeScript / Python)?
6. **30-second pitch** — Not solved yet. Needs work.
7. **The identity question** — Is this Simon's company? Or does it need co-founders? The service model is one-person friendly. The product model might not be.
