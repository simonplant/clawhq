# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ClawHQ is an agent platform for OpenClaw. It forges purpose-built agents from blueprints — complete operational designs that configure every dimension of OpenClaw for a specific job. Choose a blueprint ("Email Manager," "Stock Trading Assistant," "Meal Planner"), customize it, and ClawHQ forges a hardened, running agent. The user gets a Signal, Telegram, or Discord UI. We do the rest.

Everything in OpenClaw is a file or API call. ClawHQ controls all of it programmatically.

**Current status: Active development.** Full CLI implementation with operational tooling. Key docs:
- `README.md` — Executive summary and positioning
- `docs/PRODUCT.md` — Product design: problem, personas, user stories by module, build order
- `docs/ARCHITECTURE.md` — Solution architecture: six modules, zero-trust remote admin
- `docs/OPENCLAW-REFERENCE.md` — Engineering reference: OpenClaw internals, 14 landmines, config surface

## Architecture

See `docs/ARCHITECTURE.md` for the full solution architecture.

**Three layers:**
- **Platform** (table stakes) — Install, harden, launch, ops. Same for every agent.
- **Blueprints** (THE PRODUCT) — Complete agent designs for specific jobs. ClawHQ forges a personalized agent from a blueprint.
- **Cloud** (the business) — Managed hosting, remote monitoring, blueprint library. Optional.

**Six modules** (`design → build → secure → operate → evolve → cloud`):

| Module | What You're Doing | Directory |
|---|---|---|
| **design** | Choosing a blueprint, customizing, configuring | `src/design/` |
| **build** | Installing, compiling, deploying | `src/build/` |
| **secure** | Hardening, credentials, firewall, audit | `src/secure/` |
| **operate** | Monitoring, diagnosing, backing up, updating | `src/operate/` |
| **evolve** | Adding skills, growing capabilities, export, destroy | `src/evolve/` |
| **cloud** | Remote monitoring, managed hosting, fleet | `src/cloud/` |

**Remote admin:** Three trust modes — Paranoid (no cloud), Zero-Trust (agent-initiated, signed commands, user-approved), Managed (auto-approved ops, content architecturally blocked). See ARCHITECTURE.md.

## Architectural Decisions (locked — see ARCHITECTURE.md for full rationale)

- **AD-01: One binary, flat CLI** — `clawhq` is a single install with flat commands (`clawhq doctor`, not `clawhq operate doctor`). Modules are internal source organization, never user-facing.
- **AD-02: Unix philosophy in agent tools, not in ClawHQ** — `email`, `calendar`, `tasks`, `quote` are small composable workspace tools. Blueprints compose them. ClawHQ is the orchestrator.
- **AD-03: Tight coupling to OpenClaw** — No abstraction layer. Direct use of TypeBox schema, WebSocket RPC, file paths.
- **AD-04: TypeScript monorepo, single package** — One npm package. Module boundaries via barrel exports and directory structure.
- **AD-05: Security is architecture, not policy** — Content access in managed mode is architecturally blocked (no handler exists), not policy-blocked.

## Terminology

Canonical terms — use these consistently:

| Concept | Term | NOT |
|---|---|---|
| Agent designs (YAML) | **blueprint** | template, recipe, profile |
| What ClawHQ does with them | **forge** / **configure** | cook, bake, assemble |
| What gets produced | **agent** | claw, deployment |
| The setup flow | **setup** / **init** | cooking, forging process |
| Blueprint-specific questions | **customization** | personalization |
| ClawHQ itself | **agent platform** | distro, configuration layer |
| The product layers | **Platform / Blueprints / Cloud** | Distro / Template Engine / Cloud Service |
| The six modules | **design, build, secure, operate, evolve, cloud** | ClawSmith, ClawForge, ClawAdmin, ClawOps, ClawConstruct |

## Key Design Constraints

- **ClawHQ is the install** — Users don't install OpenClaw separately
- **Two acquisition paths** — Trusted cache (signed) or from source (zero-trust)
- **Security by default** — Container hardening applied automatically, not opt-in
- **Config generation must be correct** — All 14+ landmines auto-handled
- **Identity files are read-only** — Agents cannot modify their own personality
- **Credentials secured** — `credentials.json` mode 0600, `.env` mode 0600, never in config files
- **Data sovereignty** — Full portability (`export`), verified deletion (`destroy`), zero lock-in
- **Same platform everywhere** — User's PC, Mac Mini, DigitalOcean, Hetzner — same software, different host

## CLI Commands

```
# Install
clawhq install                — Full platform install (pre-reqs, engine, scaffold)
clawhq install --from-source  — Zero-trust: clone, audit, build from source

# Design
clawhq init --guided          — Interactive setup → choose blueprint, connect services
clawhq init --smart           — AI-powered config inference (local Ollama)
clawhq blueprint list         — Browse available blueprints
clawhq blueprint preview      — Preview a blueprint's operational design

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

# Evolve
clawhq skill install <source> — Install skill (with security vetting)
clawhq skill update/remove    — Update or remove installed skill
clawhq skill list             — List installed skills
clawhq evolve                 — Manage agent capabilities
clawhq export                 — Export portable agent bundle
clawhq destroy                — Verified agent destruction

# Cloud (optional)
clawhq cloud connect          — Link to clawhq.com for remote monitoring
clawhq cloud status           — Remote health dashboard
```

## Implementation Notes

- `docs/PRODUCT.md` — Product bible: user stories organized by module (design, build, secure, operate, evolve, cloud)
- `docs/ARCHITECTURE.md` — Architecture: six modules, ADs, zero-trust remote admin, package structure
- `docs/OPENCLAW-REFERENCE.md` — Engineering reference: OpenClaw internals, 14 landmines, config surfaces
- `backlog/GAP-ANALYSIS.md` — AS-IS/TO-BE comparison, 10 gaps identified
- `backlog/backlog.json` — Sprint-ready backlog, 6 parallel tracks

Key technical details:
- TypeScript throughout — matches OpenClaw's Node.js/TypeBox stack, shares schema types directly
- Tight coupling to OpenClaw — uses its config schema, WebSocket RPC, file paths, and container structure directly
- Deployment directory at `~/.clawhq/` — engine, workspace, ops, security, cron, cloud
- Two-stage Docker build: Stage 1 (base OpenClaw + apt packages), Stage 2 (custom tools + skills)
- Egress firewall uses dedicated iptables chain (`CLAWHQ_FWD`) on Docker bridge
- `doctor` is the hero feature — checks every known failure mode preventively
- Blueprints are complete agent designs (identity, security, tools, skills, cron, autonomy, memory, integrations)

## Key Source Layout (Target Architecture)

```
src/
├── cli/                        — Commander.js CLI (thin layer over modules)
│
├── design/                     — Blueprint engine (THE PRODUCT)
│   ├── blueprints/             — Blueprint library, loader, mapper, customizer
│   ├── configure/              — Setup wizard, generate, writer
│   ├── tools/                  — CLI tool generators (email, calendar, tasks, etc.)
│   └── identity/               — Identity file generators (AGENTS.md, HEARTBEAT.md, etc.)
│
├── build/                      — Install and deploy
│   ├── installer/              — Pre-reqs, engine acquisition, scaffold
│   ├── docker/                 — Two-stage build, compose, Dockerfile gen
│   └── launcher/               — Deploy orchestration (up/down/restart)
│
├── secure/                     — Security and compliance
│   ├── harden/                 — Container security overrides
│   ├── credentials/            — Credential store + health probes
│   ├── firewall/               — iptables CLAWHQ_FWD chain
│   ├── audit/                  — Audit logging (tool, secret, egress, cloud)
│   ├── scanner/                — PII + secret scanning
│   ├── sandbox/                — Tool execution sandbox
│   └── validate/               — 14 landmine rules
│
├── operate/                    — Monitoring and maintenance
│   ├── doctor/                 — Diagnostics + auto-fix
│   ├── monitor/                — Health monitoring daemon
│   ├── backup/                 — Encrypted backup/restore
│   ├── updater/                — Safe updates + rollback
│   ├── status/                 — Dashboard
│   └── logs/                   — Log streaming
│
├── evolve/                     — Grow the agent
│   ├── skills/                 — Skill install/update/remove + vetting
│   ├── capabilities/           — Capability evolution
│   ├── rollback/               — Change rollback
│   └── lifecycle/              — Export + destroy
│
├── cloud/                      — Remote monitoring + managed hosting
│   ├── agentd/                 — Managed mode daemon
│   ├── heartbeat/              — Health reporting
│   ├── commands/               — Command queue (pull, verify, execute)
│   └── fleet/                  — Multi-agent management
│
├── gateway/                    — OpenClaw Gateway communication (cross-cutting)
└── config/                     — Config types + schema (cross-cutting)
```

**Note:** Current source layout differs from target. The module reorganization is planned work (Track E).

## Sprint Orchestration (aishore)

This project uses [aishore](https://github.com/simonplant/aishore) for AI-assisted sprint management.

### Commands

```bash
.aishore/aishore run [count]        # Run N sprints (default: 1)
.aishore/aishore run FEAT-001       # Run specific feature
.aishore/aishore groom --backlog    # Product owner: groom features
.aishore/aishore review             # Architecture review
.aishore/aishore metrics            # Sprint metrics
```

**Note:** Do not modify aishore internals or `.aishore/` files directly. Report bugs and feature requests at [github.com/simonplant/aishore](https://github.com/simonplant/aishore/issues).
