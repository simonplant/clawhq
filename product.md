# ClawOps — The Privacy-First Personal Agent Platform

**Date**: 2026-03-11
**Author**: Simon Plant + Claude Code (research & synthesis)
**Status**: Design / Pre-build
**Brand**: ClawOps — your agent, your data, your rules
**Philosophy**: Digital agents must be guardians, not manipulators — security-first, transparent, accountable, sovereign

---

## 1. Purpose

**One sentence**: The privacy-first alternative to big-tech AI agents — a platform to configure, deploy, and operate personal AI agents where your data stays yours.

**The big picture**: Google, Apple, Microsoft, and Anthropic will all ship personal AI agents. They'll be polished, deeply integrated, easy to set up. They'll also see every email you receive, every task you procrastinate on, every health condition you mention, every financial anxiety you express, every relationship you navigate — and they'll own that data forever. Your agent will know you more intimately than any app, any service, any person in your life. The question is: who else gets to see that?

**ClawOps is the Proton of personal agents.** Just as ProtonMail is the privacy-first alternative to Gmail, and ProtonVPN is the privacy-first alternative to trusting your ISP, ClawOps is the privacy-first alternative to trusting a big-tech platform with the most intimate AI relationship you'll ever have.

**The problem today**: The only open-source agent framework that works (OpenClaw) gives you everything and protects you from nothing. Configuration has ~30 surfaces with landmines. Identity files corrupt, bloat, and go stale. Operations require deep Linux/Docker expertise. Security is entirely opt-in. The result: only infrastructure experts can build a production agent. Everyone else is stuck choosing between big-tech surveillance agents or nothing.

**The solution**: ClawOps makes it possible to have a powerful, personalized, autonomous AI agent — without handing your most intimate data to a platform that monetizes it. We handle the hard parts (configuration, security, monitoring, memory management, ongoing operations) so you get the quality of a big-tech agent with the privacy of self-hosted infrastructure.

**Two modes, same engine:**
1. **ClawOps Managed** — We operate your agent on isolated infrastructure. We manage the container, not the contents. Even we can't see your data.
2. **ClawOps Self-Operated** — The same engine as an open-source CLI tool. You run it on your own hardware. Complete sovereignty.

---

## 2. Why Not Just Use What Exists?

### The Spectrum

| Option | Quality | Privacy | Effort | Your Data |
|---|---|---|---|---|
| **Big-tech agents** (Google, Apple, Microsoft) | High — deeply integrated | None — they see everything | Zero | Theirs |
| **ChatGPT / Claude** | Good — great models, bolted-on memory | Platform sees all conversations | Low | Platform's |
| **Lindy / Relevance AI** | Medium — workflow automation, not agents | SaaS — they process your data | Low | Theirs |
| **HostedClaws / xCloud** | Medium — hosting, no personalization | Hoster has access to your VM | Low | Hoster's |
| **Self-hosting OpenClaw** | High (if you survive setup) | Full — you control everything | Extreme | Yours |
| **ClawOps Managed** | High — hardened, personalized, monitored | **Sovereign — we can't see your data** | Low | **Yours** |
| **ClawOps Self-Operated** | High — same engine, you run it | Full — your hardware | Medium | **Yours** |

### The Gap

Today you choose between easy (big tech, no privacy) or private (self-host, months of expertise). Nobody offers **easy AND private** — a deeply personalized, operationally sound agent where even the service provider can't see your data.

That's the ClawOps gap.

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
| **Guardian** | Steward, protector | Direct, no sugarcoating | High — surfaces patterns, pushes back | Accountability, long-term health |
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

### Self-Operated (CLI Tool)

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

### Managed Service

Same engine — we handle infrastructure, monitoring, maintenance, and support:

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

## 8. Two Modes

### ClawOps Managed

We operate your agent. You never touch a terminal, config file, or Docker command.

| What We Handle | How |
|---|---|
| **Onboarding** | Web questionnaire → fully configured, deployed agent |
| **Infrastructure** | Provisioned VM, hardened container, egress firewall |
| **Monitoring** | 24/7 health checks, integration status, cost tracking |
| **Maintenance** | OpenClaw updates, security patches, credential rotation |
| **Memory** | Lifecycle management, auto-summarization, PII masking |
| **Evolution** | Personality updates, new integrations, life-change adaptation |
| **Support** | Diagnose issues, fix broken integrations, explain agent behavior |

LLM costs are always the user's (BYOK — bring your own API key or subscription). ClawOps never touches your LLM billing.

### ClawOps Self-Operated

Same engine, open-source CLI. You run everything — we just built the tools.

```bash
clawops init       # Questionnaire → config bundle
clawops up         # Deploy with hardened defaults
clawops status     # Health dashboard
clawops doctor     # Diagnose issues
clawops evolve     # Update personality/integrations
clawops export     # Portable profile bundle (take it anywhere)
```

### Open Source Strategy

| Open Source (Self-Operated) | Proprietary (Managed) |
|---|---|
| Engine (questionnaire, templates, config generation) | ClawOps console (fleet + customer dashboards) |
| Guardrail system (identity, memory, cron, health) | Managed infrastructure |
| agentd binary | Support tooling |
| Profile format spec + CLI tool | Billing |

The OSS tool builds community and trust. The managed service is the business.

---

## 9. Competitive Positioning

### The Real Competition

The real competitors aren't other OpenClaw tools. They're the big-tech agents that are coming — and the question is whether people will care about privacy enough to choose an alternative.

| Option | Experience | Privacy | Your Data |
|---|---|---|---|
| **Google Agent** (coming) | Seamless — integrated with Gmail, Calendar, Drive, Maps | None — Google sees everything, trains on it | Google's |
| **Apple Intelligence** (expanding) | Smooth — integrated with iCloud, Health, Messages | Better — on-device where possible | Apple's (mostly) |
| **Microsoft Copilot** (expanding) | Deep — integrated with Office, Teams, Outlook | Enterprise-controlled | Microsoft's |
| **Anthropic/OpenAI agents** (coming) | Powerful — best models, API-first | Platform-dependent | Platform's |
| **ClawOps** | Comparable — same models, open integrations | **Sovereign — even we can't see it** | **Yours** |

### The Proton Playbook

ProtonMail didn't beat Gmail on features. It beat Gmail on values — and built a $1B+ company doing it. The playbook:

1. **Lead with the value proposition, not the feature list.** "We can't read your email" > "We have 15GB of storage."
2. **Open source the engine.** Trust through transparency. ProtonMail's encryption is open source. ClawOps's engine is open source.
3. **Privacy is the premium, not a tax.** Proton users pay MORE because privacy has value, not despite it.
4. **The free tier builds the community.** Proton has free email. ClawOps has the free CLI tool.
5. **Swiss jurisdiction / data sovereignty isn't a feature — it's the brand.**

### Where We Sit

```
Big tech ←─────────────────────────────────→ DIY
Google       CLAWOPS           HostedClaws    OpenClaw
Agent        (sovereign,       (hosted,       (framework)
(integrated,  personalized,    default
surveilled)   operated)        config)
```

The big-tech agents will be easier. ClawOps will be **yours**.

### The Moat (ordered by defensibility)

1. **Data sovereignty architecture** — Not just a promise, but an engineering constraint. We literally cannot access your agent's workspace. This is ProtonMail's "we can't read your email" — the strongest possible trust signal.

2. **Operational expertise** — 14 encoded landmines, guardrail system, memory lifecycle, identity governance. The hard-won knowledge that makes an open-source agent actually work long-term. Big tech doesn't need this (they control the stack). OSS users desperately do.

3. **Open source trust** — The engine is open source. Anyone can audit it. You can verify our privacy claims. Big-tech agents are black boxes.

4. **Template ecosystem** — Community-built personality templates (like WordPress themes). Network effect: more templates → more users → more templates. Big tech offers one personality. We offer an ecosystem.

5. **Portability** — `clawops export` gives you everything. Take it to another provider, run it yourself. Big-tech agents lock you into their ecosystem. We're the anti-lock-in option.

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

### Challenge 7: Big-Tech Agents Will Be Better (At First)
Google's agent will be more integrated. Apple's will be smoother. Microsoft's will own the enterprise. Why choose ClawOps? **Resolution path**: The same reason people choose ProtonMail over Gmail. Gmail is better at features. ProtonMail is better at privacy. When the data in question is the most intimate profile of a human being ever assembled, "who can see this?" matters more than "is the UI slightly smoother?" ClawOps doesn't need to beat big tech on polish. It needs to be the credible, sovereign alternative for people who care about who owns their agent's knowledge.

### Challenge 8: The Guardian Philosophy
In an age of digital manipulation — dark patterns, engagement farming, data harvesting — a personal agent should be a guardian, not another vector of influence. This means: security by default (not opt-in), identity the user controls (not the agent), transparent operations (audit everything), and accountability (surface patterns, don't hide them). The risk is that this philosophy feels opinionated. **Resolution path**: The philosophy informs how we build (security-first, identity governance, pattern recognition) without requiring users to share it. The Guardian template embodies it most directly, but every template benefits from the engineering it produces — container hardening, read-only identity, memory lifecycle, cost transparency. Users who want a warm companion still get a secure one.

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

## 13. Data Sovereignty & Trust

This is not a feature. This is the reason ClawOps exists.

After 6 months, your agent holds the most intimate dataset about you that exists anywhere — health data, daily patterns, relationships, work stress, financial positions, emotional states, habits, weaknesses. Combined. In one place. More sensitive than your email, medical records, or bank account — because it's ALL of them, with behavioral patterns on top.

Google will offer a personal agent for free. It will be excellent. And it will feed the most intimate profile of you ever assembled into the same machine that serves you ads. Apple will offer one that's better on privacy — but still locked to their ecosystem, still their hardware, still their rules.

ClawOps exists because this data is too important to hand to any platform. The same way ProtonMail exists because email is too important to let Google read.

### Principles

| Principle | Implementation |
|---|---|
| **We can't see your data** | Agent runs on isolated VM. Workspace encrypted at rest. We manage the container, not the contents. |
| **Agent can't modify its own identity** | Identity files mounted read-only. The agent can't remove its own guardrails. |
| **You can leave anytime** | `clawops export` — portable bundle (config, identity, memory, tools). No lock-in. |
| **You can nuke anytime** | `clawops destroy` — wipes VM, all data, all backups. Cryptographic verification. |
| **Audit everything** | Every tool execution logged. You see exactly what your agent did, when, with what data. |

### What We Access (Managed Mode)

| We CAN see | We CANNOT see |
|---|---|
| Container health (up/down/restarts) | Agent conversations |
| Integration status (healthy/degraded/failed) | Email, task, calendar content |
| Memory tier sizes (45KB hot, 120KB warm) | Memory contents |
| API cost metrics | What the agent does with the calls |
| Cron job status (running/failed) | Cron job outputs |

Architecturally enforced, not policy-enforced.

---

## 14. Template Marketplace

Personality templates are like WordPress themes — they define how the agent looks, feels, and behaves, but the underlying engine is the same. This is where community and ecosystem value comes in.

### How Templates Work

A template is a bundle:
```yaml
# template.yaml
name: "Business Assistant"
version: "1.2.0"
author: "clawops-community"
category: "professional"
description: "Efficient email triage, calendar management, meeting prep"

personality:
  tone: measured
  style: "professional, concise, proactive on logistics"
  relationship: "executive assistant"

heartbeat:
  frequency: "10min"
  checks: [email, calendar, tasks]
  waking_hours: "7am-8pm"

integrations_required: [email, calendar, tasks]
integrations_optional: [code, research]

skills_included:
  - morning-brief
  - meeting-prep
  - email-digest

autonomy_default: "handle_routine"
```

### Template Lifecycle

1. **Built-in templates** — Ship with ClawOps. Deeply tested. Guardian is first.
2. **Community templates** — Open-source, contributed via PR. Reviewed for quality + safety.
3. **Premium templates** — Specialized (e.g., "Trading Copilot", "Health Coach"). May require specific integrations.
4. **Custom templates** — Users build their own via guided builder or YAML.

### The WordPress Analogy

WordPress won because of themes and plugins, not because the core CMS was best. The same dynamic could apply here:
- **Core engine** = WordPress core (ClawOps engine)
- **Templates** = WordPress themes (personality + default config)
- **Integrations** = WordPress plugins (tool providers)
- **Skills** = WordPress widgets (pre-built capabilities)

The community creates templates for use cases we'd never think of. A real estate agent template. A student template. A chronic illness management template. A day trader template. Each deeply tailored, each bringing in users we'd never reach directly.

### Quality and Safety

Templates have access to the user's integrations and personal context. Quality control matters:
- Templates can't override Layer 1 security (container hardening, egress firewall, read-only identity)
- Templates must declare required permissions (which tool categories, what autonomy level)
- Community templates go through review before listing
- User ratings and usage metrics visible
- Templates versioned — updates require user confirmation

---

## 15. Agent-to-Agent (Future Vision)

When 1,000 people run ClawOps agents, new possibilities emerge:

- Alice's agent schedules a meeting with Bob's agent (calendar negotiation)
- A family's agents coordinate grocery lists, pickups, meal planning
- A team's agents handle standup summaries, PR reviews, deployment notifications

This is where network effects kick in — and where lock-in becomes organic. Nobody leaves a platform where their agent has relationships with other agents.

**Not building this yet.** But the identity layer and communication architecture should be designed to support it from day one:
- Agents need discoverable identities (not just container IDs)
- Cross-agent communication needs a protocol (request/response, not just chat)
- Permission model: "Alice allows Bob's agent to see her calendar availability but not her task list"

This is Phase 5+ territory. Acknowledging it here because it changes design decisions now.

---

## 16. Open Questions

1. **Phase 0 candidates** — Who are the 3-5 people for the concierge service? What are their use cases?
2. **Jurisdiction** — Proton chose Switzerland for privacy laws. Where does ClawOps incorporate? Where do managed VMs live? This is a brand decision as much as a legal one.
3. **Encryption model** — Can we achieve true zero-knowledge (even we can't decrypt workspace at rest)? Or is "we don't look" the realistic starting point? What's the Proton-equivalent trust architecture?
4. **Relationship with OpenClaw** — Inform them? Partner? They might want guardrails upstream.
5. **Guardian manifesto** — Publish the philosophy (agents as guardians, not manipulators) as thought leadership? Frame the sovereignty narrative before big tech ships their agents.
6. **Template marketplace model** — How do community templates get reviewed and trusted? Quality gate vs. open marketplace?
7. **Agent-to-agent protocol** — When to start designing cross-agent coordination? What's the minimum network size?
8. **Pricing model** — TBD. Proton proved privacy is a premium, not a tax. Needs Phase 0 validation.
9. **Where to build** — New GitHub org? Language (Go / TypeScript / Python)?
