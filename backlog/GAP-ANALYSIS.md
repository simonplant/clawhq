# ClawHQ Gap Analysis

> AS-IS vs TO-BE comparison, gap identification, and remediation plan.
> Generated 2026-03-17 from deep codebase scan + architecture review.

---

## AS-IS: What's Built

**~67,000 lines of TypeScript** across ~590 files. 77 test files. 40/43 backlog items complete. Built with AI-assisted development (Claude Code).

### Codebase State by Subsystem

| Subsystem | Status | Lines | Tests | Notes |
|---|---|---|---|---|
| CLI (78 commands) | COMPLETE | 7,354 | 7 | All commands wired |
| Config (schema, validator, loader) | COMPLETE | 1,591 | 3 | All 14 landmine rules |
| Init (wizard, generate, writer) | COMPLETE | 2,328 | 4 | Full bundle generation |
| Docker (build, hardening, compose) | COMPLETE | 1,412 | 4 | Two-stage build |
| Deploy (orchestration, preflight) | COMPLETE | 11,718 | 3 | Full lifecycle |
| Doctor (14+ checks, auto-fix) | COMPLETE | 1,926 | 4 | 14+ diagnostic checks |
| Security (secrets, firewall, creds, vetting) | COMPLETE | 3,498 | 7 | Full hardening |
| Backup (encrypted, restore) | COMPLETE | 2,161 | 5 | GPG snapshots |
| Skills (lifecycle, vetting, catalog) | COMPLETE | 2,387 | 4 | 6 built-in skills |
| Workspace tools (7 generators) | COMPLETE | 3,038 | 2 | email, tasks, todoist, ical, quote, tavily, todoist-sync |
| Workspace identity (5 generators) | COMPLETE | 568 | 2 | AGENTS, HEARTBEAT, TOOLS, IDENTITY, MEMORY |
| Status dashboard | COMPLETE | 1,624 | 4 | Agent, integrations, workspace, egress |
| Audit (tool trail, egress) | COMPLETE | 7,859 | 2 | JSONL + OWASP compliance |
| Gateway (WebSocket RPC) | COMPLETE | 1,248 | 3 | Full error handling |
| Templates (YAML loader, mapper) | COMPLETE | 1,235 | 1 | 6 built-in blueprints |
| Update (version check, rollback) | COMPLETE | 1,264 | 4 | GitHub releases |
| Export (portable bundle) | COMPLETE | 1,446 | 1 | PII masking |
| Destroy (verified wipe) | COMPLETE | 1,271 | 1 | Crypto manifest |
| Approval queue | COMPLETE | 2,066 | 1 | Telegram integration |
| Notifications (Telegram, Slack, webhook) | COMPLETE | 1,424 | 1 | Multi-channel |
| Alerts (predictive health) | COMPLETE | 1,425 | 5 | Trend analysis |
| Fleet management | COMPLETE | 1,425 | 4 | Discovery, aggregation |
| Provider management | COMPLETE | 1,245 | 1 | Add/remove/test |
| Integration management | COMPLETE | 1,128 | 2 | Add/remove/swap |
| Repair/self-healing | COMPLETE | 1,413 | 5 | Auto-fix issues |
| Logs streaming | COMPLETE | 506 | 1 | Category filtering |
| Connect (channel setup) | COMPLETE | 1,419 | 2 | Telegram, WhatsApp |
| Smoke tests | COMPLETE | 567 | 1 | Post-deploy verification |
| Source acquisition | COMPLETE | 644 | 1 | Clone, pin, verify |
| Inference (--smart) | COMPLETE | 1,362 | 3 | Ollama integration |
| Server (web dashboard) | COMPLETE | 1,476 | 4 | Hono framework |
| Internal/memory | COMPLETE | 3,546 | 8 | Full lifecycle, agent integration TBD |
| Internal/autonomy | COMPLETE | 1,224 | 4 | Recommendation engine |
| Internal/learning | COMPLETE | 1,434 | 3 | Preference learning |
| Internal/trace | COMPLETE | 1,088 | 3 | Decision explanation |
| Internal/migration | COMPLETE | 2,019 | 6 | ChatGPT + Google import |
| Role system | COMPLETE | 7,508 | 1 | Profile presets |
| Tool management | COMPLETE | 1,297 | 3 | Install/remove |
| Service management | COMPLETE | 483 | 1 | Postgres, redis, qdrant |
| Digest/activity | COMPLETE | 947 | 1 | Daily summary |
| Cloud | STUB | 3 | 0 | Single placeholder file |
| UI components | SCAFFOLD | ~200 | 0 | Structure only |

### Current Source Organization (post-reorganization)

```
src/
├── cli/                         — 33 command handlers
├── config/                      — schema, validator, loader, generator
├── gateway/                     — websocket, health, config-rpc
├── server/                      — hono server, routes
├── ui/                          — web dashboard scaffold
│
├── design/                      — Blueprint engine
│   ├── blueprints/              — loader, mapper, preview
│   ├── configure/               — wizard, generate, steps, writer
│   ├── tools/                   — email, tasks, todoist, ical, etc.
│   ├── identity/                — agents, heartbeat, memory, tools-doc
│   ├── inference/               — ollama, prompt, parser
│   ├── connect/                 — telegram, whatsapp
│   ├── governance/              — identity governance, review
│   ├── roles/                   — presets
│   └── provider/                — add, remove, test, registry
│
├── build/                       — Install and deploy
│   ├── docker/                  — build, hardening, compose, dockerfile
│   ├── launcher/                — deploy, preflight
│   ├── smoke/                   — checks, runner
│   ├── service/                 — backing services
│   └── source/                  — clone, pin, verify
│
├── secure/                      — Security and compliance
│   ├── credentials/             — store, probes
│   ├── firewall/                — iptables management
│   ├── secrets/                 — scanner, env, encrypted store
│   └── audit/                   — tool-trail, egress
│
├── operate/                     — Monitoring and maintenance
│   ├── doctor/                  — runner, fix, 11 check files
│   ├── alerts/                  — metrics, threshold, trending
│   ├── repair/                  — detect, fix, logging
│   ├── backup/                  — backup, restore, manifest
│   ├── updater/                 — version, changelog, rollback
│   ├── status/                  — collector, dashboard
│   ├── logs/                    — stream, cron-history
│   ├── digest/                  — collector, formatter
│   ├── notifications/           — telegram, slack, webhook
│   └── approval/                — queue, resolver
│
├── evolve/                      — Grow the agent
│   ├── skills/                  — lifecycle, catalog, registry, vet
│   ├── tools/                   — install, remove
│   ├── integrate/               — add, remove, swap
│   ├── autonomy/                — recommendation engine
│   ├── learning/                — preference learning
│   ├── memory/                  — full lifecycle
│   ├── trace/                   — decision explanation
│   ├── migrate/                 — ChatGPT, Google import
│   └── lifecycle/               — export, destroy
│
└── cloud/                       — Remote monitoring
    └── fleet/                   — discovery, dashboard, doctor
```

---

## TO-BE: The Target Architecture

Six modules, three layers. See `docs/ARCHITECTURE.md`.

```
src/
├── cli/                         — Thin CLI layer (unchanged)
│
├── design/                      — THE PRODUCT: blueprint engine
│   ├── blueprints/              — Blueprint library, loader, mapper
│   ├── configure/               — Wizard, generate, writer
│   ├── tools/                   — CLI tool generators
│   ├── identity/                — Identity file generators
│   ├── inference/               — Smart config (Ollama)
│   ├── connect/                 — Channel setup
│   ├── governance/              — Identity governance
│   ├── roles/                   — Role presets
│   └── provider/                — LLM provider management
│
├── build/                       — Install and deploy
│   ├── docker/                  — Two-stage build, compose, Dockerfile
│   ├── launcher/                — Deploy orchestration
│   ├── smoke/                   — Post-deploy verification
│   ├── service/                 — Backing services
│   ├── source/                  — Source acquisition
│   └── installer/               — (future: distro installer)
│
├── secure/                      — Security and compliance
│   ├── credentials/             — Credential store + probes
│   ├── firewall/                — iptables management
│   ├── secrets/                 — Secret scanning + storage
│   └── audit/                   — Audit logging
│
├── operate/                     — Monitoring and maintenance
│   ├── doctor/                  — Diagnostics + auto-fix
│   ├── alerts/                  — Predictive health alerts
│   ├── repair/                  — Self-healing
│   ├── backup/                  — Encrypted backup/restore
│   ├── updater/                 — Safe updates + rollback
│   ├── status/                  — Dashboard
│   ├── logs/                    — Log streaming
│   ├── digest/                  — Daily summary
│   ├── notifications/           — Multi-channel notifications
│   └── approval/                — Approval queue
│
├── evolve/                      — Grow the agent
│   ├── skills/                  — Skill lifecycle + vetting
│   ├── tools/                   — Tool install/remove
│   ├── integrate/               — Integration management
│   ├── autonomy/                — Autonomy recommendations
│   ├── learning/                — Preference learning
│   ├── memory/                  — Memory management
│   ├── trace/                   — Decision explanation
│   ├── migrate/                 — Platform migration
│   └── lifecycle/               — Export + destroy
│
├── cloud/                       — Remote monitoring + managed hosting
│   └── fleet/                   — Multi-agent management
│   (agentd/, heartbeat/, commands/ — future work)
│
├── gateway/                     — Cross-cutting: OpenClaw communication
├── config/                      — Cross-cutting: types + schema
├── server/                      — Cross-cutting: web dashboard
└── ui/                          — Cross-cutting: web UI
```

---

## GAP ANALYSIS

### GAP 1: Source Reorganization (AS-IS → TO-BE module structure) — DONE

**Status:** COMPLETE. All 40+ flat directories reorganized into 6 modules (`design/`, `build/`, `secure/`, `operate/`, `evolve/`, `cloud/`) plus cross-cutting (`cli/`, `gateway/`, `config/`, `server/`, `ui/`). 368 files moved, 300+ import paths rewritten, all 1745 tests passing.

| Old Location | Module | New Location |
|---|---|---|
| `init/`, `templates/`, `workspace/tools/`, `workspace/identity/`, `inference/`, `connect/`, `identity/`, `role/`, `provider/` | design | `design/` |
| `doctor/`, `status/`, `backup/`, `update/`, `logs/`, `alerts/`, `repair/`, `digest/`, `notifications/`, `approval/` | operate | `operate/` |
| `security/`, `audit/` | secure | `secure/` |
| `skill/`, `tool/`, `export/`, `destroy/`, `internal/`, `integrate/` | evolve | `evolve/` |
| `docker/`, `deploy/`, `source/`, `smoke/`, `service/` | build | `build/` |
| `fleet/` | cloud | `cloud/` |

### GAP 2: Distro Installer (build — does not exist)

**Current:** No installer. User must manually install OpenClaw, Node.js, Docker.
**Target:** `clawhq install` — one command that handles pre-reqs, acquires engine, scaffolds distro directory.
**Impact:** CRITICAL — this is the entry point. Without it, ClawHQ isn't a distro.

Missing components:
- Pre-requisite detection and guided install (Docker, Node.js, Ollama)
- Engine acquisition from trusted cache (signed, hash-verified)
- Engine acquisition from source (clone, audit, build)
- GPG signature verification
- Deployment directory scaffolding (`~/.clawhq/` structure)
- `clawhq.yaml` meta-config creation

### GAP 3: Distro Directory Structure (not implemented)

**Current:** Files go to `~/.openclaw/` (OpenClaw's default location).
**Target:** `~/.clawhq/` with `engine/`, `workspace/`, `ops/`, `security/`, `cron/`, `cloud/`.
**Impact:** HIGH — all file path references change.

Missing:
- `~/.clawhq/clawhq.yaml` meta-config
- `~/.clawhq/engine/` containing OpenClaw runtime files
- `~/.clawhq/ops/` containing operational tooling config
- `~/.clawhq/security/posture.yaml`
- `~/.clawhq/cloud/` for cloud connection
- Migration path from `~/.openclaw/` to `~/.clawhq/`

### GAP 4: Blueprint Engine Expansion (design — partially exists)

**Current:** 6 built-in blueprints (Guardian, Assistant, Coach, Analyst, Companion, Custom). Blueprint system works but limited.
**Target:** "Use-case blueprints for specific jobs (email manager, stock trading, meal planning, blog maintenance, etc.).
**Impact:** HIGH — this is THE PRODUCT. More blueprints = more value.

Missing:
- Use-case blueprint library (email manager, stock trading assist, meal planner, AI blog maintainer, family hub, founder's ops, etc.)
- Blueprint customizer (ask preferences, customize blueprint)
- Blueprint library infrastructure
- Blueprint contribution/submission pipeline

### GAP 5: credentials.json Store (not implemented)

**Current:** Secrets in `.env` only.
**Target:** `credentials.json` (mode 0600) for integration credentials, separate from `.env` for environment secrets.
**Impact:** MEDIUM — cleaner separation of concerns.

### GAP 6: Zero-Trust Remote Admin Protocol (not implemented)

**Current:** Cloud is a 3-line stub.
**Target:** Full zero-trust remote admin with three trust modes, command queue, cryptographic signing, architectural content blocking.
**Impact:** CRITICAL for managed service. Not needed for self-managed launch.

Missing:
- `agentd` daemon
- Command queue (pull, verify, execute/reject)
- Cryptographic command signing + verification
- Trust mode management (paranoid/zero-trust/managed)
- Cloud audit trail (`ops/audit/cloud.jsonl`)
- Kill switch (`clawhq cloud disconnect`)
- Health heartbeat protocol

### GAP 7: Managed Hosting Infrastructure (not implemented)

**Current:** No managed hosting capability.
**Target:** Provision VMs (DigitalOcean, Hetzner), install distro, run agentd, web console.
**Impact:** CRITICAL for the business. Not needed for self-managed launch.

Missing:
- VM provisioning (cloud-init templates)
- DNS + SSL automation
- Web console (separate frontend app)
- Account management + billing
- agentd ↔ console communication protocol

### GAP 8: Additional CLI Tool Generators

**Current:** 7 tools (email, tasks, todoist, ical, quote, tavily, todoist-sync).
**Target:** Use-case-specific tools (travel, meals, blog publishing, etc.) driven by templates.
**Impact:** MEDIUM — expands what agents can do.

### GAP 9: Web Dashboard UI

**Current:** Hono server scaffolded, UI components are stubs.
**Target:** Functional local web dashboard for visual management.
**Impact:** MEDIUM — CLI works, dashboard is polish.

### GAP 10: Agent Runtime Integration for Internal Systems

**Current:** Memory, learning, autonomy, trace subsystems have full logic but no integration path to the running agent.
**Target:** These systems observe and influence agent behavior at runtime.
**Impact:** MEDIUM — the systems work standalone but aren't wired to the agent.

---

## REMEDIATION PRIORITY

### Phase 1: Ship the Platform (self-managed launch)

| Priority | Gap | Work |
|---|---|---|
| P0 | GAP 2: Installer | Build `clawhq install` end-to-end |
| P0 | GAP 3: Deployment directory | Implement `~/.clawhq/` structure + migration |
| P0 | GAP 4: Blueprint expansion | 8-10 use-case blueprints |
| P1 | GAP 5: credentials.json | Separate credential store |
| P1 | GAP 1: Source reorg | Move to module structure |
| P1 | GAP 8: More tools | Blueprint-driven tool generators |

### Phase 2: Ship the Cloud (managed service)

| Priority | Gap | Work |
|---|---|---|
| P0 | GAP 6: Remote admin protocol | Zero-trust command queue + signing |
| P0 | GAP 7: Managed hosting | agentd + provisioning + console |
| P1 | GAP 9: Web dashboard | Local UI for self-managed users |

### Phase 3: Ecosystem

| Priority | Gap | Work |
|---|---|---|
| P1 | GAP 4: Blueprint library | Community contributions |
| P2 | GAP 10: Agent runtime integration | Wire internal systems to agent |
