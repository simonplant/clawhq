# ClawHQ

**WordPress for AI agents.**

---

OpenClaw is the most powerful open-source framework for personal AI agents. It has its own control panel (the Gateway UI). It handles message routing, model calls, tool execution, sessions. It's a solid engine.

But it's a *generic* engine. Getting OpenClaw to actually do what you want — manage your email, assist with stock trading, plan meals, maintain a blog — means wrangling ~13,500 tokens of config across 11+ files, dodging 14 silent landmines, writing custom tools, composing identity files, setting up cron jobs, configuring integrations, tuning autonomy levels, and doing ongoing SRE work. Most deployments are abandoned within a month.

**ClawHQ is the intelligent configuration layer that turns a generic OpenClaw into a purpose-built agent for a specific job.** Everything in OpenClaw is either a file or an API call. ClawHQ controls all of it programmatically — identity, tools, skills, cron, integrations, security, autonomy, memory — through use-case templates that make the agent do exactly what the user wants.

OpenClaw's Gateway UI is cPanel. ClawHQ is WordPress.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 3: Cloud Service (the business)                       │
│  Managed hosting · Remote monitoring · Template marketplace  │
│  ─── optional — the product works without this ───           │
├─────────────────────────────────────────────────────────────┤
│  LAYER 2: Template Engine (the product)                      │
│  Use-case templates that programmatically configure          │
│  EVERYTHING in OpenClaw for a specific job:                  │
│                                                              │
│  "Run my emails"        → email tools, triage skills,        │
│                           morning digest, inbox zero cron    │
│  "Assist stock trading" → market data tools, research        │
│                           skills, alert cron, finance guard  │
│  "Plan meals"           → nutrition tools, recipe skills,    │
│                           shopping list cron, dietary prefs  │
│  "Maintain AI blog"     → research tools, writing skills,    │
│                           publish cron, editorial voice      │
│  "Replace Google Asst"  → email + calendar + tasks + brief   │
│                           + full-day orchestration           │
│                                                              │
│  Each template configures: identity, personality, tools,     │
│  skills, cron, integrations, security posture, autonomy      │
│  model, memory policy, model routing, egress rules           │
├─────────────────────────────────────────────────────────────┤
│  LAYER 1: Distro (table stakes)                              │
│  Install · Configure · Harden · Launch · Ops                 │
│  Same for every agent — acquire engine, secure it,           │
│  keep it alive, back it up, update it safely                 │
└─────────────────────────────────────────────────────────────┘
```

### Layer 1: The Distro

One command installs the whole stack. Each phase builds on the last.

```bash
# From trusted cache (default — signed, hash-verified)
curl -fsSL https://clawhq.com/install | sh

# Zero-trust (clone, audit, build from source)
git clone https://github.com/clawhq/clawhq && cd clawhq && ./install --from-source --verify
```

The installer handles pre-reqs (Docker, Node.js, Ollama), acquires OpenClaw (from trusted cache or source), creates the distro directory, and scaffolds everything. Security hardening is automatic — `cap_drop ALL`, read-only rootfs, non-root UID 1000, egress firewall, identity files read-only. No opt-in required.

```bash
clawhq doctor [--fix]      # Every known failure mode, with auto-fix
clawhq status [--watch]    # Single-pane health dashboard
clawhq backup create       # Encrypted snapshot
clawhq update [--check]    # Safe upstream upgrade with rollback
clawhq creds               # Credential health probes
clawhq audit               # Tool execution + egress audit trail
```

This layer is the same for every agent. Table stakes. The real value is Layer 2.

### Layer 2: The Template Engine

This is the product. Templates are full operational profiles that programmatically configure every dimension of OpenClaw for a specific job. Not prompt skins — complete agent configurations.

```bash
clawhq init --guided       # Interactive: pick a use case, connect services
clawhq init --smart        # AI-powered: describe what you want in plain language
```

A template controls:

| Dimension | What It Configures | Example: "Run My Emails" |
|---|---|---|
| **Identity** | SOUL.md, AGENTS.md, personality, boundaries | Professional, concise, protective of time |
| **Tools** | CLI wrappers generated and installed | `email` (himalaya), `calendar` (CalDAV) |
| **Skills** | Autonomous capabilities | email-digest, morning-brief, auto-reply |
| **Cron** | Scheduled jobs | Inbox check every 15min, daily digest at 8am |
| **Integrations** | Service connections + credentials | IMAP, SMTP, CalDAV — validated live |
| **Security** | Posture, firewall, sandbox | Hardened, egress to mail server only |
| **Autonomy** | What agent does alone vs. asks permission | Auto-triage, flag for approval before sending |
| **Memory** | Retention policy, tier sizes | Remember contacts and preferences, prune threads |
| **Models** | Local vs. cloud routing per task type | Local for triage, cloud for complex drafting |
| **Egress** | What data can leave the machine | Only mail server + calendar server |

Since everything in OpenClaw is a file or API call, ClawHQ generates all of it:

- `openclaw.json` — runtime config with all 14 landmines auto-handled
- `docker-compose.yml` — hardened container with correct mounts
- `Dockerfile` — custom binary layer composed from integration needs
- `workspace/identity/*` — identity files populated from template
- `workspace/tools/*` — CLI wrappers generated from integrations
- `workspace/skills/*` — skill implementations from template
- `cron/jobs.json` — scheduled jobs in OpenClaw-native format
- `.env` + `credentials.json` — secrets secured (mode 0600)

**The agent grows over time:**

```bash
clawhq skill install <name>     # Add a capability (sandboxed, vetted, rollback-ready)
clawhq skill list               # What can the agent do?
clawhq evolve                   # Manage capabilities, identity, integrations
clawhq export                   # Portable bundle — yours forever
clawhq destroy                  # Verified wipe — cryptographic proof it's gone
```

### Layer 3: The Cloud Service

Optional. The product works without it.

```bash
clawhq cloud connect       # Link to clawhq.com
```

- **Remote monitoring** — See agent health from your phone (status only, never content)
- **Managed hosting** — Same distro on DigitalOcean, Hetzner, Mac Mini. Web console. Zero terminal.
- **Template marketplace** — Community templates for every use case
- **Security advisories** — Push notifications for OpenClaw CVEs
- **Fleet management** — Multi-agent dashboard for operators

## The Distro Directory

```
~/.clawhq/
├── clawhq.yaml                    # Meta-config (version, install method, cloud token)
│
├── engine/                        # OpenClaw runtime (acquired by installer)
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
│   ├── doctor/                    # Diagnostic checks
│   ├── monitor/                   # Health monitoring + alerts
│   ├── backup/snapshots/          # Encrypted backups
│   ├── updater/rollback/          # Pre-update images
│   ├── audit/                     # Tool, secret, and egress logs
│   └── firewall/                  # Egress allowlist per integration
│
├── security/                      # Hardening config (posture, sandbox)
├── cron/                          # Scheduled jobs (OpenClaw-native)
└── cloud/                         # Cloud connection (optional)
```

## Deployment Options

Same distro. Same templates. Same agent. Different host.

| Option | Who Manages | Cost |
|---|---|---|
| Your PC (Linux, macOS, WSL) | You + ClawHQ CLI | $0 + compute |
| Mac Mini (home server) | You + ClawHQ CLI | $0 + hardware |
| DigitalOcean / Hetzner / Vultr | ClawHQ managed | VPS + managed fee |
| Any VPS | You + ClawHQ CLI | VPS cost |

**Self-managed:** You run `clawhq install`. Full control. CLI assists with updates, backups, monitoring.

**Managed:** ClawHQ provisions the host, installs the distro, runs `agentd` daemon. Web console. Same engine, same templates, same security. We manage the host, never the contents.

## Data Sovereignty

| Principle | How |
|---|---|
| **Local by default** | Ollama models are the default. Cloud APIs opt-in per-task-category. |
| **Transparent** | Every tool execution logged. Every outbound call tracked. |
| **Portable** | `clawhq export` — take everything. Works with raw OpenClaw. |
| **Deletable** | `clawhq destroy` — cryptographic verification of complete wipe. |
| **Auditable** | Open source. Verify every claim. |

## Why This Exists

OpenClaw has a control panel. It's fine for basic management — like cPanel is fine for managing Apache. But nobody uses raw cPanel to build a blog, a store, or a membership site. You use WordPress. WordPress doesn't replace cPanel — it sits on top and makes the server do something specific and valuable.

| Engine | Basic Management | Makes It Do Something |
|---|---|---|
| Linux + Apache | cPanel | WordPress |
| **OpenClaw** | **Gateway UI** | **ClawHQ** |

ClawHQ is for people who want a personal AI agent that does a specific job — manages their email, assists with trading, plans meals, runs their schedule — on their own terms, on their own hardware, with their own data.

## Status

Active development. TypeScript CLI, tight coupling to OpenClaw's Node.js/TypeBox stack.

- [docs/PRODUCT.md](docs/PRODUCT.md) — Product design: problem, personas, user stories, build order
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Solution architecture: three layers, six modules, zero-trust remote admin
- [docs/OPENCLAW-REFERENCE.md](docs/OPENCLAW-REFERENCE.md) — Engineering reference: OpenClaw internals, config landmines, integration surfaces
