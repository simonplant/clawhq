# ClawHQ Architecture

> Solution architecture for ClawHQ — the control panel for OpenClaw agents.

**Status:** Draft · **Updated:** 2026-03-12

---

## System Overview

ClawHQ is a three-tier system. The local panel (Tier 2) is the core product and works standalone. The cloud service (Tier 3) adds convenience features but is never required.

```
┌─────────────────────────────────────────────────────────┐
│  Tier 3: ClawHQ Cloud                                   │
│  Account · Install · Updates · Remote health ·          │
│  Security advisories · Fleet view · Billing             │
│  ─── optional — loses features without it ───           │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS API (heartbeat, updates, alerts)
                         │ Minimal, auditable protocol
┌────────────────────────┴────────────────────────────────┐
│  Tier 2: ClawHQ Local                                   │
│  Local web UI + CLI on the machine running OpenClaw.    │
│  The full lifecycle: init, build, deploy, doctor,       │
│  backup, status, connect, export, destroy.              │
│  ─── works standalone in paranoid mode ───              │
└────────────────────────┬────────────────────────────────┘
                         │ WebSocket RPC · Docker API · Filesystem
┌────────────────────────┴────────────────────────────────┐
│  Tier 1: OpenClaw                                       │
│  Gateway process · Channels · Agent runtime ·           │
│  Tools · Memory · Cron · Skills                         │
│  ─── unmodified — ClawHQ wraps, never forks ───         │
└─────────────────────────────────────────────────────────┘
```

### Design Principles

- **Tier 2 is the product.** Everything of value works without Tier 3. Paranoid mode is not a degraded experience — it's the default. Cloud is opt-in.
- **Tight coupling to OpenClaw.** No abstraction layer. We use OpenClaw's TypeBox config schema, WebSocket RPC protocol, file paths, and container structure directly.
- **TypeScript throughout.** OpenClaw is Node.js with TypeBox schemas. ClawHQ shares the same language, can import types directly, and validates config against the actual schema — not a reimplementation.
- **OpenClaw handles model routing.** ClawHQ generates config that tells OpenClaw how to route models. It does not make LLM calls itself (except during `init --smart` for config inference via local Ollama).

---

## Tier 1: OpenClaw (The Agent Runtime)

ClawHQ does not modify OpenClaw. It integrates through four documented surfaces:

| Surface | What | How ClawHQ Uses It |
|---------|------|-------------------|
| **Config file** | `~/.openclaw/openclaw.json` — controls all runtime behavior | Read/write via Gateway `config.patch` RPC (WebSocket). Direct file write when Gateway is down. |
| **Workspace** | `~/.openclaw/workspace/` — identity files, memory, skills, tools | Read/write as plain files. Identity files are read-only at runtime (ClawHQ owns the lifecycle). |
| **Cron system** | `~/.openclaw/cron/` — job definitions + execution history | Write `jobs.json`, read run logs. Gateway hot-reloads. |
| **Gateway WebSocket** | `:18789` — config management, session RPCs, health, status | Primary runtime communication channel. Token-authenticated. Rate limited (3 req/60s for config writes). |

### Communication Channels

| Channel | When to Use |
|---------|------------|
| **WebSocket RPC** | Anything the Gateway manages at runtime (config, sessions, status, real-time events) |
| **Filesystem** | Anything stored as files (workspace, memory, identity, cron, backups) |
| **Subprocess** | Anything needing OS-level access (Docker, iptables, `openclaw` CLI commands) |

### What OpenClaw Already Handles (Don't Replicate)

- Message routing (channel → session → agent dispatch)
- Model API calls (selection, failover, streaming)
- Tool execution (dispatch + sandboxing)
- Session persistence
- Channel protocol handling
- Config schema validation (Gateway is the final authority — ClawHQ validates before writing, Gateway validates on load)

---

## Tier 2: ClawHQ Local (The Control Panel)

A local web application + CLI running on the same host as OpenClaw. This is the core product.

### What It Does

Manages the complete agent lifecycle through seven phases:

| Phase | Commands | What It Covers |
|-------|----------|---------------|
| **Plan** | `init`, `init --smart`, `init --guided` | Templates, config inference, guided setup, config generation with landmine prevention |
| **Build** | `build` | Two-stage Docker build from OpenClaw source |
| **Secure** | `scan`, `creds` | Container hardening, egress firewall, secrets management, PII scanning |
| **Deploy** | `up`, `down`, `restart`, `connect` | Pre-flight checks, deploy sequence, channel connection, smoke test |
| **Operate** | `doctor`, `status`, `backup`, `update`, `logs` | Diagnostics, health monitoring, encrypted backup, safe updates |
| **Evolve** | `evolve` | Identity governance, memory lifecycle, preference learning |
| **Decommission** | `export`, `destroy` | Portable export, verified destruction |

### Delivery

ClawHQ Local ships as a single installable package:

- **CLI** — `clawhq <command>` for terminal workflows and automation
- **Local web UI** — browser-based dashboard served on localhost for visual management
- Both share the same underlying engine — the web UI calls the same functions as the CLI

### Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Language** | TypeScript | Matches OpenClaw. Shares TypeBox schema types. Native WebSocket client. |
| **Runtime** | Node.js | Same as OpenClaw. No language boundary. |
| **CLI framework** | TBD (commander, oclif, or similar) | |
| **Local web server** | TBD (Hono, Fastify, or similar) | Serves local dashboard, API for web UI |
| **Local web UI** | TBD | Lightweight — this is a control panel, not a SaaS app |
| **Distribution** | npm global install, or bundled binary via pkg/bun compile | Target audience already has Node.js (they're running OpenClaw) |
| **Config validation** | OpenClaw's TypeBox schema imported directly | Single source of truth — no reimplementation |

### Package Structure

```
clawhq/
├── src/
│   ├── cli/                  # CLI entrypoint and command definitions
│   ├── ui/                   # Local web UI
│   ├── server/               # Local web server (serves UI, API for dashboard)
│   │
│   ├── config/               # Config loading, validation, generation
│   │   ├── schema.ts         # Re-exports/wraps OpenClaw TypeBox schema
│   │   ├── loader.ts         # Load and merge config from multiple sources
│   │   ├── validator.ts      # 14 landmine rules + cross-file consistency
│   │   └── generator.ts      # Template + answers → full config bundle
│   │
│   ├── docker/               # Docker client wrapper
│   │   ├── client.ts         # Docker Engine API / CLI subprocess
│   │   ├── build.ts          # Two-stage build orchestration
│   │   ├── compose.ts        # docker-compose generation and management
│   │   └── hardening.ts      # Security posture → compose security options
│   │
│   ├── gateway/              # OpenClaw Gateway communication
│   │   ├── websocket.ts      # WebSocket RPC client
│   │   ├── health.ts         # Health check polling
│   │   └── config-rpc.ts     # config.patch / config.apply wrappers
│   │
│   ├── security/             # Security toolchain
│   │   ├── firewall.ts       # iptables CLAWHQ_FWD chain management
│   │   ├── secrets.ts        # .env management, never in config files
│   │   ├── credentials.ts    # Health probes per integration
│   │   └── scanner.ts        # PII and secret pattern detection
│   │
│   ├── workspace/            # OpenClaw workspace management
│   │   ├── identity.ts       # Identity file read/write, token budget tracking
│   │   ├── memory.ts         # Memory tier management (hot/warm/cold)
│   │   └── cron.ts           # Cron job definitions and run log reading
│   │
│   ├── templates/            # Template system
│   │   ├── loader.ts         # YAML template parsing
│   │   ├── resolver.ts       # Template + user answers → config values
│   │   └── built-in/         # Bundled templates (Guardian, Assistant, etc.)
│   │
│   ├── backup/               # Backup and restore
│   │   ├── snapshot.ts       # Encrypted backup creation
│   │   └── restore.ts        # Integrity check, restore, post-restore doctor
│   │
│   ├── cloud/                # Tier 3 connection (optional)
│   │   ├── client.ts         # Cloud API client
│   │   ├── heartbeat.ts      # Periodic health/status push
│   │   ├── updates.ts        # Update check and advisory pull
│   │   └── index.ts          # Feature detection — graceful no-op when disabled
│   │
│   └── doctor/               # Diagnostic engine
│       ├── checks/           # Individual check implementations
│       ├── runner.ts         # Run all checks, aggregate results
│       └── fix.ts            # Auto-fix for safe issues
│
├── templates/                # Built-in template YAML files
├── package.json
└── tsconfig.json
```

### Cloud Connection Protocol (Tier 2 → Tier 3)

When cloud is enabled, the local panel communicates with ClawHQ Cloud over HTTPS. The protocol is minimal and auditable — privacy-conscious users will inspect it.

**What Tier 2 sends to Tier 3:**

| Data | Purpose | Frequency |
|------|---------|-----------|
| Agent health status (up/down/degraded) | Remote monitoring | Heartbeat interval (configurable, default 5min) |
| Software version | Update checks | On startup + daily |
| Template ID (not content) | Usage analytics | On init |
| Error codes (not messages) | Diagnostics | On failure |

**What Tier 2 never sends:**

- Agent conversations, memory, or identity content
- Config file contents (only schema version)
- Credential values
- Workspace file contents
- Anything from OpenClaw's runtime

**What Tier 3 sends to Tier 2:**

| Data | Purpose |
|------|---------|
| Available updates + changelogs | Update notification |
| Security advisories | Vulnerability alerts |
| Fleet status (for fleet operators) | Aggregated dashboard |

**Paranoid mode** (`clawhq config set cloud.enabled false` or omit token): all cloud communication is disabled. The `cloud/` module becomes a no-op. Features lost: remote health monitoring, push update notifications, security advisories, fleet dashboard. Features retained: everything else.

---

## Tier 3: ClawHQ Cloud (The Web Service)

A separate web application. Handles account management, onboarding, and optional operational features.

### Onboarding Flow

```
1. User visits clawhq.com → creates account
2. Dashboard shows install command with auth token:
   curl -fsSL https://clawhq.com/install | sh -s -- --token <TOKEN>
3. One-liner installs ClawHQ Local on user's server, authenticates
4. User runs: clawhq init
5. Setup wizard runs → agent deployed
```

### Responsibilities

| Capability | Description |
|------------|-------------|
| **Account management** | Sign up, auth, billing |
| **Install orchestration** | Generate install scripts with embedded auth tokens |
| **Update distribution** | Host releases, serve update metadata, push security advisories |
| **Remote health dashboard** | Aggregated view of connected agents (health status only — no content) |
| **Fleet management** | Multi-agent overview for fleet operators |
| **Security advisories** | Push notifications for OpenClaw CVEs, config vulnerabilities, credential leaks |

### What Cloud Never Sees

The operational boundary is strict:

| Cloud CAN see | Cloud CANNOT see |
|---------------|------------------|
| Agent health (up/down/restarts) | Agent conversations |
| Integration status (healthy/degraded/failed) | Email, task, or calendar content |
| Memory tier sizes (45KB hot, 120KB warm) | Memory contents |
| Software versions | Config file contents |
| Error codes | Error messages or stack traces |

### Tech Stack

TBD — separate from Tier 2. Likely a standard web app (TypeScript, database, auth). Will be defined when Tier 3 becomes implementation priority.

---

## Security Architecture

### Container Hardening (Applied by Tier 2)

Every deployed agent container gets security controls based on the template's security posture:

| Control | Standard | Hardened | Paranoid |
|---------|----------|----------|----------|
| Linux capabilities | `cap_drop: ALL` | `cap_drop: ALL` | `cap_drop: ALL` |
| Filesystem | Read-only rootfs | Read-only rootfs | Read-only rootfs + encrypted workspace |
| Privilege escalation | `no-new-privileges` | `no-new-privileges` | `no-new-privileges` |
| User | Non-root (UID 1000) | Non-root (UID 1000) | Non-root (UID 1000) |
| Network isolation | ICC disabled | ICC disabled | ICC disabled + allowlist egress |
| Resource limits | 4 CPU / 4GB RAM | 2 CPU / 2GB RAM | 1 CPU / 1GB RAM |
| Identity files | Read-only mount | Read-only mount | Read-only mount + integrity hash |

### Egress Firewall

Dedicated iptables chain (`CLAWHQ_FWD`) on the Docker bridge interface:

1. Allow ESTABLISHED/RELATED (return traffic)
2. Allow DNS (UDP/TCP 53)
3. Allow HTTPS (TCP 443) to allowlisted domains only
4. LOG + DROP everything else

Domain allowlist is derived from: template defaults + user's cloud API opt-in (only opted-in provider domains are allowed). Reapplied automatically after every `docker compose down` / network recreate.

### Secrets

- All secrets live in `.env` with `600` permissions
- Never written to `openclaw.json`, workspace files, or logs
- Credential health probes validate each integration's auth on schedule
- `clawhq creds` reports status; `clawhq doctor` checks for leaked secrets in config files

---

## Data Flow

### Normal Operation (Cloud Connected)

```
User ──message──▶ Channel (Telegram/WhatsApp/etc.)
                        │
                        ▼
              ┌─── OpenClaw Gateway ───┐
              │  Route → Agent → Tools │
              │  Memory ← → Workspace  │
              └────────────────────────┘
                        │
            WebSocket RPC│  Filesystem
                        ▼
              ┌─── ClawHQ Local ───────┐
              │  Monitor · Doctor ·    │
              │  Config · Backup       │
              │  Local web UI · CLI    │
              └────────────────────────┘
                        │
              HTTPS (health│status only)
                        ▼
              ┌─── ClawHQ Cloud ───────┐
              │  Dashboard · Updates · │
              │  Advisories            │
              └────────────────────────┘
```

### Paranoid Mode (No Cloud)

Same as above, minus the bottom arrow. ClawHQ Local operates fully standalone.

---

## Implementation Priority

1. **Tier 2 Local — CLI + core engine** (operate an existing OpenClaw deployment)
2. **Tier 2 Local — web UI** (visual dashboard for the same capabilities)
3. **Tier 3 Cloud — onboarding + install** (website, accounts, one-liner install)
4. **Tier 3 Cloud — operational features** (remote health, updates, fleet)

Tier 2 must work completely without Tier 3 at every stage.

---

## Open Decisions

| Decision | Options | Status |
|----------|---------|--------|
| CLI framework | commander, oclif, yargs, citty | Not decided |
| Local web server | Hono, Fastify, Express | Not decided |
| Local web UI framework | Lit (match OpenClaw), React, Vue, Svelte | Not decided |
| Distribution format | npm global, bun compile, pkg, docker | Not decided |
| Tier 3 tech stack | Separate repo or monorepo workspace | Not decided |
| Monorepo tooling | Turborepo, nx, pnpm workspaces | Not decided |
