# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ClawHQ is a control panel for OpenClaw agents — the "cPanel for personal AI agents." It manages the full deployment lifecycle of OpenClaw agents: Plan, Build, Secure, Deploy, Operate, Evolve, and Decommission.

**Current status: Active development.** Full CLI implementation with operational tooling. Key docs:
- `README.md` — Executive summary and positioning
- `docs/PRODUCT.md` — Product design document: problem, personas, user stories, build order
- `docs/ARCHITECTURE.md` — Solution architecture: three-tier system, package structure, security, data flow
- `docs/OPENCLAW-REFERENCE.md` — Engineering reference: OpenClaw internals, 14 landmines, config surface

## Architecture

See `docs/ARCHITECTURE.md` for the full solution architecture.

**Three-tier system:**
- **Tier 1 (OpenClaw):** The agent runtime — unmodified, ClawHQ wraps but never forks
- **Tier 2 (ClawHQ Local):** CLI + local web UI on the same host. This is the core product — works fully standalone
- **Tier 3 (ClawHQ Cloud):** Optional web service for accounts, remote health, updates, fleet management. Never required

**Three-layer product model:**
- **Layer 1 (Core Platform):** Universal security, monitoring, memory management, config safety, audit logging — same for every agent
- **Layer 2 (Templates):** Full operational profiles — like WordPress themes for agents. Templates can tighten Layer 1 security but never loosen it
- **Layer 3 (Integrations):** Provider abstraction — agents talk to "calendar" not "Google Calendar," enabling provider swaps without behavior changes

## Key Design Constraints

- **Never pre-built images** — Always build from OpenClaw source for auditability
- **Security by default** — Container hardening (cap_drop ALL, read-only rootfs, non-root UID 1000, egress firewall) is mandatory, not optional
- **Config generation must be correct** — The Plan toolchain must make it impossible to produce a broken config; all 14+ known silent landmines must be auto-handled
- **Identity files are read-only** — Agents cannot modify their own personality or guardrails
- **Secrets in `.env` only** — Never in config files, never logged, never in unencrypted backups
- **Data sovereignty** — Full portability (`export`), verified deletion (`destroy`), zero lock-in

## CLI Commands

```
# Plan
clawhq init --guided          — Interactive wizard → complete deployment bundle
clawhq template list/preview  — Browse and preview templates

# Build
clawhq build                  — Two-stage Docker build with change detection + manifests

# Secure
clawhq scan                   — PII + secrets scanner
clawhq creds                  — Credential health probes
clawhq audit                  — Audit logs (planned)

# Deploy
clawhq up / down / restart    — Deploy with pre-flight checks, firewall, health verify
clawhq connect                — Connect messaging channel

# Operate
clawhq doctor [--fix]         — Preventive diagnostics (14+ checks) with auto-fix
clawhq status [--watch]       — Single-pane dashboard
clawhq backup create/list/restore — Encrypted snapshots
clawhq update [--check]       — Safe upstream upgrade with rollback
clawhq logs                   — Stream agent logs

# Agent Management
clawhq agent add <id>         — Add agent to multi-agent deployment
clawhq agent list             — List configured agents

# Skills
clawhq skill install <source> — Install skill (with security vetting)
clawhq skill update <name>    — Update installed skill
clawhq skill remove <name>    — Remove skill
clawhq skill list             — List installed skills

# Evolve / Decommission
clawhq evolve                 — Manage agent capabilities (planned)
clawhq export                 — Export portable agent bundle
clawhq destroy                — Verified agent destruction
```

## Implementation Notes

- `docs/PRODUCT.md` — User stories and acceptance criteria for each toolchain
- `docs/ARCHITECTURE.md` — System design, package structure, security model, data flow
- `docs/OPENCLAW-REFERENCE.md` — OpenClaw internals, integration surfaces, landmine rules, config details

Key technical details:
- TypeScript throughout — matches OpenClaw's Node.js/TypeBox stack, shares schema types directly
- Tight coupling to OpenClaw — uses its config schema, WebSocket RPC, file paths, and container structure directly
- Two-stage Docker build: Stage 1 (base OpenClaw + apt packages), Stage 2 (custom tools + skills)
- Egress firewall uses dedicated iptables chain (`CLAWHQ_FWD`) on Docker bridge — must reapply after every `docker compose down`
- `doctor` is the hero feature — checks every known failure mode preventively
- Templates are full operational profiles (personality, security, monitoring, memory, cron, autonomy, integrations, skills)

## Key Source Layout

```
src/
├── cli/index.ts                — Commander.js CLI entry point
├── config/
│   ├── schema.ts               — OpenClaw/ClawHQ types (CronJobDefinition, AgentEntry, DeploymentBundle)
│   ├── generator.ts            — Bundle generation API (delegates to init/generate.ts)
│   └── validator.ts            — 14 landmine validation rules
├── init/
│   ├── wizard.ts               — Interactive questionnaire orchestrator
│   ├── steps.ts                — 4 wizard steps (basics, template, integrations, models)
│   ├── templates.ts            — 6 built-in templates
│   ├── generate.ts             — Full bundle generator (config, tools, identity, skills, cron, Dockerfile)
│   └── writer.ts               — Atomic file writer
├── workspace/
│   ├── tools/                  — 7 CLI tool generators + registry
│   │   ├── registry.ts         — Integration → tool mapping
│   │   ├── email.ts            — himalaya wrapper
│   │   ├── tasks.ts            — local work queue (channels, autonomy, priority)
│   │   ├── todoist.ts          — Todoist API client
│   │   ├── ical.ts             — CalDAV calendar client
│   │   ├── quote.ts            — Yahoo Finance market quotes
│   │   ├── tavily.ts           — web research API
│   │   └── todoist-sync.ts     — task polling + due alerts
│   ├── identity/               — Identity file generators
│   │   ├── agents.ts           — AGENTS.md (operating instructions)
│   │   ├── heartbeat.ts        — HEARTBEAT.md (recon phases from integrations)
│   │   ├── tools-doc.ts        — TOOLS.md (auto-generated from installed tools)
│   │   ├── identity.ts         — IDENTITY.md
│   │   └── memory.ts           — MEMORY.md skeleton
│   └── skills/                 — Skill template generators
│       ├── construct.ts        — Self-improvement framework
│       └── morning-brief.ts    — Daily briefing skill
├── docker/
│   ├── build.ts                — Two-stage build orchestration
│   ├── dockerfile.ts           — Dockerfile generator (binary fragments from integrations)
│   ├── hardening.ts            — Security posture overrides
│   └── compose.ts              — Docker Compose operations
├── deploy/                     — Deployment orchestration
├── doctor/                     — Diagnostics and auto-fix
├── status/                     — Status dashboard
├── backup/                     — Encrypted backup/restore
├── update/                     — Safe upstream updates
├── security/                   — Credential probes, secrets scanner, firewall
├── skill/                      — Skill lifecycle management
└── templates/                  — YAML template loader/mapper
```

## Sprint Orchestration (aishore)

This project uses [aishore](https://github.com/simonweniger/aishore) for AI-assisted sprint management.

### Commands

```bash
# Sprints
.aishore/aishore run [count]        # Run N sprints (default: 1)
.aishore/aishore run FEAT-001       # Run specific 

# Grooming
.aishore/aishore groom              # Tech lead: groom bugs
.aishore/aishore groom --backlog    # Product owner: groom features

# Review
.aishore/aishore review             # Architecture review
.aishore/aishore review --update-docs          # Review and update docs
.aishore/aishore review --since <commit>       # Review changes since commit

# Info
.aishore/aishore metrics            # Sprint metrics
.aishore/aishore metrics --json     # Metrics as JSON

# Maintenance
.aishore/aishore update             # Update from upstream (checksum-verified)
.aishore/aishore update --dry-run   # Check for updates without applying
.aishore/aishore checksums          # Regenerate checksums after editing .aishore/ files
.aishore/aishore init               # Interactive setup wizard
```

**Important**: After modifying any files in `.aishore/` (script, agent prompts, etc.), run `.aishore/aishore checksums` before committing. This regenerates `checksums.sha256` which is used to verify integrity during `update`.
