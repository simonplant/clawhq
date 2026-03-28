# ClawHQ

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

**Your AI doesn't know you.** ClawHQ deploys, configures, and personalizes sovereign AI agents — persistent, personal, running on your hardware. No PhD in DevOps required.

---

## The Problem

The big 4 AI companies are building personal agents that know everything about you — emails, calendar, tasks, health, finances. They store it on their servers. They train on it. You have zero sovereignty.

OpenClaw is the escape hatch — the most powerful open-source agent framework, running in a Docker container you control. But it's nearly impossible to operate: ~13,500 tokens of config across 11+ files, 14 silent landmines, and most deployments abandoned within a month.

Today you choose between **surveillance AI** (polished, easy, you own nothing) or **raw framework** (sovereign, powerful, months of expertise). Nobody makes the sovereign option usable.

## The Solution

ClawHQ deploys, configures, and personalizes OpenClaw agents. It compiles **blueprints** — complete operational designs — into hardened, running agents. Choose a blueprint, customize it, and ClawHQ does the rest. You get a Signal, Telegram, or Discord UI. Your data stays on your machine.

Everything in OpenClaw is either a file or an API call. ClawHQ controls all of it programmatically — identity, tools, skills, cron, integrations, security, autonomy, memory.

```
┌─────────────────────────────────────────────────────────────┐
│  Blueprints (the product)                                    │
│  Complete agent designs that configure EVERYTHING             │
│  in OpenClaw for a specific job.                             │
├─────────────────────────────────────────────────────────────┤
│  Platform (table stakes)                                     │
│  Install · Harden · Launch · Ops                             │
│  Same for every agent — acquire engine, secure it,           │
│  keep it alive, back it up, update it safely                 │
├─────────────────────────────────────────────────────────────┤
│  Cloud (optional · deferred)                                 │
│  Remote monitoring · Blueprint library                       │
│  ─── the product works without this ───                      │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
git clone https://github.com/simonplant/clawhq && cd clawhq
npm install && npm run build && npm link
clawhq init --guided           # Pick a blueprint, connect services
clawhq up                      # Deploy your agent
```

Security hardening is automatic — no opt-in required. See [docs/QUICKSTART.md](docs/QUICKSTART.md) for the full walkthrough (development preview).

## Blueprints

A blueprint configures identity, tools, skills, cron, integrations, security, autonomy, memory, and egress for a specific job. One example:

```yaml
# configs/blueprints/email-manager.yaml
name: Email Manager
use_case: "Run my emails"
tools: [email, calendar, tasks]
skills: [email-digest, morning-brief, schedule-guard]
cron: inbox check every 15 min, daily digest at 8am
```

"Run my emails" becomes inbox triage, morning digests, auto-reply with approval gates, and calendar protection — fully configured, hardened, and running.

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for the full blueprint schema and all available options.

## Status

**Active development.** Built with AI-assisted development (Claude Code).

**Working:** Blueprint engine with 7 use-case blueprints, config generation with 14-landmine prevention, full deploy pipeline with container security hardening, diagnostics + auto-fix (`clawhq doctor`), skill system with sandboxed vetting, encrypted backup/restore, credential health probes, memory lifecycle, cloud provisioning (4 providers), trust modes, audit trail.

**In progress:** Agent runtime integration (wiring subsystems to the running agent), web dashboard UI, distro installer (`curl | sh`).

Core bet: people will choose a sovereign AI agent over a big-tech one — if the sovereign option isn't dramatically harder to use.

## Documentation

| Document | Description |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Three layers, six modules, zero-trust remote admin, skill system |
| [Quickstart](docs/QUICKSTART.md) | From zero to a working agent in under 10 minutes |
| [Configuration](docs/CONFIGURATION.md) | Blueprint schema, skill schema, every config option |
| [Problems](docs/PROBLEMS.md) | Why OpenClaw is hard and what ClawHQ fixes |
| [Roadmap](docs/ROADMAP.md) | What's built, what's next, honest assessment |
| [Contributing](docs/CONTRIBUTING.md) | How to contribute blueprints, skills, and code |
| [Changelog](docs/CHANGELOG.md) | Development history and notable changes |
| [Product](docs/PRODUCT.md) | Product design: problem, personas, user stories |
| [OpenClaw Reference](docs/OPENCLAW-REFERENCE.md) | Engine internals, 14 landmines, integration surfaces |

## Author

**Simon Plant** — Building AI infrastructure tools. Open to roles in AI platform engineering and developer tools.

## License

Licensed under the [Apache License 2.0](LICENSE).
