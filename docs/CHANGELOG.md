# Changelog

All notable changes to ClawHQ are documented in this file.

This changelog was reconstructed retroactively from build history, sprint records, and completion timestamps. The project does not yet use version tags — entries are organized by development phase instead.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

---

## Phase 3: Cloud & Documentation — 2026-03-20 to 2026-03-23

Cloud provisioning, deployment automation, and project documentation.

### Added

- Cloud provisioning engine — spin up agents on DigitalOcean, AWS, GCP, and Hetzner from CLI (2026-03-20)
- DigitalOcean provider adapter with droplet lifecycle management (2026-03-20)
- AWS provider adapter — EC2 instances with cloud-init bootstrap (2026-03-20)
- GCP provider adapter — Compute Engine instances with cloud-init (2026-03-20)
- Hetzner Cloud provider adapter — CX series servers with cloud-init (2026-03-20)
- `clawhq deploy` — unified cloud deployment command across all providers (2026-03-23)
- Cloud-init bootstrap template for automated agent provisioning (2026-03-20)
- Pre-built VM snapshots for sub-60-second provisioning (2026-03-20)
- `clawhq demo` — zero-config working agent in 60 seconds (2026-03-20)
- `clawhq demo --cloud` — zero-config cloud demo deployment (2026-03-20)
- `docs/QUICKSTART.md` — install to working agent in under 10 minutes (2026-03-23)
- `docs/PROBLEMS.md` — why OpenClaw is hard and what ClawHQ fixes (2026-03-23)
- `docs/ROADMAP.md` — public-facing roadmap from internal planning docs (2026-03-23)
- `docs/CONTRIBUTING.md` — how to contribute blueprints, skills, and code (2026-03-23)
- Skill system section added to `docs/ARCHITECTURE.md` (2026-03-23)

### Fixed

- AWS credential validation no longer exposes full access key ID — now masked (2026-03-23)
- AWS token parsing no longer silently sets `secretKey` to `undefined` on malformed input (2026-03-23)
- GCP adapter `JSON.parse` on service account token now wrapped in try-catch (2026-03-23)
- Hetzner adapter `parseInt` on droplet IDs no longer propagates `NaN` into API requests (2026-03-23)
- Provider adapters now handle malformed API responses without crashing (2026-03-23)
- Cloud provider poll intervals standardized across all adapters (2026-03-23)

---

## Phase 2: Blueprints & Skills — 2026-03-19

The blueprint engine, 7 use-case blueprints, skill system, and 6 built-in skills. This is the product layer — everything else is infrastructure.

### Added

- Blueprint loader + validator with 70+ validation checks (~1,235 lines) (2026-03-19)
- Email Manager blueprint YAML — inbox zero, triage, auto-reply, morning digest (2026-03-19)
- 6 additional blueprint YAMLs: Stock Trading Assistant, Meal Planner, AI Blog Maintainer, Replace Google Assistant, Founder's Ops, Family Hub (2026-03-19)
- Blueprint personalizer — blueprint-specific customization questions during setup (2026-03-19)
- Init wizard + config generation + writer — guided setup from blueprint to valid config (2026-03-19)
- Identity file generators — SOUL.md, AGENTS.md, HEARTBEAT.md, IDENTITY.md, MEMORY.md (~568 lines) (2026-03-19)
- Workspace tool generators — email, tasks, todoist, ical, quote, tavily, todoist-sync (~3,038 lines) (2026-03-19)
- Skill lifecycle management + security vetting (~2,387 lines) (2026-03-19)
- Skill: email-digest — inbox triage, categorize, draft responses on 15-minute schedule (2026-03-19)
- 5 additional skills: morning-brief, market-scan, meal-plan, schedule-guard, investor-update (2026-03-19)
- AI-powered config inference via `clawhq init --smart` with local Ollama (~1,362 lines) (2026-03-19)
- `clawhq blueprint list` + `clawhq blueprint preview` commands (2026-03-19)
- Integration + provider management + role system (~9,933 lines) (2026-03-19)
- Tool installation framework for workspace tool lifecycle (~1,297 lines) (2026-03-19)

---

## Phase 1: Foundation & Platform — 2026-03-12 to 2026-03-19

Core infrastructure: config schema, security hardening, deploy pipeline, operational tooling, and the evolve subsystem. 90,768 lines of TypeScript across 436 files with 132 test files.

### Added

- Config schema + 14 landmine validator — enforces all OpenClaw landmine rules at the schema level (~1,591 lines) (2026-03-18)
- Gateway WebSocket RPC client — token-authenticated communication with OpenClaw Gateway (~1,248 lines) (2026-03-18)
- CLI entry point with 33 commands + UX helpers (~7,354 lines) (2026-03-19)
- Docker two-stage build + container hardening — Stage 1 base image caching, Stage 2 fast rebuild, 4 security postures (~1,412 lines) (2026-03-18)
- Deploy orchestration + preflight checks — `clawhq up` with 6 preflight checks, health verify, smoke test (~11,718 lines) (2026-03-19)
- Egress firewall — dedicated iptables chain (`CLAWHQ_FWD`), per-integration domain allowlist, air-gap mode (2026-03-19)
- Secrets management — atomic .env writes with 0600 permissions (2026-03-19)
- Credential health probes — Anthropic, OpenAI, Telegram integration validation (2026-03-19)
- PII + secrets scanner — pattern-based detection with false-positive filtering (~3,498 lines across security subsystem) (2026-03-19)
- Audit trail — tool execution, secret lifecycle (HMAC-chained), egress logging (~7,859 lines) (2026-03-19)
- Doctor diagnostics + auto-fix — 14+ preventive checks covering all known failure modes (~1,926 lines) (2026-03-19)
- `clawhq install` — pre-req detection + deployment directory scaffold (2026-03-19)
- `clawhq install --from-source` — zero-trust path: clone, audit, build from source (~644 lines) (2026-03-19)
- `~/.clawhq/` deployment directory structure — engine, workspace, ops, security, cron, cloud (2026-03-19)
- Encrypted backup + restore — GPG-encrypted snapshots with integrity verification (~2,161 lines) (2026-03-19)
- Status dashboard + logs streaming + safe updates with rollback (~3,394 lines) (2026-03-19)
- Approval queue — action review and consent via Telegram (~2,066 lines) (2026-03-19)
- Messaging channel connection — Telegram and WhatsApp setup (~1,419 lines) (2026-03-19)
- Notifications — Telegram, Slack, webhook multi-channel alerts (~1,424 lines) (2026-03-19)
- Predictive health alerts with trend analysis (~1,425 lines) (2026-03-19)
- Health self-repair — automatic issue detection and fix (~1,413 lines) (2026-03-19)
- Activity digest — daily summary generation (~947 lines) (2026-03-19)
- Export + destroy — portable agent bundle with PII masking, verified destruction with crypto manifest (~2,717 lines) (2026-03-19)
- Memory lifecycle — hot/warm/cold tiers with full agent integration (~3,546 lines) (2026-03-19)
- Autonomy recommendation engine (~1,224 lines) (2026-03-19)
- Preference learning (~1,434 lines) (2026-03-19)
- Decision trace — "why did you do that?" explanation system (~1,088 lines) (2026-03-19)
- Migration import — ChatGPT and Google Assistant data import (~2,019 lines) (2026-03-19)
- Trust modes + heartbeat + command queue for cloud integration (2026-03-19)
- Fleet management — multi-agent discovery and aggregation (~1,425 lines) (2026-03-19)
- Web dashboard — Hono server + 7 pages (doctor, logs, approvals, init, etc.) (~1,476 lines) (2026-03-19)
- Air-gapped mode — fully offline operation with no egress (2026-03-19)
- Post-deploy smoke tests (~567 lines) (2026-03-19)
- Quickstart flow — init → build → deploy → verify (2026-03-19)

### Fixed

- 58 bugs fixed across all subsystems during platform stabilization (2026-03-19 to 2026-03-20)
