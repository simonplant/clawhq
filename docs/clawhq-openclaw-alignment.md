# ClawHQ ↔ OpenClaw Implementation Alignment

**How OpenClaw actually works, and exactly where ClawHQ attaches.**

---

## Why This Document Exists

PRODUCT.md describes ClawHQ from the user's perspective — 7 toolchains solving lifecycle problems. The config surface map catalogs ~200 fields from OpenClaw's `openclaw.json`. Neither document describes *how OpenClaw implements things internally* — which is what we need to know to build ClawHQ without fighting the framework.

This document answers: **What are OpenClaw's actual subsystems, how do they work, and where does ClawHQ hook in?**

---

## OpenClaw's Real Architecture (from source)

OpenClaw is a single Node.js process (the **Gateway**) that acts as a control plane. Everything else connects to it.

```
                     ~/.openclaw/openclaw.json  (JSON5 config)
                     ~/.openclaw/workspace/     (agent files, memory, skills)
                     ~/.openclaw/cron/          (job definitions + run logs)
                     ~/.openclaw/credentials/   (pairing allowlists, auth state)
                     ~/.openclaw/.env           (secrets)
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│                    GATEWAY PROCESS                        │
│                   (src/gateway/server.ts)                 │
│                                                          │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────────┐  │
│  │ Config   │  │ Session   │  │ Channel Adapters     │  │
│  │ Loader   │  │ Manager   │  │ (telegram/, discord/,│  │
│  │ (config/ │  │ (config/  │  │  slack/, whatsapp/,  │  │
│  │  config  │  │  sessions │  │  signal/, imessage/, │  │
│  │  .ts)    │  │  .ts)     │  │  + plugin channels)  │  │
│  └────┬─────┘  └─────┬─────┘  └──────────┬───────────┘  │
│       │              │                    │              │
│       ▼              ▼                    ▼              │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Auto-Reply Router                    │   │
│  │            (auto-reply/reply.ts)                  │   │
│  │  access control → session resolve → agent dispatch│   │
│  └──────────────────────┬───────────────────────────┘   │
│                         │                                │
│                         ▼                                │
│  ┌──────────────────────────────────────────────────┐   │
│  │           Pi Agent Runtime (PiEmbeddedRunner)     │   │
│  │            (agents/piembeddedrunner.ts)            │   │
│  │                                                    │   │
│  │  prompt-builder.ts → model API → tool dispatch     │   │
│  │       ↕                    ↕            ↕          │   │
│  │  memory/              providers     sandbox.ts     │   │
│  │  (workspace/memory/)  (API keys)   (Docker exec)   │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │ Cron       │  │ Hooks      │  │ WebSocket Hub    │  │
│  │ Scheduler  │  │ (webhooks) │  │ (Control UI,     │  │
│  │            │  │            │  │  TUI, CLI, apps) │  │
│  └────────────┘  └────────────┘  └──────────────────┘  │
│                                                          │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │ Plugin     │  │ Skills     │  │ Browser Control  │  │
│  │ Loader     │  │ Registry   │  │ (CDP/Chrome)     │  │
│  └────────────┘  └────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────┘
                              │
              WebSocket :18789│
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         CLI client     Control UI      Companion Apps
         (openclaw …)   (browser)       (macOS/iOS/Android)
```

### Key Implementation Facts

1. **Single process.** The Gateway is one Node.js process. No separate services, no message queues, no databases (except SQLite for memory search). Everything is in-process.

2. **Single config file.** `~/.openclaw/openclaw.json` is the source of truth for runtime behavior. The Gateway loads it at startup, validates against a TypeBox schema (`src/config/schema.ts`), and watches it for hot-reload changes.

3. **Filesystem is state.** Sessions, cron jobs, memory, credentials, and workspace files are all stored as files under `~/.openclaw/`. There is no database for operational state — it's JSON files on disk.

4. **The CLI talks to the Gateway via WebSocket.** When you run `openclaw config set`, the CLI connects to the running Gateway's WebSocket, sends an RPC, and the Gateway writes the config. The CLI is a *client*, not a direct file editor (though it can edit files when the Gateway is down).

5. **The Control UI is served by the Gateway.** The built-in web dashboard at `http://127.0.0.1:18789` is a Lit web-component app served from the Gateway process itself. It communicates with the Gateway over the same WebSocket.

6. **Channels are adapters, not plugins.** Core channels (WhatsApp, Telegram, Discord, Slack, Signal, iMessage) are compiled into the Gateway source. Plugin channels (Teams, Matrix, Feishu, LINE, etc.) live in `extensions/` and are loaded by `src/plugins/loader.ts`.

7. **The agent runtime is embedded.** `PiEmbeddedRunner` (using `@mariozechner/pi-agent-core`) runs inside the Gateway process. It's not a separate container or service. Tools are function calls within the same process (or Docker exec for sandboxed operations).

8. **Config schema is TypeBox.** The schema in `src/config/schema.ts` defines every valid field. Unknown keys cause the Gateway to refuse to start. This is our authoritative source for what can be configured.

---

## Where ClawHQ Attaches

Given OpenClaw's architecture, ClawHQ has exactly **four integration surfaces**:

### Surface 1: The Config File (`~/.openclaw/openclaw.json`)

**What it controls:** Everything about runtime behavior — models, channels, tools, sessions, security, cron, hooks, plugins, sandbox.

**How OpenClaw reads it:** `src/config/config.ts` loads, validates, and applies the config. The Gateway watches the file and hot-reloads most changes.

**How ClawHQ writes it:**
- **Option A (preferred):** Use the Gateway's `config.patch` / `config.apply` RPC via WebSocket. This is what the CLI and Control UI already do. The Gateway validates before applying, handles hot-reload vs. restart decisions, and maintains config hash for optimistic concurrency.
- **Option B (fallback):** Write the file directly when the Gateway is down. Must validate against the TypeBox schema independently.

**What this means for ClawHQ:** Every "panel" in the web console ultimately produces a `config.patch` RPC call. The panel is a form → JSON5 patch → WebSocket RPC → Gateway validates → config written → hot-reload or restart. ClawHQ doesn't need to understand config internals beyond the schema — the Gateway does the validation.

### Surface 2: The Workspace (`~/.openclaw/workspace/`)

**What it contains:**
- Identity files: `SOUL.md`, `USER.md`, `AGENTS.md`, `TOOLS.md`, `HEARTBEAT.md`, `IDENTITY.md`, `BOOT.md`, `BOOTSTRAP.md`
- Memory files: `memory/*.md` (plain markdown files used as agent memory)
- Skills: `skills/` directory (each skill is a directory with `SKILL.md`)
- Custom tools and scripts

**How OpenClaw reads it:** The `prompt-builder.ts` reads identity files at each agent turn to build the system prompt. Memory files are indexed by `src/memory/` for semantic search. Skills are registered by the skills loader.

**How ClawHQ writes it:** Direct filesystem operations. These are plain files — read, write, list, delete. No RPC needed. For the managed mode (remote), ClawHQ would use the `exec` tool or a dedicated file management RPC.

**What this means for ClawHQ:** The identity/memory/skills editors are file editors, not config editors. They operate on a different surface than the config panels. The key constraint is `bootstrapMaxChars` — the system prompt has a token budget, and identity files that exceed it get silently truncated. ClawHQ must enforce this budget in the editor.

### Surface 3: The Cron System (`~/.openclaw/cron/`)

**What it contains:**
- `jobs.json` — cron job definitions (name, schedule, session target, payload)
- `runs/<jobId>.jsonl` — execution history per job

**How OpenClaw reads it:** The cron scheduler loads `jobs.json` at Gateway startup. Jobs are managed via `openclaw cron add/remove/list` CLI commands or the `cron` tool within agent sessions.

**How ClawHQ writes it:** Via CLI commands (`openclaw cron add`) or by writing `jobs.json` directly. The Gateway hot-reloads cron config.

**What this means for ClawHQ:** The cron builder writes to `cron/jobs.json` and reads from `cron/runs/*.jsonl` for execution history. Schedule validation (the stepping syntax landmine: `5/15` vs `3-58/15`) must happen in ClawHQ before writing.

### Surface 4: The Gateway WebSocket API

**What it exposes:**
- `config.get` / `config.patch` / `config.apply` — config management
- Session RPCs — list, history, send, spawn, status
- Gateway RPCs — status, health, restart
- Agent RPCs — model switching, tool calls
- Device management — pairing, discovery

**How clients use it:** CLI, Control UI, TUI, and companion apps all connect via WebSocket with token/password auth. All communication is authenticated.

**How ClawHQ uses it:** ClawHQ's web console connects to this same WebSocket. For self-operated mode, ClawHQ is a *better Control UI* — same protocol, richer interface. For managed mode, `agentd` (the ClawHQ daemon) maintains a persistent WebSocket connection and proxies operations from the web console.

**What this means for ClawHQ:** We don't need to reinvent the communication layer. OpenClaw already has a well-defined WebSocket protocol with authentication, rate limiting (3 req/60s for config writes), and RPC semantics. ClawHQ builds on top of this.

---

## Aligning ClawHQ Toolchains to OpenClaw Subsystems

### PLAN → Config Generation + Workspace Seeding

**OpenClaw's implementation:** `openclaw onboard` is a CLI wizard (`src/commands/onboard.ts`) that walks through model selection, channel setup, and daemon installation. It writes `openclaw.json` and seeds the workspace with default identity files from templates in `src/templates/`.

**What ClawHQ adds:**
- The template system (Guardian, Assistant, Coach, etc.) generates a *complete* config bundle, not just the minimal config the wizard produces
- The 14 landmine rules are validation rules applied *before* writing config
- The questionnaire collects personalization data that the wizard doesn't ask for (personality, autonomy preferences, integration categories)
- Config generation separates universal (40%) from personalized (60%) fields

**Integration point:** ClawHQ's Plan toolchain produces the same artifacts OpenClaw expects: `openclaw.json` + workspace files + `.env`. It doesn't need a special API — it writes the standard files and lets the Gateway load them normally.

**Key constraint from OpenClaw:** The config schema (`src/config/schema.ts`) is strict. ClawHQ's templates must generate schema-valid JSON5. Unknown keys = Gateway refuses to start. Run `openclaw doctor` equivalent validation before writing.

---

### BUILD → Docker Image Construction

**OpenClaw's implementation:** OpenClaw provides `Dockerfile`, `Dockerfile.sandbox`, `Dockerfile.sandbox-browser`, and `Dockerfile.sandbox-common` in the repo root. `docker-compose.yml` and `docker-setup.sh` handle container orchestration. The official `Dockerfile` is a standard Node.js build.

**What ClawHQ adds:**
- Two-stage build (base image + user customization layer)
- Tool bundling from template integration manifest
- Skill packaging into the workspace
- Build manifest for reproducibility

**Integration point:** ClawHQ wraps Docker CLI. It doesn't modify OpenClaw's Dockerfiles — it builds *on top of them*. The custom layer installs additional tools (himalaya, gh, etc.) that OpenClaw doesn't include by default.

**Key constraint from OpenClaw:** The sandbox images (`Dockerfile.sandbox*`) are separate from the main Gateway image. Sandbox setup requires `scripts/sandbox-setup.sh`. ClawHQ's Build must handle both the Gateway image and sandbox images.

---

### SECURE → Policy Enforcement Across Config + Runtime

**OpenClaw's implementation:**
- `openclaw security audit` (`src/commands/security.ts`) — scans config for known footguns
- `openclaw doctor` (`src/commands/doctor.ts`) — broader diagnostic including security checks
- Config schema enforces some security defaults (e.g., `gateway.auth` required by default)
- Sandbox system (`src/agents/sandbox.ts`) — Docker-based exec isolation
- Tool policy (`tools.allow` / `tools.deny`) — controls what the agent can do
- DM policy per channel (`dmPolicy`) — controls who can talk to the agent
- SecretRef system — avoids plaintext secrets in config

**What ClawHQ adds:**
- Continuous drift detection (compare current config against Plan-generated baseline)
- Credential health probes (live integration testing, not just config validation)
- PII/secret scanning of workspace files
- Supply chain vetting of community skills
- Container hardening beyond OpenClaw's defaults (UID 1000, cap_drop, ICC, egress firewall)
- Firewall management (iptables rules that OpenClaw doesn't manage)

**Integration point:** Security enforcement is a *layer on top of* OpenClaw's existing checks. ClawHQ runs `openclaw security audit` + `openclaw doctor` as a subset, then adds its own checks (firewall state, Docker hardening, credential probes, workspace scanning). The security policy evaluator intercepts config writes (via `config.patch` RPC) and warns before weakening security.

**Key constraint from OpenClaw:** OpenClaw's `doctor` and `security audit` are CLI commands that produce structured output. ClawHQ can invoke them and parse the results. But ClawHQ's own checks (firewall, credential probes, PII scanning) run outside OpenClaw's process.

---

### DEPLOY → Container Lifecycle + Channel Connection

**OpenClaw's implementation:**
- `openclaw gateway` starts the Gateway process
- `openclaw gateway install` installs as a daemon (launchd/systemd)
- Channel connection happens automatically when channel config exists
- `openclaw channels status --probe` checks channel health
- No built-in firewall management
- No built-in pre-flight validation beyond schema checks

**What ClawHQ adds:**
- Pre-flight checklist (Docker running, images exist, config valid, secrets present, ports available)
- `docker compose up` orchestration with correct project context
- Firewall application post-compose (iptables egress rules)
- Network verification (DNS resolution, HTTPS connectivity from inside container)
- Channel connection verification (bidirectional message test)
- Post-deploy smoke test

**Integration point:** ClawHQ calls `docker compose` CLI + `openclaw gateway` CLI + `iptables` directly. This is subprocess orchestration, not API integration. ClawHQ sequences: preflight → compose up → firewall → health poll → channel verify → smoke test.

**Key constraint from OpenClaw:** The Gateway binds to a port and serves the WebSocket + Control UI. ClawHQ must wait for the Gateway to be healthy before connecting via WebSocket for further operations. Health check endpoint: `http://127.0.0.1:18789/healthz`.

---

### OPERATE → Monitoring via Gateway WebSocket + File System

**OpenClaw's implementation:**
- `openclaw status` — shows running state, uptime, channel status
- `openclaw health` — health check
- `openclaw doctor` — diagnostic checks
- `openclaw logs` — stream Gateway logs
- Session data in `~/.openclaw/agents/*/sessions/`
- Cron run logs in `~/.openclaw/cron/runs/`
- Usage tracking built into the Gateway (token counts, cost attribution)
- No built-in backup system
- `openclaw update` — pulls latest version

**What ClawHQ adds:**
- Dashboard aggregating status + cost + cron + memory + identity health in one view
- Backup system (snapshot config + workspace + cron to encrypted archive)
- Memory health tracking (size, growth rate, tier distribution)
- Identity budget tracking (file sizes vs. `bootstrapMaxChars`)
- Cost tracking with budget caps and alerts
- Fleet management (multi-agent monitoring)
- Update safety (pre-update snapshot, post-update doctor, rollback)

**Integration points:**
- Gateway WebSocket for real-time status, session data, usage metrics
- Filesystem for memory sizes, identity file sizes, cron run logs
- `openclaw doctor --json` for structured diagnostic output
- `openclaw logs --follow` for log streaming
- Subprocess calls for backup/restore operations

**Key constraint from OpenClaw:** Usage tracking (token counts, costs) is in the Gateway's runtime state, exposed via WebSocket. Memory and identity files are on the filesystem. ClawHQ needs both channels — WebSocket for live data, filesystem for storage metrics.

---

### EVOLVE → Workspace File Management + Config Patching

**OpenClaw's implementation:**
- Identity files are plain markdown in the workspace — no governance, no versioning
- Memory files accumulate without lifecycle management
- No built-in staleness detection or token budget enforcement
- Config changes via `openclaw config set` or Control UI
- No template upgrade mechanism

**What ClawHQ adds:** (This is where ClawHQ adds the most value over raw OpenClaw)
- Identity governance: structured YAML source of truth → generated markdown
- Memory lifecycle: hot/warm/cold tier transitions with summarization
- Staleness detection and periodic review prompts
- Cross-file consistency checking (TOOLS.md ↔ tools.allow)
- Token budget enforcement (files vs. bootstrapMaxChars)
- Template upgrade with merge semantics
- Integration add/remove/swap with guided flows
- Behavioral analysis from session logs → config recommendations

**Integration points:**
- Filesystem read/write for identity files and memory
- `config.patch` RPC for config changes
- Session history (from `~/.openclaw/agents/*/sessions/`) for behavioral analysis
- Subprocess for LLM-powered summarization during memory tier transitions

**Key constraint from OpenClaw:** OpenClaw treats identity files as opaque markdown. It reads them, includes them in the prompt, and never modifies them. This is *good* for ClawHQ — it means ClawHQ owns the identity file lifecycle completely. OpenClaw won't interfere.

---

### DECOMMISSION → Filesystem + Docker Cleanup

**OpenClaw's implementation:**
- `openclaw uninstall` — removes the daemon service
- No structured export/destroy mechanism
- No cryptographic destruction verification

**What ClawHQ adds:**
- Export bundle (portable archive of identity, memory, config, workspace)
- Structured destruction sequence (stop → remove containers → wipe workspace → wipe config → wipe secrets → remove images → remove networks → remove firewall)
- Cryptographic verification of destruction
- Partial decommission (migration, fresh start, template change)

**Integration point:** Filesystem operations + Docker CLI + iptables. This is all subprocess work — no Gateway interaction needed (the Gateway is being shut down).

---

## The Integration Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   ClawHQ Web Console                     │
│            (or CLI — same operations)                    │
└─────────────┬─────────────┬──────────────┬──────────────┘
              │             │              │
    ┌─────────▼─────────┐  │  ┌───────────▼───────────┐
    │  Config Operations │  │  │  File Operations      │
    │  (config.patch RPC │  │  │  (workspace, memory,  │
    │   via WebSocket)   │  │  │   cron, identity)     │
    └─────────┬──────────┘  │  └───────────┬───────────┘
              │             │              │
              │   ┌─────────▼──────────┐   │
              │   │  Subprocess Calls  │   │
              │   │  (docker, iptables,│   │
              │   │   openclaw doctor, │   │
              │   │   openclaw update) │   │
              │   └─────────┬──────────┘   │
              │             │              │
              ▼             ▼              ▼
┌─────────────────────────────────────────────────────────┐
│                   OpenClaw Gateway                        │
│                                                          │
│  Config      Sessions    Channels     Agent Runtime      │
│  (openclaw   (session    (telegram/   (PiEmbedded        │
│   .json)     files)      discord/     Runner)            │
│                          slack/...)                       │
│                                                          │
│  Cron        Hooks       Skills       Browser            │
│  (cron/      (webhook    (workspace/  (CDP/Chrome)       │
│   jobs.json)  handlers)   skills/)                       │
│                                                          │
│  Plugins     Memory      Sandbox      WebSocket Hub     │
│  (extensions/ (memory/   (Docker      (:18789)           │
│   loaded)     *.md)       exec)                          │
└─────────────────────────────────────────────────────────┘
```

### Three Communication Channels

| Channel | What it's for | When to use |
|---------|--------------|-------------|
| **WebSocket RPC** | Config read/write, session ops, status, real-time events | Anything the Gateway manages at runtime |
| **Filesystem** | Workspace files, memory, identity, cron jobs, backups | Anything that's stored as files |
| **Subprocess** | Docker, iptables, openclaw CLI commands, system operations | Anything that needs OS-level access |

### Self-Operated vs. Managed Mode

**Self-operated:** ClawHQ CLI runs on the same machine as the Gateway. It uses all three channels directly — WebSocket to localhost, direct filesystem access, direct subprocess calls.

**Managed:** ClawHQ's `agentd` daemon runs on the agent's VM. The web console connects to `agentd` via HTTPS. `agentd` proxies operations to the local Gateway (WebSocket), filesystem, and subprocesses. The web console never talks to the Gateway directly — `agentd` is the intermediary.

```
Self-Operated:
  ClawHQ CLI → Gateway WebSocket (localhost)
             → Filesystem (direct)
             → Subprocess (direct)

Managed:
  Web Console → agentd (HTTPS) → Gateway WebSocket (localhost)
                                → Filesystem (direct)
                                → Subprocess (direct)
```

---

## What ClawHQ Does NOT Need to Do

Understanding what OpenClaw already handles well is as important as understanding the gaps:

1. **Message routing** — OpenClaw's auto-reply router handles channel → session → agent dispatch. ClawHQ doesn't touch this.

2. **Model API calls** — The agent runtime handles model selection, failover, and streaming. ClawHQ configures it but doesn't execute it.

3. **Tool execution** — The agent runtime dispatches tools (exec, browser, web_search, etc.). ClawHQ sets the policy but doesn't intercept execution.

4. **Session persistence** — OpenClaw manages session files automatically. ClawHQ reads them for analytics but doesn't write them.

5. **Channel protocol handling** — Each channel adapter handles authentication, message parsing, and outbound formatting. ClawHQ configures channel credentials but doesn't handle protocol details.

6. **Config schema validation** — The Gateway validates config on load. ClawHQ should validate before writing (using the same schema), but the Gateway is the final authority.

---

## Config Surface Map → OpenClaw Implementation Mapping

This connects the config surface map to actual source files so we know what we're configuring:

| Config Surface | OpenClaw Source | Runtime Location |
|---------------|----------------|-----------------|
| `identity.*` | `src/config/schema.ts` → `src/agents/prompt-builder.ts` | Loaded per agent turn |
| `agents.*` | `src/config/schema.ts` → `src/agents/piembeddedrunner.ts` | Loaded at Gateway startup |
| `models.*` | `src/config/schema.ts` → model provider modules | Loaded at Gateway startup |
| `channels.*` | `src/config/schema.ts` → channel adapter startup | Channel connects on Gateway boot |
| `tools.*` | `src/config/schema.ts` → tool policy engine | Evaluated per tool call |
| `sandbox.*` | `src/config/schema.ts` → `src/agents/sandbox.ts` | Docker exec per sandbox session |
| `session.*` | `src/config/schema.ts` → `src/config/sessions.ts` | Session resolution per message |
| `gateway.*` | `src/config/schema.ts` → `src/gateway/server.ts` | Applied at Gateway startup (restart required) |
| `cron.*` | `src/config/schema.ts` → cron scheduler | Jobs loaded at Gateway startup |
| `hooks.*` | `src/config/schema.ts` → webhook handler | Applied at Gateway startup |
| `browser.*` | `src/config/schema.ts` → browser controller | Applied when browser tool invoked |
| `skills.*` | `src/config/schema.ts` → skills loader | Skills registered at Gateway startup |
| `plugins.*` | `src/config/schema.ts` → `src/plugins/loader.ts` | Plugins loaded at Gateway startup |
| `memorySearch.*` | `src/config/schema.ts` → `src/memory/` | Queried during prompt build |
| `discovery.*` | `src/config/schema.ts` → mDNS/Bonjour module | Applied at Gateway startup |
| `secrets.*` | `src/config/schema.ts` → SecretRef resolver | Resolved at config load time |
| Workspace files | Filesystem (`~/.openclaw/workspace/`) | Read by prompt-builder per turn |
| Cron jobs | Filesystem (`~/.openclaw/cron/jobs.json`) | Loaded by cron scheduler |
| `.env` | Filesystem (`~/.openclaw/.env`) | Loaded at process start |

---

## Build Priority: What to Build First

Based on how OpenClaw actually works, the build priority for ClawHQ should be:

### Phase 1: Read-Only Monitoring (Operate toolchain, read-only)
- Connect to Gateway WebSocket
- Display status (from `openclaw status` equivalent RPC)
- Display cron job status (read `cron/runs/*.jsonl`)
- Display workspace metrics (filesystem stats)
- Stream logs (from Gateway log stream)
- Run `openclaw doctor` and display results

*Why first:* Doesn't write anything. Zero risk. Immediately useful. Proves the WebSocket integration works.

### Phase 2: Config Editing (Plan toolchain, write path)
- Config panels that produce `config.patch` RPCs
- Gateway & auth panel (gateway.*)
- Model configuration panel (agents.defaults.model.*, models.providers.*)
- Channel setup wizards (channels.*)
- Tool policy panel (tools.allow, tools.deny)

*Why second:* Uses the same RPC the Control UI already uses. The Gateway validates everything. Risk is low because the Gateway rejects bad config.

### Phase 3: Workspace Editing (Evolve toolchain)
- Identity file editors (SOUL.md, USER.md, etc.) with token budget display
- Memory file browser with size tracking
- Skills browser and installer

*Why third:* Filesystem writes. More risk than config RPC because there's no schema validation on markdown files. Token budget enforcement must be in ClawHQ.

### Phase 4: Lifecycle Operations (Deploy + Secure + Decommission)
- Docker compose orchestration
- Firewall management
- Backup/restore
- Export/destroy
- Credential health probes

*Why fourth:* Subprocess calls with OS-level permissions (Docker, iptables, sudo). Highest risk. Needs the most testing. But also the highest differentiation — this is where ClawHQ pulls away from basic dashboards.
