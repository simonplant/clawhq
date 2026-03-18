# ClawHQ Architecture

> Architecture for ClawHQ — WordPress for AI agents.

**Status:** Active Development · **Updated:** 2026-03-17

---

## The Model

OpenClaw is a powerful engine with its own control panel (the Gateway UI). That's cPanel — fine for basic management. ClawHQ is WordPress — the template engine that makes the agent do something specific and valuable.

Everything in OpenClaw is either a file or an API call. ClawHQ controls all of it programmatically — identity, tools, skills, cron, integrations, security, autonomy, memory, model routing — through use-case templates that configure a complete agent for a specific job.

### Three Layers

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 3: Cloud Service (the business)                       │
│  Managed hosting · Remote monitoring · Template marketplace  │
├─────────────────────────────────────────────────────────────┤
│  LAYER 2: Template Engine (the product)                      │
│  Use-case templates: hundreds of recipes.                    │
│  During setup, ClawHQ "cooks" ~10 personalized for the user:│
│  asks preferences, connects services, validates credentials, │
│  generates all config, tools, skills, identity, cron.        │
│  The agent is purpose-built for a specific job.              │
├─────────────────────────────────────────────────────────────┤
│  LAYER 1: Distro (table stakes)                              │
│  Install · Harden · Launch · Ops · Update                    │
│  Acquire engine, secure it, keep it alive.                   │
│  Same for every agent.                                       │
└─────────────────────────────────────────────────────────────┘
```

### Design Principles

- **ClawHQ is the install.** Users don't install OpenClaw separately. ClawHQ acquires, configures, and manages the engine.
- **Templates are recipes, not config files.** ClawHQ has hundreds of recipes and cooks ~10 personalized for the user during setup — asking preferences, connecting services, generating everything.
- **OpenClaw's Gateway UI is fine for basic management.** ClawHQ doesn't compete with it. It sits on top and makes the engine do something specific.
- **Everything is programmatic.** Every aspect of OpenClaw is a file or API call. ClawHQ controls all of it — no manual config editing required.
- **Tight coupling to OpenClaw.** No abstraction layer. We use OpenClaw's TypeBox config schema, WebSocket RPC, file paths, and container structure directly.
- **TypeScript throughout.** Shares types with OpenClaw. Validates against the actual schema.
- **Security is the baseline.** Hardening happens automatically, not as an opt-in feature.

---

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│  Tier 3: ClawHQ Cloud                                   │
│  Managed hosting · Remote health · Template marketplace │
│  ─── optional — product works without this ───          │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS (health status only)
┌────────────────────────┴────────────────────────────────┐
│  Tier 2: ClawHQ Local (THE PRODUCT)                     │
│  Template engine + distro + ops tooling.                │
│  Recipes → personalized config → running agent.         │
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

## Layer 2: The Template Engine

This is the product. Everything else is infrastructure.

### Templates Are Recipes

ClawHQ maintains a library of hundreds of recipes — complete operational profiles for specific use cases. During setup, ClawHQ "cooks" a personalized configuration:

1. **User describes what they want** — "manage my email," "help with stock trading," "plan meals for my family"
2. **ClawHQ selects and personalizes recipes** — asks preferences, dietary restrictions, risk tolerance, communication style
3. **Credentials connected and validated** — each integration tested live before proceeding
4. **Everything generated** — config, identity, tools, skills, cron, security, egress rules
5. **Agent launches purpose-built** — not a generic agent with a personality swap, but a fully configured system designed for a specific job

### What a Template Controls

Every dimension of OpenClaw, configured programmatically:

| Dimension | What Gets Generated | Example: "Assist Stock Trading" |
|---|---|---|
| **Identity** | SOUL.md, AGENTS.md, IDENTITY.md, personality, boundaries | Analytical, data-driven, conservative risk warnings |
| **Tools** | CLI wrappers installed to workspace | `quote` (market data), `web-search` (research), `tasks` (trade log) |
| **Skills** | Autonomous capability scripts | market-scan, portfolio-alert, research-digest |
| **Cron** | Scheduled jobs in OpenClaw-native format | Pre-market scan at 6am, portfolio check every hour during market |
| **Integrations** | Service connections + credential validation | Yahoo Finance, Tavily research, email for alerts |
| **Security** | Posture, egress firewall, sandbox | Hardened, egress to finance APIs + email only |
| **Autonomy** | What agent does alone vs. asks permission | Auto-monitor, auto-alert; flag before any trade suggestion |
| **Memory** | Retention policy, tier configuration | Remember positions, preferences, market patterns |
| **Models** | Local vs. cloud routing per task type | Local for monitoring, cloud for deep research synthesis |
| **Egress** | Domain allowlist for firewall | finance APIs + research API + email server, nothing else |

### Template Examples

| Template | Use Case | Key Tools | Key Skills | Cron |
|---|---|---|---|---|
| **Email Manager** | Inbox zero, triage, auto-reply | email, calendar, tasks | email-digest, morning-brief, auto-reply | Inbox check 15min, daily digest 8am |
| **Stock Trading Assist** | Market monitoring, research, alerts | quote, web-search, tasks | market-scan, portfolio-alert, research-digest | Pre-market 6am, hourly during market |
| **Meal Planner** | Nutrition, recipes, shopping | web-search, tasks, calendar | meal-plan, shopping-list, nutrition-track | Weekly meal plan Sun 6pm, daily prep |
| **AI Blog Maintainer** | Research, write, publish | web-search, tasks | research-digest, draft-post, publish-review | Daily research, weekly draft, review queue |
| **Replace Google Asst** | Full daily orchestration | email, calendar, tasks, web-search | morning-brief, email-digest, schedule-guard | Morning 7am, heartbeat 10min, evening summary |
| **Replace ChatGPT Plus** | Research + writing partner | web-search, tasks | deep-research, writing-assist, construct | On-demand, daily construct |
| **Family Hub** | Shared calendar, chores, meals | calendar, tasks, web-search | meal-plan, chore-assign, family-brief | Daily brief, weekly meal plan, chore rotation |
| **Founder's Ops** | Inbox zero, investor updates, hiring | email, calendar, tasks, web-search | email-digest, investor-update, hiring-pipeline | Morning triage, weekly investor prep |

### What Gets Generated

Since everything in OpenClaw is a file or API call, ClawHQ generates all of it:

```
Template recipe + user preferences + credentials
        ↓
    generate(answers: WizardAnswers)
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
│                          populated from template          │
│   tools/               ← CLI wrappers generated from     │
│                          integrations (bash/python3)      │
│   skills/              ← skill scripts from template      │
│   memory/              ← hot/warm/cold skeleton           │
│                                                          │
│ cron/                                                    │
│   jobs.json            ← scheduled jobs, OpenClaw-native  │
│                          format, cron syntax validated    │
│                                                          │
│ security/                                                │
│   posture.yaml         ← standard/hardened/paranoid       │
│ ops/firewall/                                            │
│   allowlist.yaml       ← per-integration domain allowlist │
└─────────────────────────────────────────────────────────┘
```

### The 14 Landmine Rules

Every generated config passes 14 validation rules that prevent silent failures:

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

See `docs/OPENCLAW-REFERENCE.md` for full details on each rule.

---

## Layer 1: The Distro

Table stakes. Same for every agent. Handles the lifecycle that OpenClaw doesn't.

### Install Phases

```
Install → Configure → Harden → Tools → Skills → Ops → Launch → Cloud
   ↓         ↓          ↓        ↓       ↓       ↓       ↓        ↓
Engine    Recipes     Security  Agent's  Agent's  Prod    Running  Remote
acquired  cooked    baseline   hands    brain    grade   agent    monitor
```

**Phase 1: Install** — Pre-reqs, engine acquisition (trusted cache or from source), distro directory.

**Phase 2: Configure** — Template selection, preferences, integrations, credentials validated live, bundle generated.

**Phase 3: Harden** — Container lockdown, sandbox, credentials secured, egress firewall, identity read-only, 14 landmines verified.

**Phase 4: Tools** — CLI wrappers generated from integrations, binary deps added to Dockerfile, TOOLS.md auto-populated.

**Phase 5: Skills** — Autonomous capabilities installed from template, cron entries created, dependencies validated.

**Phase 6: Ops** — Monitor, alerting, backup (first snapshot), updater, audit logging, doctor (full pass).

**Phase 7: Launch** — `docker compose up`, firewall applied, health polled, smoke test, channel connected.

**Phase 8: Cloud** — Optional: health heartbeat, remote dashboard, security advisories, fleet view.

Each phase produces a working state. The user gets value at every checkpoint.

### Engine Acquisition

Two paths — user chooses their trust level:

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

- Message routing (channel → session → agent dispatch)
- Model API calls (selection, failover, streaming)
- Tool execution (dispatch + sandboxing)
- Session persistence
- Channel protocol handling
- Config schema validation (Gateway is the final authority)
- **The Gateway UI** — basic management panel. Let it be cPanel.

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

Same distro. Same templates. Same security. Different host.

| Option | Who Manages Host | Cost |
|---|---|---|
| User's PC (Linux, macOS, WSL) | User | $0 + compute |
| Mac Mini (home server) | User | $0 + hardware |
| DigitalOcean / Hetzner / Vultr | ClawHQ managed | VPS + managed fee |
| Any VPS | User | VPS cost |

### Managed Mode

The same distro with an `agentd` daemon:

```
┌────────────────────────────────┐
│    ClawHQ Console (web)        │
│  Dashboard · Fleet · Support   │
└──────────┬─────────────────────┘
           │ HTTPS
    ┌──────┴──────┐
    ▼             ▼
┌────────┐  ┌────────┐
│ agentd │  │ agentd │
│ ClawHQ │  │ ClawHQ │
│ distro │  │ distro │
└────────┘  └────────┘
```

`agentd` receives config from the console, runs the same phases, streams health metadata back. The console never sees agent content — only operational status.

### Operational Boundary (Managed)

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
              │  Gateway UI (cPanel)   │
              └────────────────────────┘
                        │
            WebSocket RPC│  Filesystem
                        ▼
              ┌─── ClawHQ (WordPress) ─┐
              │  Template Engine ·     │
              │  Monitor · Doctor ·    │
              │  Audit · Firewall      │
              └────────────────────────┘
                        │ (optional)
              HTTPS (health│only)
                        ▼
              ┌─── ClawHQ Cloud ───────┐
              │  Managed hosting ·     │
              │  Marketplace · Fleet   │
              └────────────────────────┘
```

---

## The Distro Directory

```
~/.clawhq/
├── clawhq.yaml                    # Meta-config (version, install method, cloud token)
│
├── engine/                        # OpenClaw runtime
│   ├── openclaw.json              # Runtime config (generated from template)
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
├── ops/                           # Operational tooling
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

## Package Structure

Organized by modules:

```
clawhq/
├── src/
│   ├── cli/                        # Commander.js CLI (thin layer over modules)
│   │
│   ├── smith/                      # ClawSmith — THE PRODUCT
│   │   ├── templates/              # Template engine
│   │   │   ├── registry.ts         # Template library (hundreds of recipes)
│   │   │   ├── loader.ts           # YAML template parsing + validation
│   │   │   ├── mapper.ts           # Template + preferences → config values
│   │   │   ├── personalizer.ts     # User preferences → template customization
│   │   │   └── builtin/            # Built-in template YAML files
│   │   ├── configure/              # Setup wizard
│   │   │   ├── wizard.ts           # Interactive questionnaire
│   │   │   ├── steps.ts            # Wizard steps
│   │   │   ├── generate.ts         # Answers → DeploymentBundle
│   │   │   └── writer.ts           # Atomic file writer
│   │   ├── tools/                  # CLI tool generators
│   │   │   ├── registry.ts         # Integration → tool mapping
│   │   │   └── *.ts                # Per-integration generators
│   │   └── identity/               # Identity file generators
│   │       ├── agents.ts           # AGENTS.md
│   │       ├── heartbeat.ts        # HEARTBEAT.md
│   │       ├── tools-doc.ts        # TOOLS.md
│   │       └── identity.ts         # IDENTITY.md
│   │
│   ├── ops/                        # ClawOps — keep it alive
│   │   ├── doctor/                 # Diagnostics + auto-fix
│   │   ├── monitor/                # Health monitoring daemon
│   │   ├── backup/                 # Encrypted backup/restore
│   │   ├── updater/                # Safe updates + rollback
│   │   ├── status/                 # Dashboard
│   │   └── logs/                   # Log streaming
│   │
│   ├── admin/                      # ClawAdmin — lock it down
│   │   ├── harden/                 # Container security overrides
│   │   ├── credentials/            # Credential store + health probes
│   │   ├── firewall/               # iptables CLAWHQ_FWD chain
│   │   ├── audit/                  # Audit logging (tool, secret, egress, cloud)
│   │   ├── scanner/                # PII + secret scanning
│   │   ├── sandbox/                # Tool execution sandbox
│   │   └── validate/               # 14 landmine rules
│   │
│   ├── construct/                  # ClawConstruct — grow it
│   │   ├── skills/                 # Skill install/update/remove lifecycle
│   │   │   ├── install.ts          # Lifecycle management
│   │   │   ├── vetting.ts          # Security vetting
│   │   │   └── builtin/            # Built-in skill implementations
│   │   ├── evolve/                 # Capability evolution
│   │   ├── rollback/               # Change rollback
│   │   └── lifecycle/              # Export + destroy
│   │       ├── export.ts           # Portable bundle
│   │       └── destroy.ts          # Verified destruction
│   │
│   ├── forge/                      # ClawForge — build it
│   │   ├── installer/              # Pre-reqs, engine acquisition, scaffold
│   │   ├── docker/                 # Two-stage build, compose, Dockerfile gen
│   │   └── launcher/               # Deploy orchestration (up/down/restart)
│   │
│   ├── cloud/                      # ClawHQ Cloud — the business
│   │   ├── agentd/                 # Managed mode daemon
│   │   ├── heartbeat/              # Health reporting
│   │   ├── commands/               # Command queue (pull, verify, execute)
│   │   └── fleet/                  # Multi-agent management
│   │
│   ├── gateway/                    # OpenClaw Gateway communication (cross-cutting)
│   │   ├── websocket.ts            # WebSocket RPC client
│   │   └── config-rpc.ts           # config.patch / config.apply
│   │
│   └── config/                     # Config types + schema (cross-cutting)
│       ├── schema.ts               # OpenClaw/ClawHQ types
│       └── loader.ts               # Load from distro directory
│
├── configs/templates/              # Built-in template YAML files
├── package.json
└── tsconfig.json
```

---

## Modules

ClawHQ is composed of six modules, each a distinct domain with clear boundaries:

| Module | Domain | What It Owns |
|---|---|---|
| **ClawSmith** | Forge personalized agents | Template engine, configuration, personalization, setup wizard. Hundreds of recipes, cook ~10 for the user. THE PRODUCT. |
| **ClawOps** | Keep it alive | Doctor, monitor, backup, update, status, logs, alerting. Day-2 through day-365. |
| **ClawAdmin** | Lock it down | Security posture, credentials, firewall, audit trail, permissions, sandbox. |
| **ClawConstruct** | Grow it | Skill install/update/remove, tool installation, self-improvement, evolution, rollback. Agent gets more capable over time. |
| **ClawForge** | Build it | Installer, pre-reqs, engine acquisition, Docker build, distro directory scaffold. |
| **ClawHQ (Cloud)** | The business | Managed hosting, remote monitoring, template marketplace, fleet management, agentd. |

Each module maps to a user question:

| Module | User Question |
|---|---|
| ClawSmith | "What should my agent do?" |
| ClawForge | "How do I get it running?" |
| ClawAdmin | "Is it secure?" |
| ClawOps | "Is it healthy?" |
| ClawConstruct | "Can it do more?" |
| ClawHQ Cloud | "Can someone else handle this for me?" |

**Composition:** ClawForge runs once → ClawSmith configures → ClawAdmin hardens → ClawOps monitors → ClawConstruct evolves → ClawHQ Cloud optionally wraps it all.

---

## Zero-Trust Remote Admin

The cloud component (ClawHQ) is where trust can be destroyed. "Your data never leaves your machine... except we have a remote admin channel." This must be designed so paranoid users can inspect every byte.

### Core Principle: The Agent Is Sovereign

The cloud service is a *guest* on the user's machine. The agent decides what to share, what commands to accept, and can revoke access instantly.

### Three Trust Modes

| Mode | Default For | Cloud Connection | Inbound Commands | Outbound Data |
|---|---|---|---|---|
| **Paranoid** | Self-managed | DISABLED | NONE | NONE |
| **Zero-Trust** | Managed | OUTBOUND ONLY (agent initiates) | SIGNED + USER-APPROVED | HEALTH STATUS ONLY |
| **Managed** | Managed (explicit opt-in) | OUTBOUND + WEBSOCKET | SIGNED + AUTO-APPROVED (ops only) | HEALTH + OPERATIONAL METADATA |

### Protocol Design

**Agent-initiated only.** The cloud never reaches in. No open ports, no SSH, no reverse tunnels. Even in managed mode, the WebSocket is agent-initiated.

**Command queue (pull, never push).** The cloud puts commands in a queue. The agent fetches on its schedule, verifies signature, inspects, then executes or rejects.

```
Cloud                          Agent
  │  POST /commands              │
  │  {restart, signed}           │
  │  ──────▶ queue ◀─────────── │  GET /commands (every 5min)
  │                              │  verify signature
  │                              │  check ALLOWED_COMMANDS
  │                              │  log to local audit
  │                              │  execute or reject
```

**Cryptographic command signing.** Every command signed with ClawHQ signing key. Agent verifies against pinned public key. User can inspect, pin, rotate, or reject the key.

### Command Classification

| Command | Paranoid | Zero-Trust | Managed |
|---|---|---|---|
| Health check ping | BLOCKED | ALLOWED | ALLOWED |
| Update available notify | BLOCKED | ALLOWED | ALLOWED |
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

The bottom five are **architecturally blocked** — not policy-blocked. The `agentd` daemon has no code path for these operations. You can't read conversations because there is no handler to read them, not because a permission flag says no.

### Local Audit Trail

Every cloud interaction logged locally in `ops/audit/cloud.jsonl`:

```bash
clawhq cloud audit              # Show all cloud interactions
clawhq cloud audit --outbound   # What did we send?
clawhq cloud audit --commands   # What did they ask us to do?
clawhq cloud inspect <cmd-id>   # Full detail on any command
```

### Kill Switch

```bash
clawhq cloud disconnect         # Immediate. No confirmation prompt.
```

Connection severed. Agent keeps running with full functionality. Only remote dashboard and push notifications lost.

---

## Tech Stack

| Component | Choice | Rationale |
|---|---|---|
| **Language** | TypeScript (strict, ESM) | Matches OpenClaw. Shares schema types. |
| **Runtime** | Node.js ≥20 | Same as OpenClaw. |
| **CLI** | commander ^14 | Lightweight, subcommand trees. |
| **Testing** | vitest ^4 | Fast, TypeScript-native. |
| **Distribution** | npm global | Target audience has Node.js. |

---

## Implementation Priority

1. **Template engine + configure + launch** — Recipes → running agent
2. **Distro installer + harden** — One command end-to-end
3. **Tools + skills** — Agent has hands and brain
4. **Ops** — Doctor, backup, status, updates
5. **Cloud service + managed hosting** — The business
6. **Template marketplace** — The ecosystem
