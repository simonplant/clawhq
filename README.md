# ClawHQ

**The control panel for OpenClaw agents.**

---

cPanel made Linux hosting accessible to anyone who could rent a VPS. You didn't need to know how to configure Apache, manage SSL certs, set up email, write cron jobs, or harden a server — the control panel handled it. The server was powerful. The panel made it usable.

OpenClaw is the most powerful open-source framework for personal AI agents. It's also nearly impossible to operate — 14+ silent configuration landmines, memory that bloats without lifecycle management, credentials that expire without warning, security that's entirely opt-in, and ongoing SRE work that most people won't do.

**ClawHQ is the control panel.** It manages the full deployment lifecycle — setup, build, hardening, deployment, operations, evolution, and decommission — so your agent actually works in production and keeps working.

```
Plan  →  Build  →  Secure  →  Deploy  →  Operate  →  Evolve  →  Decommission
```

Seven phases. Each is a distinct operational domain with its own toolchain. Together they cover the complete lifecycle — from the moment you decide to create an agent to the moment you retire it. The same way cPanel handles everything from domain setup to server decommission, ClawHQ handles everything from agent design to verified data deletion.

## The Toolchains

### Plan — Design your agent

Templates, questionnaire, config generation, identity architecture, workspace tools, skills. Answer questions about who your agent should be and what it should do — ClawHQ generates a complete, valid, hardened deployment bundle including:

- **openclaw.json** — runtime config with all 14 landmines auto-handled
- **Dockerfile** — custom binary layer composed from your integration selections
- **docker-compose.yml** — hardened container config (cap_drop ALL, ICC disabled, UID 1000)
- **7 workspace tools** — email, tasks, todoist, ical, quote, tavily, todoist-sync (generated based on integrations)
- **7 identity files** — SOUL.md, USER.md, IDENTITY.md, AGENTS.md, HEARTBEAT.md, TOOLS.md, MEMORY.md (auto-populated from template + integrations)
- **Skills** — construct (self-improvement) + morning-brief (daily briefing)
- **Cron jobs** — heartbeat, work-session, morning-brief, construct (OpenClaw-native format)

Templates are **full operational profiles** — not prompt skins. 6 built-in templates, each defining personality, security posture, monitoring thresholds, memory policy, cron configuration, autonomy defaults, and integration requirements.

```bash
clawhq init --guided       # Interactive questionnaire → complete deployment bundle
clawhq template list       # Browse available templates
clawhq template preview    # Preview a template's operational profile
clawhq agent add <id>      # Add a second agent to an existing deployment
clawhq agent list          # List configured agents
```

### Build — Construct from source

Two-stage image build from OpenClaw source. Never pre-built images — always from source, always auditable. Skill bundling, integration tool packaging, build verification.

```bash
clawhq build         # Two-stage image build from OpenClaw source
```

### Secure — Harden by default

Like cPanel auto-configures SSL, firewall rules, and file permissions on a fresh VPS — ClawHQ auto-hardens every deployment. Container lockdown (cap_drop ALL, read-only rootfs, non-root user), egress firewall (DNS + HTTPS only), secrets management, PII scanning, credential health monitoring, audit logging. Security is the baseline, not a feature flag.

```bash
clawhq scan          # PII + secrets scanner across agent repos
clawhq creds         # Credential health, expiry tracking, rotation
clawhq audit         # Tool execution history + cost attribution
```

### Deploy — Ship and connect

One command: container up, firewall applied, networks verified, health confirmed, messaging channel connected. Like clicking "create site" in a hosting panel — except the panel also hardens the server, verifies the SSL, and tests that email actually sends.

```bash
clawhq up            # Deploy + secure + verify in one step
clawhq connect       # Connect messaging channel (Telegram, etc.)
clawhq down          # Graceful shutdown
clawhq restart       # Restart with firewall reapply + health verify
```

### Operate — Keep it running

The day-2 through day-365 work. Diagnostics, health monitoring, backup/restore, safe updates, log streaming. The same way a hosting panel gives you a dashboard for server health, resource usage, and one-click updates — ClawHQ gives you a dashboard for agent health, integration status, and safe upstream upgrades.

```bash
clawhq doctor        # Preventive diagnostics — every known failure mode
clawhq status        # Single-pane health: agent, integrations, cron, memory
clawhq backup        # Encrypted snapshots with restore
clawhq update        # Safe upstream upgrade with rollback
clawhq logs          # Stream agent activity
```

**`doctor` is the hero feature.** It checks every known failure mode — 14+ configuration landmines, credential health, permissions, firewall state, identity file sizes, cron syntax, cross-file consistency — and tells you exactly what's wrong or what *would* go wrong if left unchecked. The marketing screenshot is `doctor` catching five problems you didn't know you had.

### Evolve — Grow over time

Hosting panels don't do this — but agents aren't static websites. They degrade without active management. Identity drifts, memory bloats, personality shifts, integrations go stale. ClawHQ provides identity governance, memory lifecycle (hot/warm/cold tiers), personality refinement, behavioral training, and integration management — the work that keeps your agent becoming more useful, not less.

```bash
clawhq evolve        # Update personality, context, integrations
clawhq train         # Refine behavior from interaction history
```

### Decommission — Clean exit

Export everything portable, destroy everything else, verify the destruction cryptographically. No orphaned data, no lingering secrets. Supports migration (export + reimport), fresh starts, and full retirement.

```bash
clawhq export        # Portable profile bundle — yours forever
clawhq destroy       # Full wipe with cryptographic verification
```

## Three Layers

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 1: CORE PLATFORM (same for every agent)          │
│  Config Safety · Security · Monitoring · Memory Mgmt    │
│  Cron Guardrails · Identity Governance · Audit Logging  │
├─────────────────────────────────────────────────────────┤
│  LAYER 2: TEMPLATES (choose one, customize)             │
│  Guardian · Assistant · Coach · Analyst · Companion     │
│  Each: full operational profile, not just personality   │
├─────────────────────────────────────────────────────────┤
│  LAYER 3: INTEGRATIONS (pick providers per category)    │
│  Email · Calendar · Tasks · Messaging · Files · Code    │
│  Finance · Research · Notes · Health                    │
└─────────────────────────────────────────────────────────┘
```

**Layer 1** is the control panel itself — the engineering that makes any agent safe, observable, and maintainable. Like cPanel's core: the same for every site, handling the operational complexity so you don't have to.

**Layer 2** is the ecosystem — community-contributed operational profiles (WordPress themes for agents). Templates customize Layer 1 within safe bounds. They can tighten security but never loosen it below the platform baseline.

**Layer 3** is provider abstraction — the agent talks to "calendar" not "Google Calendar." Swap providers without changing agent behavior.

## Two Modes

**ClawHQ Managed** — We operate your agent on isolated infrastructure. Web console. Same engine underneath. We manage the container lifecycle, not the contents. You never touch a terminal. Think managed WordPress hosting — same WordPress, zero ops.

**ClawHQ Self-Operated** — The same engine as a free, open-source CLI. Your hardware. Full control. Think installing cPanel on your own VPS — same panel, your server.

## Data Sovereignty

Your agent holds the most intimate dataset about you that has ever existed — every email, every health concern, every financial anxiety, every relationship. ClawHQ is built so that data stays yours.

| Principle | How |
|---|---|
| **Workspace isolation** | Isolated infrastructure. We manage the container, not the contents. |
| **Identity integrity** | Identity files mounted read-only. Agent cannot modify its own guardrails. |
| **Portability** | `clawhq export` — take everything. Zero lock-in. |
| **Deletion** | `clawhq destroy` — cryptographic verification of complete wipe. |
| **Auditability** | Every tool execution logged. Full transparency. |
| **Open source** | Auditable engine. Verify every claim. |

## Why This Exists

Every successful infrastructure platform follows the same pattern: a powerful open-source engine appears, it's too hard for most people to operate, and a management layer emerges to bridge the gap.

| Engine | Too Hard To Operate | Management Layer |
|---|---|---|
| Linux | Server administration | cPanel, Plesk, Webmin |
| WordPress | Hosting, security, updates | WordPress.com, managed WP hosting |
| AWS/multi-cloud | Cloud infrastructure | RightScale, CloudFormation |
| Kubernetes | Container orchestration | Rancher, OpenShift |
| **OpenClaw** | **Agent operations** | **ClawHQ** |

ClawHQ is that layer for OpenClaw. The big-tech agents (Google, Apple, Microsoft) will be more polished and more integrated. They'll also see everything. ClawHQ is for people who want an agent that works reliably, evolves over time, and operates on their terms.

```
Raw framework ←──────────────────────────────────→ Platform lock-in
OpenClaw         Basic hosting       CLAWHQ          Big-tech agents
(powerful,       (default config,    (control panel,     (polished,
 expert-only)    no lifecycle)       full lifecycle)     captive)
```

## Built on Production

Everything in ClawHQ was extracted from a production agent running for months — hardened Docker deployment, 10-minute heartbeat cycles, multi-model architecture, 6+ integrations, ~13,500 tokens of configuration across 11+ files. Every failure mode became a rule. Every script became a module. Every landmine became a check in `doctor`.

## Status

Active development. TypeScript CLI, tight coupling to OpenClaw's Node.js/TypeBox stack.

**Implemented:**
- `clawhq init --guided` — full deployment bundle generation (config, Dockerfile, workspace tools, identity files, skills, cron)
- `clawhq build` — two-stage Docker build with change detection and manifests
- `clawhq up/down/restart` — deploy with pre-flight checks, firewall, health verification
- `clawhq doctor` — 14+ diagnostic checks with auto-fix
- `clawhq status` — single-pane dashboard (agent, integrations, workspace, egress)
- `clawhq creds` — credential health probes
- `clawhq backup create/list/restore` — encrypted snapshots
- `clawhq update` — safe upstream upgrade with rollback
- `clawhq agent add/list` — multi-agent support (OpenClaw native `agents.list[]` + `bindings[]`)
- `clawhq skill install/update/remove/list` — skill lifecycle management
- `clawhq template list/preview` — template browsing
- **Workspace tool generators** — 7 CLI tools (email, tasks, todoist, ical, quote, tavily, todoist-sync) generated from integration selections
- **Identity file generators** — SOUL.md, USER.md, IDENTITY.md, AGENTS.md, HEARTBEAT.md, TOOLS.md, MEMORY.md auto-populated from template + integrations
- **Dockerfile generator** — composes binary install fragments based on enabled integrations
- **Skill generators** — construct (self-improvement framework) + morning-brief bundled
- **Enhanced cron** — OpenClaw-native format (`kind`, `expr`, `delivery`, `activeHours`)

- [docs/PRODUCT.md](docs/PRODUCT.md) — Product design: problem, personas, user stories, build order
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Solution architecture: three-tier system, package structure, security, data flow
- [docs/OPENCLAW-REFERENCE.md](docs/OPENCLAW-REFERENCE.md) — Engineering reference: OpenClaw internals, config landmines, integration surfaces
