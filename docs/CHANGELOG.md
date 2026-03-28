# Changelog

All notable changes to ClawHQ are documented in this file.

This changelog was reconstructed retroactively from build history, sprint records, and completion timestamps. The project does not yet use version tags — entries are organized by development phase instead. ClawHQ is built with AI-assisted development (Claude Code). The compressed timeline reflects this methodology.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

---

## Phase 4: Hardening & Documentation — 2026-03-23 to 2026-03-24

Security hardening, cloud deployment updates, and project documentation.

### Added

- `clawhq deploy update` — push config changes, version upgrades, and skill installs to cloud-deployed agents via SSH (2026-03-24)
- `docs/QUICKSTART.md` — install to working agent in under 10 minutes (2026-03-24)
- `docs/CONFIGURATION.md` — blueprint schema, skill schema, every config option (2026-03-24)
- `docs/PROBLEMS.md` — why OpenClaw is hard and what ClawHQ fixes (2026-03-24)
- `docs/ROADMAP.md` — public-facing roadmap from internal planning docs (2026-03-24)
- `docs/CONTRIBUTING.md` — how to contribute blueprints, skills, and code (2026-03-24)
- Skill system section in `docs/ARCHITECTURE.md` — lifecycle, config.yaml schema, boundary enforcement, built-in skills reference (2026-03-24)

### Fixed

- 35 file permission fixes ensuring all directories use mode 0700 and all sensitive files use mode 0600: instance registry, .env parent, cloud/, security/, backup snapshots, approval queue, memory tiers, audit logs, export bundles, restore temp directories, capability rollback snapshots, skill/tool/role manifests, fleet registry, posture config, sanitizer logs, and commands.json (BUG-074 through BUG-108, 2026-03-23)
- AWS credential validation no longer exposes full access key ID — now masked (BUG-071, 2026-03-23)
- AWS token parsing no longer silently sets `secretKey` to `undefined` on malformed input (BUG-066, 2026-03-23)
- GCP adapter `JSON.parse` on service account token now wrapped in try-catch (BUG-067, 2026-03-23)
- Hetzner adapter `parseInt` on droplet IDs no longer propagates `NaN` into API requests (BUG-068, 2026-03-23)
- Provider adapters now handle malformed API responses without crashing (BUG-062, 2026-03-23)
- SSH keypair generation and storage for deploy update; private key cleanup on destroy; key directory mode 0700; orphaned key cleanup on firewall failure; StrictHostKeyChecking enforced (BUG-072, BUG-076, BUG-077, BUG-079, BUG-080, 2026-03-23)
- Cloud adapter initialization exceptions caught in `resolveAdapter()` (BUG-075, 2026-03-23)
- Cloud provider poll intervals standardized to 5s across all adapters (BUG-069, 2026-03-24)
- Cloud provisioning timeout constants centralized in `config/defaults.ts` (BUG-070, 2026-03-24)

---

## Phase 3: Cloud — 2026-03-19 to 2026-03-20

Cloud provisioning engine, 4 provider adapters, fleet management, trust modes.

### Added

- Cloud provisioning engine — provider-agnostic interface for VM creation, cloud-init bootstrap, health polling, and instance registry (CQ-043, 2026-03-20)
- DigitalOcean provider adapter — DO API v2 droplet lifecycle, SSH key injection, firewall groups, cost transparency (CQ-044, 2026-03-20)
- AWS provider adapter — EC2 via AWS SDK v3, t3.micro free tier, security groups, AMI snapshots, region selection (CQ-045, 2026-03-20)
- GCP provider adapter — Compute Engine, e2-micro free tier, firewall rules, machine image snapshots (CQ-046, 2026-03-20)
- Hetzner Cloud provider adapter — CX22, firewall, snapshot support (2026-03-20)
- `clawhq deploy` — interactive flow: choose provider → credentials → region → blueprint → provision → deploy → verify → URL. Non-interactive mode for CI (CQ-047, 2026-03-20)
- Cloud-init bootstrap template — provider-agnostic script taking a bare VM to a running agent (CQ-048, 2026-03-20)
- Pre-built VM snapshots for sub-60-second provisioning (CQ-049, 2026-03-20)
- Trust modes — Paranoid (offline), Zero-Trust (outbound only, signed commands, user-approved), Managed (auto-approved ops, content architecturally blocked). Kill switch with no confirmation prompt (CQ-038, 2026-03-19)
- Signed command queue — pull, verify signature, execute or reject. Content access architecturally blocked (CQ-038, 2026-03-19)
- Health heartbeat — agent-initiated outbound reporting, never reports content (CQ-038, 2026-03-19)
- Fleet management — multi-agent discovery, health aggregation, fleet-wide doctor (~1,425 lines) (CQ-039, 2026-03-19)

---

## Phase 2: Blueprints & Skills — 2026-03-19

The blueprint engine, 7 use-case blueprints, skill system, and 6 built-in skills. This is the product layer.

### Added

- Blueprint loader + validator — YAML loader with 70+ validation checks, size limit enforcement (~1,235 lines) (CQ-009, 2026-03-19)
- Init wizard + config generation — guided setup from blueprint selection to landmine-free config, air-gapped mode support, atomic file writer (~2,328 lines) (CQ-010, 2026-03-19)
- Email Manager blueprint — reference blueprint with email + calendar + tasks tools, email-digest + morning-brief skills, 15min inbox cron, hardened security posture (CQ-017, 2026-03-19)
- 6 additional blueprints: Family Hub, Founder's Ops, Replace Google Assistant, Replace ChatGPT Plus, Replace my PA, Research Co-pilot (CQ-029, 2026-03-19)
- Blueprint personalizer — customization_questions field in blueprint schema, 1–3 tailored questions per blueprint (CQ-018, 2026-03-19)
- Identity file generators — SOUL.md, AGENTS.md generated from blueprint + wizard answers, read-only mount in container (~568 lines) (CQ-019, 2026-03-19)
- 7 workspace tool generators — email, tasks, todoist, ical, quote, tavily, todoist-sync (~3,038 lines) (CQ-020, 2026-03-19)
- AI config inference — `clawhq init --smart`: natural language → blueprint + integration selection via local Ollama (~1,362 lines) (CQ-033, 2026-03-19)
- Integration + provider + role management — `clawhq integrate`, `clawhq provider`, `clawhq role` commands (CQ-036, 2026-03-19)
- Skill lifecycle + vetting — stage → vet → approve → activate pipeline, rollback snapshots, URL trap detection (~2,387 lines) (CQ-021, 2026-03-19)
- Skill: email-digest — inbox triage, categorization, draft response proposal with approval gates, 15min cron, local Ollama only (CQ-022, 2026-03-19)
- 5 additional skills: morning-brief, market-scan, meal-plan, schedule-guard, investor-update (CQ-030, 2026-03-19)
- Tool installation framework — `clawhq tool install/list/remove` with automatic Stage 2 Docker rebuild (~1,297 lines) (CQ-031, 2026-03-19)
- Memory lifecycle — hot/warm/cold tiers, LLM-powered summarization, PII masking before cold storage (~3,546 lines) (CQ-034, 2026-03-19)
- Autonomy recommendation engine (~1,224 lines) (CQ-034, 2026-03-19)
- Preference learning (~1,434 lines) (CQ-034, 2026-03-19)
- Decision trace — "why did you do that?" explanation system (~1,088 lines) (CQ-034, 2026-03-19)
- Migration import — ChatGPT and Google Assistant data export parsing, preference extraction via Ollama, routine-to-cron mapping, PII masking (~2,019 lines) (CQ-035, 2026-03-19)

---

## Phase 1: Foundation & Platform — 2026-03-18 to 2026-03-19

Core infrastructure: config schema, gateway client, CLI, Docker build, security hardening, deploy pipeline, operational tooling.

### Added

- Config schema + 14 landmine validator — all OpenClaw landmine rules enforced at schema level, config loader with precedence merging (~1,591 lines) (CQ-001, 2026-03-18)
- Gateway WebSocket RPC client — token-authenticated communication with OpenClaw Gateway, typed errors, timeout handling (~1,248 lines) (CQ-002, 2026-03-18)
- CLI entry point — Commander.js flat CLI with 33 commands (AD-01), error handler, first-run detection (~7,354 lines) (CQ-013, 2026-03-19)
- `clawhq install` — pre-req detection (Docker, Node.js ≥20, Ollama), deployment directory scaffold (~644 lines) (CQ-014, 2026-03-19)
- `clawhq install --from-source` — zero-trust acquisition: clone, audit, build from source (CQ-015, 2026-03-19)
- `~/.clawhq/` deployment directory — configurable root, migration from `~/.openclaw/` (CQ-016, 2026-03-19)
- Docker two-stage build — Stage 1 base image caching, Stage 2 fast rebuild, hash-based change detection. 4 security postures (minimal, standard, hardened, paranoid) with cap_drop ALL, read-only rootfs, non-root UID 1000, ICC disabled (~1,412 lines) (CQ-003, 2026-03-18)
- Deploy orchestration — `clawhq up` with 6 preflight checks, compose, firewall, health verify, smoke test. Graceful shutdown and restart (~11,718 lines) (CQ-004, 2026-03-19)
- Egress firewall — dedicated iptables chain (`CLAWHQ_FWD`), per-integration domain allowlist, air-gap mode, auto-reapply after compose down (CQ-005, 2026-03-19)
- Messaging channel connection — `clawhq connect` for Telegram and WhatsApp with live health ping (~1,419 lines) (CQ-027, 2026-03-19)
- Quickstart orchestrator — `clawhq quickstart --blueprint`: install → init → build → deploy → connect → verify (CQ-028, 2026-03-19)
- Post-deploy smoke test — automated verification after deploy (~567 lines) (CQ-042, 2026-03-19)
- Secrets management — atomic .env writes (temp + rename) with 0600 permissions (CQ-007, 2026-03-19)
- Credential health probes — Anthropic, OpenAI, Telegram integration validation with actionable fix messages (CQ-008, 2026-03-19)
- PII + secrets scanner — pattern-based detection, false-positive filtering, git history scanning (CQ-006, 2026-03-19)
- Audit trail — tool execution (append-only JSONL), secret lifecycle (HMAC-chained), egress logging, OWASP compliance export (~7,859 lines) (CQ-023, 2026-03-19)
- `credentials.json` + `posture.yaml` — separate credential store (mode 0600), reviewable security posture config, rollback snapshots (CQ-037, 2026-03-19)
- Air-gapped mode — config-level zero egress + firewall-level block, doctor verification for both layers (CQ-041, 2026-03-19)
- Doctor diagnostics + auto-fix — 14+ preventive checks, table and JSON output (~1,926 lines) (CQ-011, 2026-03-19)
- Encrypted backup + restore — GPG-encrypted snapshots, SHA-256 integrity verification, post-restore doctor check (~2,161 lines) (CQ-012, 2026-03-19)
- Status dashboard + logs streaming + safe updates with rollback (~3,394 lines) (CQ-026, 2026-03-19)
- Approval queue — high-stakes action review via Telegram, resolution tracked in audit trail (~2,066 lines) (CQ-025, 2026-03-19)
- Notifications — Telegram, Slack, webhook multi-channel alerts (~1,424 lines) (CQ-032, 2026-03-19)
- Predictive health alerts with trend analysis (~1,425 lines) (CQ-032, 2026-03-19)
- Health self-repair — automatic recovery for container stopped/OOM (~1,413 lines) (CQ-032, 2026-03-19)
- Activity digest — daily summary generation (~947 lines) (CQ-032, 2026-03-19)
- Export + destroy — portable agent bundle with PII masking, verified destruction with crypto manifest (~2,717 lines) (CQ-024, 2026-03-19)
- Web dashboard — Hono + htmx + Pico CSS, 7 pages: home, doctor, logs, deploy, approvals, skills, init wizard (~1,476 lines) (CQ-040, 2026-03-19)

---

## Summary

| Metric | Value |
|---|---|
| **Total codebase** | ~67,000 lines of TypeScript across ~590 files |
| **Test coverage** | 77 test files |
| **Backlog completion** | 40+ items complete |
| **Blueprints** | 7 use-case blueprints |
| **Skills** | 6 built-in skills |
| **CLI commands** | 78 leaf commands (13 command groups) |
| **Cloud providers** | 4 (DigitalOcean, AWS, GCP, Hetzner) |
| **Security checks** | 14+ doctor diagnostics |
| **Development timeline** | 2026-03-18 to 2026-03-24 (AI-assisted) |
