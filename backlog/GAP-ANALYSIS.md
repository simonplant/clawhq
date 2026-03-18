# ClawHQ Gap Analysis

> AS-IS vs TO-BE comparison, gap identification, and remediation plan.
> Generated 2026-03-17 from deep codebase scan + architecture review.

---

## AS-IS: What's Built

**90,768 lines of TypeScript** across 436 files. 132 test files. 40/43 backlog items complete. Production-grade implementations across all major subsystems.

### Codebase State by Subsystem

| Subsystem | Status | Lines | Tests | Notes |
|---|---|---|---|---|
| CLI (33 commands) | COMPLETE | 7,354 | 7 | All commands wired |
| Config (schema, validator, loader) | COMPLETE | 1,591 | 3 | All 14 landmine rules |
| Init (wizard, generate, writer) | COMPLETE | 2,328 | 4 | Full bundle generation |
| Docker (build, hardening, compose) | COMPLETE | 1,412 | 4 | Two-stage build |
| Deploy (orchestration, preflight) | COMPLETE | 11,718 | 3 | Full lifecycle |
| Doctor (11 checks, auto-fix) | COMPLETE | 1,926 | 4 | 11 diagnostic checks |
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

### Current Source Organization

```
src/
├── cli/          — 33 command handlers (monolithic)
├── config/       — schema, validator, loader, generator
├── init/         — wizard, generate, steps, writer, detect
├── docker/       — build, hardening, compose, dockerfile
├── deploy/       — deploy orchestration, preflight
├── doctor/       — runner, fix, 11 check files
├── security/     — secrets/, credentials/, firewall/, vetting
├── workspace/    — tools/, identity/, skills/
├── templates/    — loader, mapper, preview
├── gateway/      — websocket, health, config-rpc
├── status/       — collector, agent, integrations, workspace
├── backup/       — backup, restore, manifest, snapshot
├── update/       — version, changelog, rollback
├── skill/        — lifecycle, catalog, registry, vet
├── audit/        — tool-trail, egress, appender, reader
├── export/       — bundle, manifest, pii-mask
├── destroy/      — destroy, manifest, confirmation
├── internal/     — memory/, learning/, autonomy/, trace/, migrate/
├── alerts/       — metrics, threshold, trending
├── approval/     — queue, resolver, notifications
├── notifications/— telegram, slack, webhook, email
├── fleet/        — discovery, dashboard, doctor
├── integrate/    — add, remove, swap
├── provider/     — add, remove, test, registry
├── connect/      — telegram, whatsapp, channel-health
├── repair/       — detect, fix, logging
├── smoke/        — checks, runner
├── inference/    — ollama, prompt, parser
├── server/       — hono server, routes
├── logs/         — stream, cron-history
├── source/       — clone, pin, verify
├── digest/       — collector, formatter
├── service/      — backing services
├── role/         — presets
├── tool/         — install, remove
├── cloud/        — stub
└── ui/           — scaffold
```

---

## TO-BE: The Target Architecture

Six modules, three layers. See `docs/ARCHITECTURE.md`.

```
src/
├── cli/                — Thin CLI layer (unchanged)
│
├── smith/              — ClawSmith: THE PRODUCT
│   ├── templates/      — Recipe library, loader, mapper, personalizer
│   ├── configure/      — Wizard, generate, writer
│   ├── tools/          — CLI tool generators
│   └── identity/       — Identity file generators
│
├── ops/                — ClawOps: keep it alive
│   ├── doctor/         — Diagnostics + auto-fix
│   ├── monitor/        — Health monitoring
│   ├── backup/         — Encrypted backup/restore
│   ├── updater/        — Safe updates + rollback
│   ├── status/         — Dashboard
│   └── logs/           — Log streaming
│
├── admin/              — ClawAdmin: lock it down
│   ├── harden/         — Container security
│   ├── credentials/    — Credential store + probes
│   ├── firewall/       — iptables management
│   ├── audit/          — Audit logging
│   ├── scanner/        — PII + secret scanning
│   ├── sandbox/        — Tool execution sandbox
│   └── validate/       — 14 landmine rules
│
├── construct/          — ClawConstruct: grow it
│   ├── skills/         — Skill lifecycle + vetting
│   ├── evolve/         — Capability evolution
│   ├── rollback/       — Change rollback
│   └── lifecycle/      — Export + destroy
│
├── forge/              — ClawForge: build it
│   ├── installer/      — Pre-reqs, engine acquisition, scaffold
│   ├── docker/         — Two-stage build, compose, Dockerfile
│   └── launcher/       — Deploy orchestration
│
├── cloud/              — ClawHQ Cloud: the business
│   ├── agentd/         — Managed mode daemon
│   ├── heartbeat/      — Health reporting
│   ├── commands/       — Command queue (pull, verify, execute)
│   └── fleet/          — Multi-agent management
│
├── gateway/            — Cross-cutting: OpenClaw communication
└── config/             — Cross-cutting: types + schema
```

---

## GAP ANALYSIS

### GAP 1: Source Reorganization (AS-IS → TO-BE module structure)

**Current:** 40+ flat directories under `src/`. No module boundaries.
**Target:** Six modules (`smith/`, `ops/`, `admin/`, `construct/`, `forge/`, `cloud/`).
**Impact:** HIGH — every import path changes. Must be done carefully with barrel exports.
**Risk:** Low (all code exists, just needs moving + re-exporting).

| Current Location | Target Module | Target Location |
|---|---|---|
| `init/`, `templates/`, `workspace/tools/`, `workspace/identity/`, `inference/` | ClawSmith | `smith/` |
| `doctor/`, `status/`, `backup/`, `update/`, `logs/`, `alerts/`, `repair/`, `digest/` | ClawOps | `ops/` |
| `security/`, `audit/` | ClawAdmin | `admin/` |
| `skill/`, `tool/`, `export/`, `destroy/`, `internal/`, `role/` | ClawConstruct | `construct/` |
| `docker/`, `deploy/`, `source/`, `smoke/` | ClawForge | `forge/` |
| `cloud/`, `fleet/`, `notifications/` | ClawHQ Cloud | `cloud/` |
| `connect/`, `integrate/`, `provider/`, `service/`, `approval/` | Cross-cutting or Smith | TBD |

### GAP 2: Distro Installer (ClawForge — does not exist)

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

### GAP 4: Blueprint Engine Expansion (ClawSmith — partially exists)

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
