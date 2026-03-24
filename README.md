# ClawHQ

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

**WordPress for AI agents.** Curated blueprints that turn OpenClaw into a purpose-built personal agent — without a PhD in DevOps.

---

## The Problem

The big 4 AI companies are building personal agents that know everything about you — emails, calendar, tasks, health, finances. They store it on their servers. They train on it. You have zero sovereignty.

OpenClaw is the escape hatch — the most powerful open-source agent framework, running in a Docker container you control. But it's nearly impossible to operate: ~13,500 tokens of config across 11+ files, 14 silent landmines, and most deployments abandoned within a month.

Today you choose between **surveillance AI** (polished, easy, you own nothing) or **raw framework** (sovereign, powerful, months of expertise). Nobody makes the sovereign option usable.

## The Solution

ClawHQ is an agent platform for OpenClaw. It forges purpose-built agents from **blueprints** — complete operational designs that configure every dimension of the agent for a specific job. Choose a blueprint, customize it, and ClawHQ forges a hardened, running agent. You get a Signal, Telegram, or Discord UI. We do the rest.

Everything in OpenClaw is either a file or an API call. ClawHQ controls all of it programmatically — identity, tools, skills, cron, integrations, security, autonomy, memory.

```
┌─────────────────────────────────────────────────────────────┐
│  Cloud                                                       │
│  Managed hosting · Remote monitoring · Blueprint library     │
│  ─── optional — the product works without this ───           │
├─────────────────────────────────────────────────────────────┤
│  Blueprints (the product)                                    │
│  Complete agent designs that configure EVERYTHING             │
│  in OpenClaw for a specific job.                             │
├─────────────────────────────────────────────────────────────┤
│  Platform (table stakes)                                     │
│  Install · Harden · Launch · Ops                             │
│  Same for every agent — acquire engine, secure it,           │
│  keep it alive, back it up, update it safely                 │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
npm install -g clawhq          # Install
clawhq init --guided           # Pick a blueprint, connect services
clawhq up                      # Deploy your agent
```

Security hardening is automatic — no opt-in required. See [docs/QUICKSTART.md](docs/QUICKSTART.md) for the full walkthrough.

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

**Active development.** 33 CLI commands, 90,000+ lines of TypeScript, 132 test files. The platform layer (install, harden, deploy, doctor, backup, update, skills) is implemented. Blueprint customization and the installer are in progress.

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
