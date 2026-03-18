# ClawHQ

**WordPress for AI agents.**

---

OpenClaw is the most powerful open-source framework for personal AI agents. It has its own control panel (the Gateway UI). It handles message routing, model calls, tool execution, sessions. It's a solid engine.

But it's a *generic* engine. Getting OpenClaw to actually do what you want — manage your email, assist with stock trading, plan meals, maintain a blog — means wrangling ~13,500 tokens of config across 11+ files, dodging 14 silent landmines, writing custom tools, composing identity files, setting up cron jobs, configuring integrations, tuning autonomy levels, and doing ongoing SRE work. Most deployments are abandoned within a month.

**ClawHQ turns generic, unsecured open-source software into your personalized digital agent — without you knowing how any of it works.** You get a Signal, Telegram, or Discord UI. We do the rest. Everything in OpenClaw is either a file or an API call. ClawHQ controls all of it programmatically — identity, tools, skills, cron, integrations, security, autonomy, memory — through blueprints that configure a complete agent for a specific job.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  Cloud                                                       │
│  Managed hosting · Remote monitoring · Blueprint library     │
│  ─── optional — the product works without this ───           │
├─────────────────────────────────────────────────────────────┤
│  Blueprints (the product)                                    │
│  Complete agent designs that configure EVERYTHING             │
│  in OpenClaw for a specific job:                             │
│                                                              │
│  "Run my emails"        → email tools, triage skills,        │
│                           morning digest, inbox zero cron    │
│  "Assist stock trading" → market data tools, research        │
│                           skills, alert cron, finance guard  │
│  "Plan meals"           → nutrition tools, shopping skills,  │
│                           weekly plan cron, dietary prefs    │
│  "Maintain AI blog"     → research tools, writing skills,    │
│                           publish cron, editorial voice      │
│  "Replace Google Asst"  → email + calendar + tasks + brief   │
│                           + full-day orchestration           │
├─────────────────────────────────────────────────────────────┤
│  Platform (table stakes)                                     │
│  Install · Harden · Launch · Ops                             │
│  Same for every agent — acquire engine, secure it,           │
│  keep it alive, back it up, update it safely                 │
└─────────────────────────────────────────────────────────────┘
```

### The Platform

One command installs the whole stack.

```bash
# From trusted cache (default — signed, hash-verified)
curl -fsSL https://clawhq.com/install | sh

# Zero-trust (clone, audit, build from source)
git clone https://github.com/clawhq/clawhq && cd clawhq && ./install --from-source --verify
```

Security hardening is automatic — `cap_drop ALL`, read-only rootfs, non-root UID 1000, egress firewall, identity files read-only. No opt-in required.

```bash
clawhq doctor [--fix]      # Every known failure mode, with auto-fix
clawhq status [--watch]    # Single-pane health dashboard
clawhq backup create       # Encrypted snapshot
clawhq update [--check]    # Safe upstream upgrade with rollback
clawhq creds               # Credential health probes
clawhq audit               # Tool execution + egress audit trail
```

### Blueprints

This is the product. Blueprints are complete agent designs that configure every dimension of OpenClaw for a specific job.

```bash
clawhq init --guided       # Interactive: pick a use case, connect services
clawhq init --smart        # AI-powered: describe what you want in plain language
```

A blueprint configures:

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

**The agent evolves over time:**

```bash
clawhq skill install <name>     # Add a capability (sandboxed, vetted, rollback-ready)
clawhq evolve                   # Manage capabilities, identity, integrations
clawhq export                   # Portable bundle — yours forever
clawhq destroy                  # Verified wipe — cryptographic proof it's gone
```

### Cloud

Optional. The product works without it.

```bash
clawhq cloud connect       # Link to clawhq.com
```

- **Remote monitoring** — See agent health from your phone (status only, never content)
- **Managed hosting** — Same platform on DigitalOcean, Hetzner, Mac Mini. Web console. Zero terminal.
- **Blueprint library** — Community blueprints for every use case
- **Fleet management** — Multi-agent dashboard for operators

## Deployment Options

Same platform. Same blueprints. Same agent. Different host.

| Option | Who Manages | Cost |
|---|---|---|
| Your PC (Linux, macOS, WSL) | You + ClawHQ CLI | $0 + compute |
| Mac Mini (home server) | You + ClawHQ CLI | $0 + hardware |
| DigitalOcean / Hetzner / Vultr | ClawHQ managed | VPS + managed fee |
| Any VPS | You + ClawHQ CLI | VPS cost |

## Data Sovereignty

| Principle | How |
|---|---|
| **Local by default** | Ollama models are the default. Cloud APIs opt-in per-task-category. |
| **Transparent** | Every tool execution logged. Every outbound call tracked. |
| **Portable** | `clawhq export` — take everything. Works with raw OpenClaw. |
| **Deletable** | `clawhq destroy` — cryptographic verification of complete wipe. |
| **Auditable** | Open source. Verify every claim. |

## Why This Exists

OpenClaw is a powerful engine — but a generic one. Getting it to do a specific job well requires deep expertise. ClawHQ bridges that gap with blueprints: complete agent designs for specific use cases, forged into running agents with one command.

ClawHQ is for people who want a personal AI agent that does a specific job — manages their email, assists with trading, plans meals, runs their schedule — on their own terms, on their own hardware, with their own data.

## Status

Active development. TypeScript CLI, tight coupling to OpenClaw's Node.js/TypeBox stack.

- [docs/PRODUCT.md](docs/PRODUCT.md) — Product design: problem, personas, user stories, build order
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Solution architecture: six modules, zero-trust remote admin
- [docs/OPENCLAW-REFERENCE.md](docs/OPENCLAW-REFERENCE.md) — Engineering reference: OpenClaw internals, config landmines, integration surfaces
