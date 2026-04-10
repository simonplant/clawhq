# ClawHQ

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

**Your AI doesn't know you.** ClawHQ deploys, configures, and personalizes sovereign AI agents — persistent, personal, running on your hardware. No PhD in DevOps required.

---

## The Problem

OpenClaw is the fastest-growing open-source project in GitHub history — 250K+ stars, 2M+ monthly active users, and a security crisis: 42,000+ exposed instances, 9+ CVEs in the first 2 months, and 20-36% of community skills on ClawHub found malicious. Microsoft, Cisco, and Nvidia have all published security guidance. The creator joined OpenAI in February 2026 and the project moved to a foundation.

The demand for sovereign AI is proven. But OpenClaw is nearly impossible to operate correctly: ~13,500 tokens of config across 11+ files (8 auto-loaded workspace files + runtime config, Docker, credentials, cron), 14 silent landmines, memory that bloats to 360KB in 3 days, and most deployments abandoned within a month. 1,000+ people queued outside Tencent HQ just for installation help.

10+ hosting providers (Blink, xCloud, AWS Lightsail, DigitalOcean, Hostinger, and others) now sell managed OpenClaw at $22-45/mo — but they deploy default-config agents on a VPS with no lifecycle management, no landmine prevention, and no architectural security. They solve convenience. Nobody solves sovereignty.

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

Security hardening is automatic — no opt-in required. See [docs/QUICKSTART.md](docs/QUICKSTART.md) for the full walkthrough (pre-launch preview).

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

## Why Not Just Use a Hosting Provider?

Hosting providers deploy OpenClaw on a VPS with default or lightly-hardened config. ClawHQ operates at a different layer:

- **Blueprints** — purpose-built agent designs that configure 10 dimensions simultaneously (identity, tools, skills, cron, security, egress, autonomy, memory, models, integrations). Not "OpenClaw on a VPS" — a fully designed system for a specific job.
- **14-landmine prevention** — the config generator makes it impossible to ship a broken config. Every hosting provider ships default config and hopes for the best.
- **Security by architecture** — content access architecturally blocked (no code path, not a policy flag). Egress firewall per integration. Identity files read-only. No hosting provider does architectural security.
- **Lifecycle management** — doctor, backup, update, skill vetting, memory management, credential health probes. Hosting providers offer infrastructure. ClawHQ offers operations.
- **Agent evolution** — the agent at month 6 does more than at day 1, through a validated, sandboxed, rollback-capable pipeline. No hosting provider touches this.

## Status

**Pre-launch.** Built with AI-assisted development (Claude Code). The market is large and contested — 10+ hosting providers are capturing the OpenClaw ecosystem. ClawHQ competes on architectural depth and sovereignty, not hosting convenience.

**Working:** Blueprint engine with 7 internal blueprints (extracting 3 as standalone publishable configs in progress), config generation with 14-landmine prevention, full deploy pipeline with container security hardening, diagnostics + auto-fix (`clawhq doctor` — 30 checks), skill system with sandboxed vetting, encrypted backup/restore, credential health probes, memory lifecycle, cloud provisioning (4 providers), trust modes, audit trail.

**In progress:** Agent runtime integration (wiring subsystems to the running agent), web dashboard UI, distro installer (`curl | sh`).

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
| [Product](docs/PRODUCT.md) | Product design: problem, profiles, blueprints |
| [OpenClaw Reference](docs/OPENCLAW-REFERENCE.md) | Engine internals, 14 landmines, integration surfaces |

## Author

**Simon Plant** — Building AI infrastructure tools. Open to roles in AI platform engineering and developer tools.

## License

Licensed under the [Apache License 2.0](LICENSE).
