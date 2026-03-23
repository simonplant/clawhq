# ClawHQ

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

**Curated configurations, skills, personas, and best practices for OpenClaw.**

---

## Why

OpenClaw is the most powerful open-source framework for personal AI agents. It handles message routing, model calls, tool execution, sessions. It's a solid engine.

But it's a *generic* engine. Getting OpenClaw to actually do what you want — manage your email, assist with stock trading, plan meals, maintain a blog — means wrangling ~13,500 tokens of config across 11+ files, dodging 14 silent landmines, writing custom tools, composing identity files, setting up cron jobs, configuring integrations, tuning autonomy levels, and doing ongoing SRE work. Most deployments are abandoned within a month.

People in Asia are paying others to install OpenClaw because it's that hard. ClawHQ is the missing piece — production-ready templates and integrations that turn a generic, unsecured framework into your personalized digital agent, without you knowing how any of it works.

**ClawHQ is like RightScale + WordPress templates for OpenClaw.** You get a Signal, Telegram, or Discord UI. We do the rest. Everything in OpenClaw is either a file or an API call. ClawHQ controls all of it programmatically — identity, tools, skills, cron, integrations, security, autonomy, memory — through blueprints that configure a complete agent for a specific job.

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

## Quick Start

```bash
# From trusted cache (default — signed, hash-verified)
curl -fsSL https://clawhq.com/install | sh

# Zero-trust (clone, audit, build from source)
git clone https://github.com/clawhq/clawhq && cd clawhq && ./install --from-source --verify
```

Then pick a blueprint and forge your agent:

```bash
clawhq init --guided       # Interactive: pick a use case, connect services
clawhq init --smart        # AI-powered: describe what you want in plain language
```

Security hardening is automatic — `cap_drop ALL`, read-only rootfs, non-root UID 1000, egress firewall, identity files read-only. No opt-in required.

## What's Included

### Blueprints

Production-ready agent designs in `configs/blueprints/`:

| Blueprint | What It Does |
|---|---|
| `email-manager` | Email triage, digest, auto-reply, inbox zero |
| `replace-google-assistant` | Email + calendar + tasks + daily brief |
| `replace-chatgpt-plus` | Local-first ChatGPT replacement |
| `replace-my-pa` | Full personal assistant orchestration |
| `research-copilot` | Research workflows and synthesis |
| `founders-ops` | Founder operations: investor updates, metrics, scheduling |
| `family-hub` | Family coordination: meals, schedules, shopping |

Each blueprint configures identity, tools, skills, cron, integrations, security, autonomy, memory, models, and egress for its use case.

### Skills

Reusable capabilities in `configs/skills/`:

- **email-digest** — Summarize and triage incoming email
- **morning-brief** — Daily briefing with calendar, tasks, weather
- **schedule-guard** — Protect focus time, manage conflicts
- **market-scan** — Market data monitoring and alerts
- **meal-plan** — Weekly meal planning with dietary preferences
- **investor-update** — Generate investor update drafts

### Platform CLI

```bash
clawhq doctor [--fix]      # Diagnostics for every known failure mode, with auto-fix
clawhq status [--watch]    # Single-pane health dashboard
clawhq backup create       # Encrypted snapshot
clawhq update [--check]    # Safe upstream upgrade with rollback
clawhq creds               # Credential health probes
clawhq audit               # Tool execution + egress audit trail
clawhq skill install <src> # Add a capability (sandboxed, vetted, rollback-ready)
clawhq evolve              # Manage capabilities, identity, integrations
clawhq export              # Portable bundle — yours forever
clawhq destroy             # Verified wipe — cryptographic proof it's gone
```

### Cloud (Optional)

```bash
clawhq cloud connect       # Link to clawhq.com
```

- Remote monitoring — see agent health from your phone (status only, never content)
- Managed hosting — same platform on DigitalOcean, Hetzner, Mac Mini
- Blueprint library — community blueprints for every use case
- Fleet management — multi-agent dashboard for operators

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

## Contributing

Contributions are welcome. Share your personas, skills, and integrations with the community.

- **Blueprints** — Add new agent designs to `configs/blueprints/`
- **Skills** — Add reusable capabilities to `configs/skills/`
- **Bug fixes and improvements** — PRs against any module welcome

Please open an issue first for large changes. See the architecture docs in `docs/` for how the system fits together.

## Status

Active development. TypeScript CLI, tight coupling to OpenClaw's Node.js/TypeBox stack.

- [docs/PRODUCT.md](docs/PRODUCT.md) — Product design: problem, personas, user stories, build order
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Solution architecture: six modules, zero-trust remote admin
- [docs/OPENCLAW-REFERENCE.md](docs/OPENCLAW-REFERENCE.md) — Engineering reference: OpenClaw internals, config landmines, integration surfaces

## License

Licensed under the [Apache License 2.0](LICENSE).

```
Copyright 2025-2026 Simon Plant
```
