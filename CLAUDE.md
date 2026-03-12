# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ClawHQ is a control panel for OpenClaw agents — the "cPanel for personal AI agents." It manages the full deployment lifecycle of OpenClaw agents: Plan, Build, Secure, Deploy, Operate, Evolve, and Decommission.

**Current status: Design phase.** No implementation code exists yet. The repository contains:
- `README.md` — Executive summary and positioning
- `product.md` — Comprehensive 900+ line design document covering all seven lifecycle phases, architecture, and implementation details

## Architecture

**Three-layer model:**
- **Layer 1 (Core Platform):** Universal security, monitoring, memory management, config safety, audit logging — same for every agent
- **Layer 2 (Templates):** Full operational profiles (Guardian, Assistant, Coach, Analyst, Companion) — like WordPress themes for agents. Templates can tighten Layer 1 security but never loosen it
- **Layer 3 (Integrations):** Provider abstraction — agents talk to "calendar" not "Google Calendar," enabling provider swaps without behavior changes

**Two delivery modes:**
- **ClawHQ Managed** — Hosted service with web console
- **ClawHQ Self-Operated** — Open-source CLI, user's own hardware

Both share identical toolchains.

## Key Design Constraints

- **Never pre-built images** — Always build from OpenClaw source for auditability
- **Security by default** — Container hardening (cap_drop ALL, read-only rootfs, non-root UID 1000, egress firewall) is mandatory, not optional
- **Config generation must be correct** — The Plan toolchain must make it impossible to produce a broken config; all 14+ known silent landmines must be auto-handled
- **Identity files are read-only** — Agents cannot modify their own personality or guardrails
- **Secrets in `.env` only** — Never in config files, never logged, never in unencrypted backups
- **Data sovereignty** — Full portability (`export`), verified deletion (`destroy`), zero lock-in

## CLI Commands (Planned)

```
clawhq init / template     — Plan phase (questionnaire, templates, config generation)
clawhq build               — Build phase (two-stage Docker build from source)
clawhq scan / creds / audit — Secure phase (PII scanning, credential health, audit logs)
clawhq up / down / restart / connect — Deploy phase
clawhq doctor / status / backup / update / logs — Operate phase
clawhq evolve / train      — Evolve phase
clawhq export / destroy    — Decommission phase
```

## Implementation Notes

When building this project, refer to `product.md` for detailed specifications on each toolchain. Key technical details:
- Two-stage Docker build: Stage 1 (base OpenClaw + apt packages), Stage 2 (custom tools + skills)
- Egress firewall uses dedicated iptables chain (`CLAWHQ_FWD`) on Docker bridge — must reapply after every `docker compose down`
- OpenClaw config is ~13,500 tokens across 11+ files; ~40% universal, ~60% personalized
- `doctor` is the hero feature — checks every known failure mode preventively
- Templates are YAML-based full operational profiles (personality, security, monitoring, memory, cron, autonomy, integrations, skills)

## Sprint Orchestration (aishore)

This project uses [aishore](https://github.com/simonweniger/aishore) for AI-assisted sprint management.

### Commands

```bash
# Sprints
.aishore/aishore run [count]        # Run N sprints (default: 1)
.aishore/aishore run FEAT-001       # Run specific item by ID
.aishore/aishore run --auto-commit  # Auto-commit after each sprint

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
