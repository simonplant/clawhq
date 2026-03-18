# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ClawHQ turns generic, unsecured open-source software (OpenClaw) into personalized digital agents — without the user knowing how any of it works. They get a Signal, Telegram, or Discord UI. We do the rest.

OpenClaw has its own control panel (Gateway UI). That's cPanel. ClawHQ is WordPress — the intelligent configuration layer with hundreds of use-case recipes that programmatically configure every dimension of OpenClaw for a specific job. Everything in OpenClaw is a file or API call. ClawHQ controls all of it.

**Current status: Active development.** Full CLI implementation with operational tooling. Key docs:
- `README.md` — Executive summary and positioning
- `docs/PRODUCT.md` — Product design: problem, personas, user stories, build order
- `docs/ARCHITECTURE.md` — Solution architecture: three layers, template engine, distro, cloud
- `docs/OPENCLAW-REFERENCE.md` — Engineering reference: OpenClaw internals, 14 landmines, config surface

## Architecture

See `docs/ARCHITECTURE.md` for the full solution architecture.

**Three layers:**
- **Layer 1 (Distro — table stakes):** Install, harden, launch, ops. Acquire engine, secure it, keep it alive. Same for every agent.
- **Layer 2 (Template Engine — THE PRODUCT):** Hundreds of recipes. During setup, ClawHQ cooks ~10 personalized for the user — configuring identity, tools, skills, cron, integrations, security, autonomy, memory, model routing, egress rules. The agent is purpose-built for a specific job.
- **Layer 3 (Cloud Service — the business):** Managed hosting, remote monitoring, template marketplace. Optional.

**Six modules:**
- **ClawSmith** — Template engine. THE PRODUCT. Hundreds of recipes → personalized agent.
- **ClawOps** — Doctor, monitor, backup, update, status, logs. Keep it alive.
- **ClawAdmin** — Security, credentials, firewall, audit, sandbox. Lock it down.
- **ClawConstruct** — Skills, tools, evolution, rollback. Grow it.
- **ClawForge** — Installer, Docker build, deploy orchestration. Build it.
- **ClawHQ Cloud** — Managed hosting, remote monitoring, marketplace. The business.

**Deployment options:** Same stack runs everywhere — user's PC, Mac Mini, DigitalOcean, any VPS. Self-managed or fully managed.

**Remote admin:** Three trust modes — Paranoid (no cloud), Zero-Trust (agent-initiated, signed commands, user-approved), Managed (auto-approved ops, content architecturally blocked). See ARCHITECTURE.md.

## Architectural Decisions (locked — see ARCHITECTURE.md for full rationale)

- **AD-01: One binary, flat CLI** — `clawhq` is a single install with flat commands (`clawhq doctor`, not `clawhq ops doctor`). Modules are internal source organization for developers, never user-facing. Multiple binaries = "you're the operator." One binary = "we handle everything."
- **AD-02: Unix philosophy in agent tools, not in ClawHQ** — `email`, `calendar`, `tasks`, `quote` are small composable workspace tools. Templates compose them. ClawHQ is WordPress (the orchestrator), not sed+awk+grep.
- **AD-03: Tight coupling to OpenClaw** — No abstraction layer. Direct use of TypeBox schema, WebSocket RPC, file paths.
- **AD-04: TypeScript monorepo, single package** — One npm package. Module boundaries via barrel exports and directory structure.
- **AD-05: Security is architecture, not policy** — Content access in managed mode is architecturally blocked (no handler exists), not policy-blocked.

## Key Design Constraints

- **ClawHQ is the install** — Users don't install OpenClaw separately. ClawHQ acquires, configures, and manages the engine end-to-end
- **Two acquisition paths** — Trusted cache (signed, hash-verified) or from source (clone, audit, build). User chooses their trust level
- **Security by default** — Container hardening applied automatically during install, not opt-in
- **Config generation must be correct** — All 14+ known silent landmines auto-handled; impossible to produce a broken config
- **Identity files are read-only** — Agents cannot modify their own personality or guardrails
- **Credentials secured** — `credentials.json` mode 0600, secrets in `.env` mode 0600, never in config files, never logged
- **Data sovereignty** — Full portability (`export`), verified deletion (`destroy`), zero lock-in
- **Same distro everywhere** — User's PC, Mac Mini, DigitalOcean, Hetzner — same software, same security, different host

## CLI Commands

```
# Install
clawhq install                — Full distro install (pre-reqs, engine, scaffold)
clawhq install --from-source  — Zero-trust: clone, audit, build from source

# Configure
clawhq init --guided          — Interactive wizard → complete deployment bundle
clawhq init --smart           — AI-powered config inference (local Ollama)
clawhq template list/preview  — Browse and preview templates

# Build
clawhq build                  — Two-stage Docker build with change detection + manifests

# Secure
clawhq scan                   — PII + secrets scanner
clawhq creds                  — Credential health probes
clawhq audit                  — Tool execution + egress audit trail

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

# Skills & Tools
clawhq skill install <source> — Install skill (with security vetting)
clawhq skill update/remove    — Update or remove installed skill
clawhq skill list             — List installed skills

# Evolve / Decommission
clawhq evolve                 — Manage agent capabilities
clawhq export                 — Export portable agent bundle
clawhq destroy                — Verified agent destruction

# Cloud (optional)
clawhq cloud connect          — Link to clawhq.com for remote monitoring
clawhq cloud status           — Remote health dashboard
```

## Implementation Notes

- `docs/PRODUCT.md` — Product bible: problem, solution, user stories organized by module (ClawSmith, ClawForge, ClawAdmin, ClawOps, ClawConstruct, ClawHQ Cloud)
- `docs/ARCHITECTURE.md` — Architecture: three layers, six modules, ADs, zero-trust remote admin, package structure
- `docs/OPENCLAW-REFERENCE.md` — Engineering reference: OpenClaw internals, 14 landmines, config surfaces, integration details
- `backlog/GAP-ANALYSIS.md` — AS-IS/TO-BE comparison, 10 gaps identified
- `backlog/backlog.json` — Sprint-ready backlog, 6 parallel tracks

Key technical details:
- TypeScript throughout — matches OpenClaw's Node.js/TypeBox stack, shares schema types directly
- Tight coupling to OpenClaw — uses its config schema, WebSocket RPC, file paths, and container structure directly
- Distro directory at `~/.clawhq/` — engine, workspace, ops, security, cron, cloud all organized under one root
- Two-stage Docker build: Stage 1 (base OpenClaw + apt packages), Stage 2 (custom tools + skills)
- Egress firewall uses dedicated iptables chain (`CLAWHQ_FWD`) on Docker bridge — must reapply after every `docker compose down`
- `doctor` is the hero feature — checks every known failure mode preventively
- Templates are full operational profiles (personality, security, monitoring, memory, cron, autonomy, integrations, skills)

## Key Source Layout (Target Architecture)

Organized by modules. See `docs/ARCHITECTURE.md` for full package structure.

```
src/
├── cli/                        — Commander.js CLI (thin layer over modules)
│
├── smith/                      — ClawSmith: THE PRODUCT (template engine)
│   ├── templates/              — Recipe library, loader, mapper, personalizer
│   ├── configure/              — Setup wizard, generate, writer
│   ├── tools/                  — CLI tool generators (email, calendar, tasks, etc.)
│   └── identity/               — Identity file generators (AGENTS.md, HEARTBEAT.md, etc.)
│
├── ops/                        — ClawOps: keep it alive
│   ├── doctor/                 — Diagnostics + auto-fix
│   ├── monitor/                — Health monitoring daemon
│   ├── backup/                 — Encrypted backup/restore
│   ├── updater/                — Safe updates + rollback
│   ├── status/                 — Dashboard
│   └── logs/                   — Log streaming
│
├── admin/                      — ClawAdmin: lock it down
│   ├── harden/                 — Container security overrides
│   ├── credentials/            — Credential store + health probes
│   ├── firewall/               — iptables CLAWHQ_FWD chain
│   ├── audit/                  — Audit logging (tool, secret, egress, cloud)
│   ├── scanner/                — PII + secret scanning
│   ├── sandbox/                — Tool execution sandbox
│   └── validate/               — 14 landmine rules
│
├── construct/                  — ClawConstruct: grow it
│   ├── skills/                 — Skill install/update/remove + vetting
│   ├── evolve/                 — Capability evolution
│   ├── rollback/               — Change rollback
│   └── lifecycle/              — Export + destroy
│
├── forge/                      — ClawForge: build it
│   ├── installer/              — Pre-reqs, engine acquisition, scaffold
│   ├── docker/                 — Two-stage build, compose, Dockerfile gen
│   └── launcher/               — Deploy orchestration (up/down/restart)
│
├── cloud/                      — ClawHQ Cloud: the business
│   ├── agentd/                 — Managed mode daemon
│   ├── heartbeat/              — Health reporting
│   ├── commands/               — Command queue (pull, verify, execute)
│   └── fleet/                  — Multi-agent management
│
├── gateway/                    — OpenClaw Gateway communication (cross-cutting)
└── config/                     — Config types + schema (cross-cutting)
```

**Note:** Current source layout differs from target. See `src/` for actual current structure. The module reorganization is planned work.

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
