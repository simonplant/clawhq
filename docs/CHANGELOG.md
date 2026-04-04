# Changelog

All notable changes to ClawHQ are documented here as narratives — not version lists. Each entry tells the story of what changed, why it mattered, and what it means for operators. ClawHQ is built with AI-assisted development (Claude Code). The compressed timeline reflects this methodology.

This project does not yet use version tags. Entries are organized by development phase.

---

## Phase 4: Hardening & Documentation — 2026-03-23 to 2026-03-24

Phase 4 focused on two things: making the project harder to break, and making it possible for someone other than the author to understand it.

### Cloud deploy updates without reprovisioning

Before this change, pushing a config update to a cloud-deployed agent meant reprovisioning the entire VM. `clawhq deploy update` now pushes config changes, version upgrades, and skill installs via SSH — the agent stays running, the VM stays alive, and the update is atomic with rollback on failure.

### Documentation that teaches, not just documents

Five new docs shipped: a [quickstart guide](QUICKSTART.md) that gets you from zero to working agent in under 10 minutes, a [configuration reference](CONFIGURATION.md) covering every blueprint and skill option, a [problems guide](PROBLEMS.md) that explains why OpenClaw is hard (and what ClawHQ fixes), a public-facing [roadmap](ROADMAP.md), and a [contributing guide](../CONTRIBUTING.md). The architecture doc gained a full skill system section covering lifecycle, config schema, boundary enforcement, and built-in skill reference.

### 35 file permission fixes

A systematic audit of every file and directory ClawHQ creates found 35 paths that were more permissive than necessary. Instance registries, backup snapshots, approval queues, memory tiers, audit logs, export bundles, capability rollback snapshots, fleet registries, posture configs, sanitizer logs, and command queues — all now use mode 0700 for directories and 0600 for files. This is invisible to users but eliminates a class of local privilege escalation if the host is shared. (BUG-074 through BUG-108)

### Credential handling hardened

AWS credential validation no longer exposes the full access key ID in error output (BUG-071). AWS token parsing no longer silently sets `secretKey` to `undefined` on malformed input — it fails explicitly (BUG-066). GCP's service account JSON parsing is wrapped in try-catch instead of crashing the process (BUG-067). Hetzner's `parseInt` on droplet IDs no longer propagates `NaN` into API requests (BUG-068). Provider adapters handle malformed API responses without crashing (BUG-062). SSH keypair generation, storage, cleanup, and host key verification are now correct across the full lifecycle (BUG-072, BUG-076, BUG-077, BUG-079, BUG-080).

### Cloud infrastructure stabilized

Cloud adapter initialization exceptions are caught in `resolveAdapter()` instead of crashing the CLI (BUG-075). Poll intervals are standardized to 5 seconds across all four provider adapters — no more inconsistent wait times (BUG-069). Timeout constants are centralized in `config/defaults.ts` instead of scattered as magic numbers (BUG-070).

---

## Phase 3: Cloud — 2026-03-19 to 2026-03-20

Phase 3 extended ClawHQ from a local tool to a platform that can deploy and manage agents on cloud infrastructure — without sacrificing the sovereignty model.

### Cloud provisioning: from bare VM to running agent

The provisioning engine provides a provider-agnostic interface for creating VMs, bootstrapping OpenClaw via cloud-init, polling for health, and tracking instances in a local registry. Four provider adapters shipped: DigitalOcean (API v2, SSH key injection, firewall groups, cost transparency), AWS (EC2 via SDK v3, t3.micro free tier, security groups, AMI snapshots), GCP (Compute Engine, e2-micro free tier, firewall rules, machine image snapshots), and Hetzner Cloud (CX22, firewall, snapshot support).

`clawhq deploy` walks through the full flow interactively — choose provider, enter credentials, select region, pick blueprint, provision, deploy, verify, get URL. A non-interactive mode supports CI pipelines. Pre-built VM snapshots enable sub-60-second provisioning for repeat deployments.

### Trust modes: three levels of cloud involvement

The cloud layer is optional by design. Three trust modes control how much (if any) cloud communication happens. **Paranoid** mode has zero network communication — the agent is fully offline. **Zero-Trust** mode allows outbound-only communication with signed commands that require user approval. **Managed** mode auto-approves operational commands but architecturally blocks content access — no handler exists for content operations, making it impossible (not just unauthorized) to read user data remotely. A kill switch disconnects immediately with no confirmation prompt.

### Fleet management

Multi-agent discovery, health aggregation, and fleet-wide doctor checks (~1,425 lines). Operators managing agents for multiple people or use cases get a single view of all agents and can diagnose issues across the fleet.

---

## Phase 2: Blueprints & Skills — 2026-03-19

Phase 2 shipped the product layer — the thing that makes ClawHQ more than infrastructure tooling.

### Blueprints: the agent design system

Blueprints are complete agent designs — identity, tools, skills, cron jobs, integrations, security posture, autonomy level, memory config, model routing, and egress rules. Seven shipped: Email Manager (the reference blueprint — email + calendar + tasks tools, email-digest + morning-brief skills, 15-minute inbox cron, hardened security), Family Hub, Founder's Ops, Replace Google Assistant, Replace ChatGPT Plus, Replace my PA, and Research Co-pilot.

The blueprint loader validates 70+ rules at load time. The init wizard walks users through blueprint selection to landmine-free config generation, with air-gapped mode support and atomic file writes. Each blueprint has 1–3 customization questions (dietary restrictions, risk tolerance, communication style) that personalize the agent without exposing configuration complexity. Identity files (SOUL.md, AGENTS.md) are generated from blueprint + wizard answers and mounted read-only in the container.

### AI config inference

`clawhq init --smart` — describe what you need in plain language, and a local Ollama model selects the right blueprint and configures integrations. No internet required, no data leaves the machine.

### Workspace tools

Seven tool generators shipped: email, tasks, todoist, ical, quote, tavily, and todoist-sync. Each generates a workspace-scoped CLI tool that the agent uses to interact with external services. Tools are composable — blueprints select which tools to include.

### Skill lifecycle

Skills go through a pipeline: stage → vet → approve → activate. URL trap detection catches malicious skills that exfiltrate data via encoded URLs. Every installation creates a rollback snapshot. Six built-in skills: email-digest, morning-brief, market-scan, meal-plan, schedule-guard, and investor-update.

### Memory, autonomy, and migration

Three-tier memory lifecycle (hot/warm/cold) with LLM-powered summarization and PII masking before cold storage. An autonomy recommendation engine suggests appropriate autonomy levels. Preference learning tracks user decisions over time. Decision trace explains "why did you do that?" with full reasoning chains. Migration import parses ChatGPT and Google Assistant data exports, extracts preferences via Ollama, maps routines to cron jobs, and masks PII.

---

## Phase 1: Foundation & Platform — 2026-03-18 to 2026-03-19

Phase 1 built the foundation — everything needed before blueprints and skills could exist.

### Config schema with landmine prevention

The config schema enforces all 14 OpenClaw landmine rules at the type level. The config loader handles precedence merging across multiple sources. The validator runs continuously — it is impossible to persist a config that violates a landmine rule. (~1,591 lines)

### Gateway communication

A WebSocket RPC client authenticates with the OpenClaw Gateway, handles typed errors and timeouts, and provides the communication layer for all agent interaction. (~1,248 lines)

### CLI and install

A flat CLI (AD-01) — `clawhq doctor`, not `clawhq operate doctor`. The installer detects prerequisites (Docker, Node.js 20+, Ollama), scaffolds the deployment directory at `~/.clawhq/`, and supports both trusted-cache and from-source acquisition. 78 leaf commands across 13 command groups.

### Docker build and deploy

Two-stage Docker build with hash-based change detection: Stage 1 caches the base OpenClaw image and apt packages, Stage 2 rebuilds only when tools or skills change. Four security postures (minimal, standard, hardened, paranoid) with `cap_drop: ALL`, read-only rootfs, `no-new-privileges`, non-root UID 1000, and ICC disabled — applied automatically. `clawhq up` runs 6 preflight checks, launches compose, applies the egress firewall, verifies health, and runs a smoke test. The egress firewall uses a dedicated iptables chain (`CLAWHQ_FWD`) with per-integration domain allowlists. (~11,718 lines of deploy orchestration)

### Security infrastructure

Secrets management with atomic .env writes and 0600 permissions. Credential health probes test each integration (IMAP, CalDAV, Todoist, GitHub, Tavily) with 10-second timeouts and specific remediation steps. PII + secrets scanner with pattern-based detection and git history scanning. Audit trail with append-only JSONL for tool execution, HMAC-chained secret lifecycle events, egress logging, and OWASP compliance export. Air-gapped mode enforces zero egress at both config and firewall levels.

### Operational tooling

Doctor diagnostics run 14+ preventive checks with auto-fix. Encrypted backup/restore with GPG and SHA-256 integrity verification. Status dashboard, log streaming, and safe updates with automatic rollback. Approval queue for high-stakes actions via Telegram. Multi-channel notifications (Telegram, Slack, webhook). Predictive health alerts with trend analysis. Health self-repair for container stopped/OOM. Activity digest for daily summaries. Portable export with PII masking and verified destruction with crypto manifest. Web dashboard (Hono + htmx + Pico CSS) with 7 pages.

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
