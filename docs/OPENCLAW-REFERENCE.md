# OpenClaw Implementation Reference

> Technical research and implementation details for building ClawHQ on top of OpenClaw.
> This document is the engineering companion to `PRODUCT.md`. Everything here was extracted from running a production OpenClaw agent for months.

**Updated:** 2026-03-12

---

## Table of Contents

1. [OpenClaw Overview](#openclaw-overview)
2. [Internal Architecture](#internal-architecture)
3. [Four Integration Surfaces](#four-integration-surfaces)
4. [Three Communication Channels](#three-communication-channels)
5. [What OpenClaw Already Handles](#what-openclaw-already-handles)
6. [The 14 Configuration Landmines](#the-14-configuration-landmines)
7. [Configuration Surface Inventory](#configuration-surface-inventory)
8. [Config Surface → Source Mapping](#config-surface--source-mapping)
9. [Key Configuration Surfaces (Detail)](#key-configuration-surfaces-detail)
10. [Config Management Meta-Capabilities](#config-management-meta-capabilities)
11. [Container Hardening Matrix](#container-hardening-matrix)
12. [Credential Health Probes](#credential-health-probes)
13. [PII & Secret Scanning Patterns](#pii--secret-scanning-patterns)
14. [Egress Firewall Implementation](#egress-firewall-implementation)
15. [Memory Lifecycle Research](#memory-lifecycle-research)
16. [Identity Drift Research](#identity-drift-research)
17. [Template System Design](#template-system-design)
18. [Competitive Landscape](#competitive-landscape)
19. [The cPanel Analogy](#the-cpanel-analogy)

---

## OpenClaw Overview

OpenClaw is a persistent AI agent framework with tools, memory, cron jobs, and messaging integrations — running in a Docker container the user controls. It is a single Node.js process (the **Gateway**) that acts as a control plane. Everything else connects to it.

Key facts:
- Single process, single config file (`openclaw.json`), filesystem-backed state (no database except SQLite for memory search)
- ~13,500 tokens of configuration across 11+ files
- ~200+ configurable fields
- CLI talks to Gateway via WebSocket RPC
- Control UI is a Lit web-component app served by the Gateway itself
- Channels (WhatsApp, Telegram, Discord, Slack, Signal, iMessage) are compiled-in adapters; plugin channels (Teams, Matrix, etc.) loaded by `src/plugins/loader.ts`
- Agent runtime (`PiEmbeddedRunner`) runs in-process; tools are function calls or Docker exec for sandboxed ops
- Config schema is TypeBox (`src/config/schema.ts`) — unknown keys cause Gateway to refuse to start

---

## Internal Architecture

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

---

## Four Integration Surfaces

ClawHQ attaches to OpenClaw through exactly four surfaces:

### Surface 1: The Config File

`~/.openclaw/openclaw.json` — Controls everything about runtime behavior. ClawHQ writes config via the Gateway's `config.patch` / `config.apply` RPC over WebSocket (preferred), or writes the file directly when the Gateway is down. Every panel in the web console ultimately produces a `config.patch` RPC call.

### Surface 2: The Workspace

`~/.openclaw/workspace/` — Contains identity files (SOUL.md, USER.md, AGENTS.md, TOOLS.md, HEARTBEAT.md, IDENTITY.md, BOOT.md, BOOTSTRAP.md), memory files, skills, and custom tools. ClawHQ reads and writes these as plain files. The key constraint is `bootstrapMaxChars` — identity files that exceed it get silently truncated.

### Surface 3: The Cron System

`~/.openclaw/cron/` — Contains `jobs.json` (job definitions) and `runs/<jobId>.jsonl` (execution history). ClawHQ writes jobs and reads run logs. The Gateway hot-reloads cron config.

### Surface 4: The Gateway WebSocket API

Exposes config management, session RPCs, gateway status/health/restart, agent RPCs, and device management. All communication is authenticated. Rate limited to 3 req/60s for config writes.

---

## Three Communication Channels

| Channel | What it's for | When to use |
|---------|--------------|-------------|
| **WebSocket RPC** | Config read/write, session ops, status, real-time events | Anything the Gateway manages at runtime |
| **Filesystem** | Workspace files, memory, identity, cron jobs, backups | Anything stored as files |
| **Subprocess** | Docker, iptables, openclaw CLI commands, system operations | Anything needing OS-level access |

### Communication Patterns by Mode

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

## What OpenClaw Already Handles

Understanding what OpenClaw already does well — ClawHQ should NOT replicate these:

1. **Message routing** — OpenClaw's auto-reply router handles channel → session → agent dispatch
2. **Model API calls** — The agent runtime handles model selection, failover, and streaming
3. **Tool execution** — The agent runtime dispatches tools; ClawHQ sets policy but doesn't intercept
4. **Session persistence** — OpenClaw manages session files automatically
5. **Channel protocol handling** — Each channel adapter handles auth, parsing, and formatting
6. **Config schema validation** — The Gateway validates config on load; ClawHQ validates before writing, but the Gateway is the final authority

### Existing OpenClaw CLI Commands

| Command | What it does | ClawHQ relationship |
|---------|-------------|---------------------|
| `openclaw onboard` | Minimal model/channel setup wizard | ClawHQ replaces with full config bundle |
| `openclaw doctor` | Basic diagnostics (structured output with `--json`) | ClawHQ runs as subset, adds its own checks |
| `openclaw security audit` | Security checks | ClawHQ runs as subset, adds firewall/Docker/credential checks |
| `openclaw status` | Basic status | ClawHQ aggregates into richer dashboard |
| `openclaw health` | Health check | ClawHQ uses for health verification |
| `openclaw logs` | Log streaming | ClawHQ wraps with filtering |
| `openclaw update` | Basic update | ClawHQ adds pre-update snapshot, post-update doctor, rollback |
| `openclaw gateway` | Starts Gateway | ClawHQ orchestrates via Docker compose |
| `openclaw gateway install` | Daemon installation (launchd/systemd) | ClawHQ manages via Docker instead |
| `openclaw channels status --probe` | Channel health | ClawHQ uses for channel verification |
| `openclaw uninstall` | Removes daemon service | ClawHQ adds structured export/destroy/verify |
| `openclaw config set` | WebSocket RPC to set config | ClawHQ uses same RPC path |

---

## The 14 Configuration Landmines

Every item below was discovered running a production agent. Each silently breaks the agent — no errors, no warnings.

| # | Landmine | What Goes Wrong | What to Check |
|---|---|---|---|
| 1 | `dangerouslyDisableDeviceAuth: true` missing | "Device signature invalid" loop — agent becomes inaccessible | Key present and `true` in `openclaw.json` |
| 2 | `allowedOrigins` stripped after onboard | Control UI returns CORS errors, can't manage agent via web | Array contains expected origin |
| 3 | `trustedProxies` stripped after onboard | Gateway rejects requests through Docker NAT | Array contains Docker bridge gateway IP |
| 4 | `tools.exec.host` set to wrong value | `"node"` fails (no companion), `"sandbox"` fails (no Docker-in-Docker) | Value is `"gateway"` |
| 5 | `tools.exec.security` not `"full"` | Tool execution silently restricted | Value is `"full"` |
| 6 | Container user not UID 1000 | Permission errors on mounted volumes | Compose file specifies `user: "1000:1000"` |
| 7 | ICC enabled on agent network | Containers can communicate (security breach) | Docker network inspect shows ICC disabled |
| 8 | Identity files exceed `bootstrapMaxChars` | Files silently truncated — agent loses personality context | Sum of identity file sizes vs. threshold (default 20K) |
| 9 | Cron stepping syntax invalid | `5/15` is invalid, must be `3-58/15` — jobs silently don't run | Regex validation on all cron expressions |
| 10 | External networks not created | Compose fails or containers can't reach services | `docker network ls` for required networks |
| 11 | `.env` missing required variables | Container starts but integrations silently fail | Cross-reference compose env vars vs. `.env` |
| 12 | Config/credentials not read-only mount | Agent can modify its own config | Volume mount flags in compose |
| 13 | Firewall not applied after network recreate | Agent runs without egress filtering | `iptables -L CLAWHQ_FWD` |
| 14 | `fs.workspaceOnly` misconfigured | Too restrictive (can't read media) or too permissive (reads host FS) | Value matches expected for template security posture |

---

## Configuration Surface Inventory

### Config Surface → Source Mapping

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

### Field Inventory by Category

| Category | Total Fields | Critical | Important | Nice-to-have |
|----------|-------------|----------|-----------|-------------|
| Identity & Persona | 12 | 2 | 4 | 6 |
| AI Models | 15 | 4 | 6 | 5 |
| Channels | 30+ per provider | 8 | 10 | 12+ |
| Agents | 25 | 3 | 14 | 8 |
| Tools & Permissions | 35 | 5 | 8 | 22 |
| Sandbox & Isolation | 25 | 1 | 6 | 18 |
| Sessions | 9 | 1 | 5 | 3 |
| Gateway Server | 12 | 5 | 4 | 3 |
| Automation (Cron & Hooks) | 18 | 0 | 10 | 8 |
| Browser | 3 | 0 | 1 | 2 |
| Skills | 3+ | 0 | 3 | 0 |
| Plugins | 2+ | 0 | 0 | 2+ |
| Media/Audio | 4 | 0 | 2 | 2 |
| Memory & Search | 3 | 0 | 2 | 1 |
| Messages/UI | 3 | 0 | 2 | 1 |
| Networking | 4 | 0 | 2 | 2 |
| Secrets | 2+ | 2 | 0 | 0 |
| Environment | 4 | 0 | 2 | 2 |
| **TOTAL** | **~200+** | **~31** | **~81** | **~97** |

---

## Key Configuration Surfaces (Detail)

### Identity & Persona

`identity.name`, `identity.theme`, `identity.emoji`, `identity.avatar` in config; plus 8 workspace files (SOUL.md, IDENTITY.md, USER.md, AGENTS.md, TOOLS.md, BOOT.md, BOOTSTRAP.md, HEARTBEAT.md) needing markdown editors with token budget display.

### AI Models

Primary model (`agents.defaults.model.primary`), fallback chain (`agents.defaults.model.fallbacks`), provider API keys via SecretRef (`models.providers.<name>.apiKey`). Built-in providers: anthropic, openai, google, deepseek, mistral, openrouter, xai, minimax, ollama. Auth profiles for credential rotation.

### Channels

20+ providers, each with `enabled`, `botToken`, `dmPolicy` (pairing/allowlist/open/disabled), `allowFrom`, `groupPolicy`, `configWrites`. Channel-specific fields: WhatsApp uses phone numbers, Telegram uses bot tokens + user IDs, Discord needs applicationId + guildId, Slack needs botToken + appToken + signingSecret, iMessage needs cliPath + dbPath.

### Tools & Permissions

`tools.profile` (coding/messaging/custom), `tools.allow`/`tools.deny` with group support (`group:runtime`, `group:fs`, `group:sessions`, etc.). Exec tool: `tools.exec.host` (sandbox/gateway/node), `tools.exec.security` (allowlist/ask/auto), `tools.exec.safeBins`. Web tools: search provider selection, API keys, fetch limits.

### Gateway Server

`gateway.port` (18789), `gateway.bind` (127.0.0.1 default — `0.0.0.0` needs security warning), `gateway.auth.token`/`gateway.auth.password`, `gateway.reload.mode` (hybrid/hot/restart/off). Changes require restart.

### Sandbox & Isolation

`sandbox.mode` (off/non-main/all), `sandbox.scope` (session/agent/shared), Docker settings (image, network, readOnlyRoot, memory, cpus, pidsLimit, user, capDrop, tmpfs, seccompProfile).

### Sessions

`session.dmScope` (main/per-peer/per-channel-peer/per-account-channel-peer), identity links, reset mode (daily/idle/manual), thread bindings.

### Automation

`cron.enabled`, `cron.maxConcurrentRuns`, jobs in `cron/jobs.json` with visual builder. Hooks: `hooks.enabled`, `hooks.token`, `hooks.mappings[]` for webhook routing, Gmail Pub/Sub integration.

### Secrets

`secrets.providers` for env/file/exec backends. Any field accepting a SecretRef needs a toggle: "Paste value" vs. "Reference secret."

---

## Config Management Meta-Capabilities

| Capability | Description | Priority |
|-----------|-------------|----------|
| Config validation | Run `openclaw doctor` equivalent before saving | Critical |
| Config diff view | Show what changed before apply | Critical |
| Config backup on change | Auto-backup before every write | Critical |
| Hot reload indicator | Show whether a change needs restart or applies live | Important |
| Config versioning | Git-backed config history with diff and rollback | Important |
| Raw JSON editor | Escape hatch for power users with syntax highlighting + validation | Critical |
| Config export/import | Download/upload complete config as JSON5 | Important |
| `$include` management | Visual split/merge for multi-file configs | Nice-to-have |

### MVP Panel Build Order (Config Surfaces)

1. **Gateway & Auth** — Port, bind, token. If this is wrong nothing else works.
2. **Model Configuration** — Primary model, API keys, test connection. Core value prop.
3. **Channel Setup** — At least WhatsApp + Telegram + Discord. Wizard-driven.
4. **Identity & Persona** — SOUL.md editor, name, emoji. Emotional hook for users.
5. **Tool Policy** — Allow/deny toggles. Critical for security.
6. **Session Management** — DM scope, reset policy. Prevents cross-contamination.
7. **Cron Jobs** — Visual builder. Unlocks automation value.
8. **Secrets Management** — Unified secret handling. Security differentiator.
9. **Sandbox Configuration** — Docker settings. Enterprise requirement.
10. **Everything else** — Skills, plugins, browser, media, hooks, networking.

---

## Container Hardening Matrix

| Control | Standard | Hardened | Paranoid |
|---|---|---|---|
| Linux capabilities | `cap_drop: ALL` | `cap_drop: ALL` | `cap_drop: ALL` |
| Filesystem | Read-only rootfs | Read-only rootfs | Read-only rootfs + encrypted workspace |
| Privilege escalation | `no-new-privileges` | `no-new-privileges` | `no-new-privileges` |
| User | Non-root (UID 1000) | Non-root (UID 1000) | Non-root (UID 1000) |
| Temp storage | tmpfs 256MB, noexec/nosuid | tmpfs 128MB, noexec/nosuid | tmpfs 64MB, noexec/nosuid |
| Network isolation | ICC disabled | ICC disabled | ICC disabled + allowlist egress |
| Resource limits | 4 CPU, 4GB RAM | 2 CPU, 2GB RAM | 1 CPU, 1GB RAM |
| Identity files | Read-only mount | Read-only mount | Read-only mount + integrity hash |
| Workspace | Writable (scoped) | Writable (scoped) | Writable (encrypted at rest) |

### Network & Access Hardening

| Control | What It Prevents | Implementation |
|---|---|---|
| Gateway binding | Publicly exposed instances via `0.0.0.0` binding | Enforce loopback-only binding by default |
| WebSocket origin validation | Cross-site WebSocket hijacking (ClawJacked vector) | Origin header validation on all upgrade requests |
| CSRF protections | Unauthorized state changes via cross-site requests | Token-based guards on all state-changing operations |
| mDNS/Bonjour control | Network reconnaissance via service discovery | Disable service discovery broadcasts in container |
| Secure remote access | Raw port exposure | Tailscale, SSH tunnels, or Cloudflare Tunnel only |
| Device pairing | Silent auto-pairing on localhost | Explicit device registration approval required |
| Auth failure tracking | Brute-force attacks | Failed auth logging with fail2ban integration |

---

## Credential Health Probes

| Integration | Health Probe | What It Tests |
|---|---|---|
| Email (IMAP) | `himalaya account check` | IMAP + SMTP auth, server reachable |
| Calendar (CalDAV) | CalDAV PROPFIND request | Auth valid, calendar accessible |
| Tasks (Todoist) | `todoist projects` list | API key valid, API reachable |
| Code (GitHub) | `gh auth status` | PAT valid, scopes sufficient |
| Research (Tavily) | Search query | API key valid, quota remaining |
| Finance (Yahoo) | Quote fetch | Endpoint reachable (no auth) |

Probes run on schedule (configurable per template). Failures trigger alerts with specific remediation steps. Credential expiry tracked where APIs expose it — 7-day advance warnings.

---

## PII & Secret Scanning Patterns

### Scan Targets

| Scan Target | What It Catches | How |
|---|---|---|
| Agent repos | PII (names, addresses, phone, SSN, credit cards) | Regex patterns with false-positive filtering |
| Agent repos | Secrets (API keys: `ghp_*`, `sk-ant-*`, `AKIA*`, Bearer tokens, JWTs) | Pattern matching + entropy analysis |
| Agent repos | Dangerous files (`.env`, `*.pem`, `*.key`, `id_rsa*`, `*.db`) | Filename patterns |
| Git history | Previously committed secrets | `git log` pattern scan |
| Repo settings | Public repos that should be private, unauthorized collaborators, deploy keys | GitHub API policy checks |

### False Positive Exclusions

The scanner skips: `CHANGE_ME` placeholders, environment variable references (`$VAR`), comments explaining patterns, and functional identity references in designated files (USER.md, MEMORY.md).

### Supply Chain Security

| Control | What It Does |
|---|---|
| Skill vetting | AI-powered scanning of community skills before installation; VirusTotal integration |
| Skill allowlisting | Internal registry of approved skills only; block unapproved installs |
| IOC database | Known C2 IPs, malicious domains, file hashes, publisher blacklists from known campaigns |
| CVE monitoring | Automated NVD CVE polling; community threat intelligence feeds; same-day fleet patching |

---

## Egress Firewall Implementation

iptables rules restricting container network access:

- Allow established/related connections (return traffic)
- Allow DNS (UDP/TCP 53) — required for API resolution
- Allow HTTPS (TCP 443) — required for API calls
- Log and drop everything else

The firewall is implemented as a dedicated iptables chain (`CLAWHQ_FWD`) attached to the Docker bridge interface.

**Critical operational detail:** After every `docker compose down`, Docker destroys and recreates the bridge interface, invalidating the chain. ClawHQ detects this and reapplies automatically — a landmine that has caused hours of debugging in manual setups. The Deploy toolchain applies the firewall; Doctor verifies it continuously.

---

## Memory Lifecycle Research

Without management, agent memory grows at ~120KB/day during active use (360KB in 3 days observed in production).

### Tier Model

```
Hot (in context)          Warm (indexed)           Cold (archived)
≤7 days, ≤100KB          7-90 days                90+ days
Full fidelity             Summarized, indexed      Summarized, compressed
In every conversation     Searchable on demand     Retrievable on demand
```

### Transitions

| Transition | What Happens | When |
|---|---|---|
| Hot → Warm | Conversation memories older than 7 days are summarized, key facts extracted, full text moved to warm storage | Daily (configurable) |
| Warm → Cold | Warm memories older than 90 days are further compressed, PII masked, archived | Weekly (configurable) |
| Cold → Deleted | Cold memories older than retention period are permanently removed | Per retention policy |

Each transition preserves important information while reducing token cost. Summarization is LLM-powered (using the agent's own subagent model) — it understands context, not just truncation. PII masking runs at each transition.

---

## Identity Drift Research

The agent's identity is defined by structured files (SOUL.md, USER.md, AGENTS.md, HEARTBEAT.md, TOOLS.md). Without governance, these files drift:

| Drift Type | What Happens |
|---|---|
| **Bloat** | Files grow as users add context, exceeding `bootstrapMaxChars` and getting silently truncated |
| **Staleness** | Information becomes outdated (old job title, changed interests, deprecated tools) |
| **Contradiction** | Different files make conflicting claims (SOUL says "never trade stocks," TOOLS lists a trading tool) |
| **Scope creep** | Agent's role expands gradually beyond original intent |

OpenClaw treats identity files as opaque markdown — it reads them, includes them in the prompt, and never modifies them. This means ClawHQ owns the identity file lifecycle completely without interference.

---

## Template System Design

### Template Schema (Example: Guardian)

```yaml
# template.yaml — Guardian template (the production-tested default)
name: "Guardian"
version: "1.0.0"
author: "clawhq"
category: "personal"
description: "Proactive steward — manages your digital life, pushes back when needed"

personality:
  tone: direct
  style: "proactive, no sugarcoating, protective of user's time and attention"
  relationship: "trusted steward"
  boundaries: "will challenge bad ideas, will refuse harmful requests"

security:
  posture: hardened            # standard | hardened | paranoid
  egress: restricted           # default | restricted | allowlist-only
  identity_mount: read-only    # read-only | writable

monitoring:
  heartbeat_frequency: "10min"
  checks: [email, calendar, tasks, markets]
  quiet_hours: "23:00-05:00"
  alert_on: [credential_expiry, memory_bloat, cron_failure, integration_degraded]

memory:
  hot_max: "100KB"
  hot_retention: "7d"
  warm_retention: "90d"
  cold_retention: "365d"
  summarization: balanced

cron:
  waking_hours: "05:00-23:00"
  heartbeat: "*/10 waking"
  work_session: "*/15 waking"
  morning_brief: "08:00"

autonomy:
  default: high
  requires_approval: [large_purchases, account_changes, public_posts]

integrations_required: [messaging]
integrations_recommended: [email, calendar, tasks]
skills_included: [morning-brief, construct]
```

### Template Dimensions

| Dimension | What the Template Controls | Why It Matters |
|---|---|---|
| **Personality** | Tone, relationship model, communication style, boundaries | Defines how the agent interacts |
| **Security posture** | Hardening level, egress rules, isolation mode | Different use cases need different security |
| **Monitoring profile** | Alert thresholds, check frequency, escalation rules | Guardian alerts aggressively; analyst minimizes interruption |
| **Memory policy** | Hot/warm/cold tier sizes, summarization aggressiveness, retention periods | Companion retains emotional context; assistant prunes aggressively |
| **Cron configuration** | Heartbeat frequency, quiet hours, waking hours, budget caps | Coach checks in frequently; analyst runs on-demand |
| **Autonomy model** | What the agent handles independently vs. flags for approval | Guardian: high autonomy. Assistant: handles routine, escalates exceptions |
| **Integration requirements** | Which tool categories are required, recommended, or optional | Coach requires tasks + calendar. Analyst requires research + code. |
| **Skill bundle** | Which pre-built skills are included | Morning brief, email digest, meeting prep, etc. |

### Built-in Templates

| Template | Relationship | Operational Profile |
|---|---|---|
| **Guardian** | Steward, protector | High autonomy, aggressive monitoring, hardened security, pushes back |
| **Assistant** | Professional aide | Medium autonomy, balanced monitoring, handles routine, flags exceptions |
| **Coach** | Accountability partner | Frequent check-ins, goal tracking, encouraging but firm |
| **Analyst** | Research partner | Low proactivity, deep on demand, minimal interruption |
| **Companion** | Conversational partner | Long memory retention, emotional context, warm check-ins |
| **Custom** | User-defined | Guided builder or raw YAML |

### Config Generator Output

The `clawhq init` wizard generates a complete deployment bundle:

| Generated File | Contents | Landmines Auto-Handled |
|---|---|---|
| `openclaw.json` | Runtime config — models, tools, gateway, channels, agents | #1-5, #14 |
| `.env` | Secrets — API keys, tokens, session keys (mode 0600) | #11: token format validation, no secrets in config |
| `docker-compose.yml` | Container orchestration — volumes, networks, security | #6, #7, #10, #12: UID 1000, cap_drop ALL, read-only rootfs, ICC disabled |
| `Dockerfile` | Custom layer — binary installs from GitHub releases (himalaya, gh, curl, jq, rg, git, ffmpeg) | Composed from integration selections |
| `workspace/SOUL.md` | Agent mission, principles, hard stops, data covenant | #8: token budget vs. `bootstrapMaxChars` |
| `workspace/USER.md` | User context placeholder | #8: kept within token budget |
| `workspace/IDENTITY.md` | Agent name, personality summary | Auto-generated from template |
| `workspace/AGENTS.md` | Operating instructions — session startup, memory, async tools, red lines | Auto-populated from template personality |
| `workspace/HEARTBEAT.md` | Recon phases — auto-populated from enabled integrations | #9: schedule syntax validated |
| `workspace/TOOLS.md` | Tool inventory — auto-generated from installed CLI tools + cron schedule | Cross-referenced against actually-installed tools |
| `workspace/MEMORY.md` | Long-term memory skeleton with sections | Pre-structured for the agent |
| `workspace/<tool>` | 7 CLI tools — email, tasks, todoist, ical, quote, tavily, todoist-sync | Generated based on integration selections, chmod +x |
| `workspace/skills/` | Construct (self-improvement) + morning-brief skill templates | Skills from template's `skillsIncluded` |
| `cron/jobs.json` | Scheduled job definitions (OpenClaw native format) | #9: stepping syntax validated, timezone-correct |

### Cron Job Format (OpenClaw native)

```json
{
  "id": "heartbeat",
  "kind": "cron",
  "expr": "0-59/10 5-23 * * *",
  "task": "Run the heartbeat cycle as defined in HEARTBEAT.md",
  "enabled": true,
  "delivery": "announce",
  "activeHours": { "start": 5, "end": 23, "tz": "America/Los_Angeles" }
}
```

Fields: `kind` ("cron" | "every"), `expr` (5-field cron), `everyMs` (interval), `delivery` ("announce" | "none" | "errors"), `model` (per-job override), `session` ("main" | "isolated"), `activeHours` (waking hours constraint).

### Multi-Agent Support

OpenClaw natively supports multiple agents via `agents.list[]` + `bindings[]`:

```json
{
  "agents": {
    "list": [
      { "id": "clawdius", "default": true, "workspace": "/home/node/.openclaw/workspace" },
      { "id": "clawdia", "workspace": "/home/node/.openclaw/agents/clawdia/agent/workspace" }
    ],
    "bindings": [
      { "agentId": "clawdia", "match": { "channel": "telegram", "peer": { "kind": "direct", "id": "<chat-id>" } } }
    ]
  }
}
```

`clawhq agent add <id>` scaffolds a new agent within an existing deployment — creates workspace, identity files, memory directories, and updates `openclaw.json`.

---

## Competitive Landscape

### Market Options

| Option | What You Get | What's Missing |
|---|---|---|
| **Raw OpenClaw** | Full power, full control | Months of setup, ongoing SRE, no lifecycle management |
| **Basic OpenClaw hosting** (10+ providers) | Someone runs the container | Default config, no hardening, no memory mgmt, no evolution |
| **Community dashboards** | Basic monitoring, read-only views | No security, no lifecycle, no configuration management |
| **Security point tools** (ClawSec, security-monitor) | Hardening guides, scanning | Fragmented, no unified platform, manual execution |
| **No-code agent builders** (Lindy, Relevance AI) | Workflow automation | Not true persistent agents, SaaS data handling |
| **Big-tech agents** (Google, Apple, MS) | Polished, integrated, easy | Platform lock-in, no sovereignty, black box |
| **ChatGPT / Claude** (direct) | Best models, growing memory | Platform-controlled, no customization, no operational layer |

### Market Gap Analysis

| Domain | Current Market Coverage | Gap Severity |
|---|---|---|
| Provisioning & Deploy | Well-served by 10+ hosting providers | Low |
| Security Hardening | Fragmented: guides + point tools; no unified self-serve platform | **Critical** |
| Monitoring & Observability | Partial: community dashboards cover basics | High |
| Agent Lifecycle | Weak: most dashboards are read-only | High |
| Configuration Management | Very weak: most config requires CLI/JSON editing | **Critical** |
| Operations & Maintenance | Fragmented: updates manual, backups DIY | **Critical** |
| Governance & Compliance | Nearly nonexistent for self-hosted | **Critical** |

### Positioning

```
Raw framework ←──────────────────────────────────→ Platform lock-in
OpenClaw         Basic hosting      CLAWHQ          Big-tech agents
(powerful,       (default config,   (control panel,     (polished,
 expert-only)    no lifecycle)      full lifecycle)     captive)
```

---

## The cPanel Analogy

Every successful open-source infrastructure engine follows this pattern:

| Engine | Operational Burden | Control Panel |
|---|---|---|
| Linux | Server admin, security, mail, cron | cPanel, Plesk, Webmin |
| WordPress | Hosting, updates, security, backups | WordPress.com, managed WP hosting |
| AWS/multi-cloud | Infrastructure provisioning, governance | RightScale, CloudFormation |
| Kubernetes | Container orchestration, networking | Rancher, OpenShift |
| **OpenClaw** | **Agent config, security, monitoring, evolution** | **ClawHQ** |

In the early 2000s, Linux was powerful but operationally brutal — configuring Apache, managing SSL, setting up email, writing cron jobs, hardening security. Then cPanel, Plesk, and Webmin emerged. They didn't replace Linux. They made it usable. The server was the engine. The panel made it run.

---

## Two-Stage Docker Build Architecture

```
Stage 1: openclaw:local (base image)
├── OpenClaw source (upstream)
├── apt packages: tmux, ffmpeg, jq, ripgrep (configurable per template)
├── Node.js runtime + dependencies
└── Base tools: git, curl, openssl

Stage 2: openclaw:custom (user layer)
├── himalaya (IMAP email client, static musl binary)
├── gh (GitHub CLI)
├── Additional tools declared by template
├── Integration CLI wrappers (todoist, ical, quote, tavily, email)
├── Skills (morning-brief, construct, etc.)
└── Custom user tools
```

Stage 1 rebuilds only when OpenClaw upstream changes or apt packages change. Stage 2 rebuilds when tools, skills, or integration wrappers change. ClawHQ wraps Docker CLI — it builds *on top of* OpenClaw's Dockerfiles (`Dockerfile`, `Dockerfile.sandbox`, `Dockerfile.sandbox-browser`, `Dockerfile.sandbox-common`), not by modifying them. Sandbox setup requires `scripts/sandbox-setup.sh`.

---

## Integration Layer Design

### Provider-Agnostic Categories

| Category | Example Providers | Interface |
|---|---|---|
| **Email** | Gmail, iCloud, Outlook, Fastmail, ProtonMail | `email inbox`, `email send`, `email search` |
| **Calendar** | Google, iCloud, Outlook, Fastmail | `calendar today`, `calendar create` |
| **Tasks** | Todoist, TickTick, Linear, Notion, Asana | `tasks list`, `tasks add`, `tasks complete` |
| **Messaging** | Telegram, WhatsApp, Slack, Discord, Signal, iMessage, Teams, Matrix | Channel config |
| **Files** | Google Drive, Dropbox, iCloud Drive | `files list`, `files get` |
| **Code** | GitHub, GitLab, Sentry | `code repos`, `code issues`, `code prs` |
| **Finance** | Yahoo Finance, Alpha Vantage | `quote AAPL` |
| **Research** | Tavily, Perplexity | `research <query>` |
| **Notes** | Notion, Obsidian | `notes search`, `notes create` |
| **Health** | Garmin, Apple Health | `health log`, `health summary` |
| **CRM** | Salesforce, HubSpot | `crm contacts`, `crm deals` |

---

## Managed Mode Architecture

```
┌────────────────────────────────────────────┐
│          ClawHQ Console (web)              │
│  Onboarding · Dashboard · Fleet · Support  │
│             WebSocket Hub                  │
└────────────────────┬───────────────────────┘
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
    ┌───────────┐        ┌───────────┐
    │ Node 1    │        │ Node N    │
    │ agentd    │        │ agentd    │
    │ OpenClaw  │ . . .  │ OpenClaw  │
    │ Guardrails│        │ Guardrails│
    │ Monitoring│        │ Monitoring│
    └───────────┘        └───────────┘
```

**agentd** is the self-operated CLI running as a daemon. It receives config from the console, manages Docker lifecycle, applies all seven toolchains, streams operational metadata back. The console is a thin coordination layer — it never sees agent contents.

### Operational Boundary (Managed Mode)

| We CAN see | We CANNOT see |
|---|---|
| Container health (up/down/restarts) | Agent conversations |
| Integration status (healthy/degraded/failed) | Email, task, or calendar content |
| Memory tier sizes (45KB hot, 120KB warm) | Memory contents |
| API cost metrics | What the agent does with the calls |
| Cron job status (running/failed) | Cron job outputs |

### Infrastructure Provisioning (Managed Mode)

| Capability | Description |
|---|---|
| Multi-cloud deploy | One-click provisioning across Hetzner, DigitalOcean, Vultr, AWS, and self-hosted VMs |
| Server sizing | Recommend CPU/RAM/storage based on workload and template |
| Region selection | Deploy to geographically optimal datacenter |
| DNS & SSL automation | Automatic subdomain creation, Let's Encrypt provisioning and renewal |
| Reverse proxy | Auto-configured nginx/Traefik with TLS termination, WebSocket support, rate limiting |
| Infrastructure-as-code | Reproducible provisioning via cloud-init templates |

### Access Control (Managed Mode)

| Role | Capabilities |
|---|---|
| **Admin** | Full access: config, security, deploy, destroy, user management |
| **Operator** | Operational access: status, doctor, backup, restart, logs |
| **Viewer** | Read-only: status, logs, audit trail |

Authentication: username/password, TOTP MFA, OAuth SSO (Google, GitHub). Human-in-the-loop exec approvals for sensitive agent actions.

---

## Skill Library

Pre-built capabilities that templates include:

- **morning-brief** — daily briefing (tasks, calendar, priorities)
- **email-digest** — summarize and triage incoming email
- **meeting-prep** — research attendees, prep talking points
- **session-report** — work session ledger and time tracking
- **construct** — autonomous self-improvement (agent builds its own tools)

Open-source. Community-contributed. Reviewed for safety.

---

## Production Discoveries Summary

| Discovery | Implication |
|---|---|
| 40% of config is universal, 60% is personalized | Config generator separates the two |
| 14 config landmines silently break agents | Every landmine is a rule — impossible to ship a broken config |
| Identity files corrupt, bloat, and go stale | Identity governance: structured YAML, token budgets, staleness detection |
| Memory accumulates at ~120KB/day | Memory lifecycle: hot/warm/cold tiers, auto-summarization, size caps |
| Credentials expire silently | Credential health: probes, expiry tracking, renewal notifications |
| Security is opt-in, defaults are dangerous | Security hardened by default — every template starts secure |
| Production agents need ongoing SRE | The entire platform exists because this is true |
