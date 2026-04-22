# OpenClaw Reference

> The single source of truth for what OpenClaw is, how it works, and how to configure, personalize, and secure it.
> Extracted from running a production OpenClaw agent for months. Engineering companion to `PRODUCT.md` and `ARCHITECTURE.md`.

**Updated:** 2026-04-14 · **Minimum OpenClaw version:** v2026.4.12

> **Version baseline:** ClawHQ targets OpenClaw v2026.4.12 or later. The version scheme switched from semver (v0.8.x) to calendar-based (v2026.x.x) in early 2026. Earlier versions are missing critical fixes including the Telegram approval callback deadlock (#64979), media understanding pipeline improvements, and Telegram thinking+text block delivery bugs (#66459, #53384).

---

## Table of Contents

**Part 1 — What OpenClaw Is**
1. [Overview](#overview)
2. [Internal Architecture](#internal-architecture)
3. [Key Directories](#key-directories)
4. [Four Integration Surfaces](#four-integration-surfaces)
5. [Three Communication Protocols](#three-communication-protocols)
6. [Messaging Channels](#messaging-channels)
7. [What OpenClaw Already Handles](#what-openclaw-already-handles)

**Part 2 — The Workspace (The Agent's Brain)**
8. [Workspace File System](#workspace-file-system)
9. [System Prompt Assembly Order](#system-prompt-assembly-order)
10. [The Memory System](#the-memory-system)
11. [Identity Drift](#identity-drift)

**Part 3 — Configuration**
12. [openclaw.json Reference](#openclawjson-reference)
13. [Configuration Surface Inventory](#configuration-surface-inventory)
14. [The 14 Configuration Landmines](#the-14-configuration-landmines)
15. [Multi-Agent Routing](#multi-agent-routing)
16. [Automation: Cron, Heartbeat, and Hooks](#automation-cron-heartbeat-and-hooks)
17. [Skills System](#skills-system)
18. [Plugins](#plugins)
19. [Media Understanding](#media-understanding)
20. [Voice & Real-time Capabilities](#voice--real-time-capabilities)
21. [Diagnostics & Observability](#diagnostics--observability)
22. [Built-in Tools Inventory](#built-in-tools-inventory)

**Part 4 — Security**
23. [Threat Model & Hardening](#threat-model--hardening)
24. [Container Hardening Matrix](#container-hardening-matrix)
25. [Egress Firewall](#egress-firewall)
26. [Prompt Injection Defense](#prompt-injection-defense)
27. [Secret Scanning](#secret-scanning)
28. [Credential Health Probes](#credential-health-probes)

**Part 5 — Deployment & Operations**
29. [Two-Stage Docker Build](#two-stage-docker-build)
30. [Blueprint System](#blueprint-system)
31. [Integration Layer](#integration-layer)
32. [Doctor: Preventive Diagnostics](#doctor-preventive-diagnostics)
33. [Diagnostic Commands](#diagnostic-commands)

**Part 6 — Platform & Business**
34. [Managed Mode Architecture](#managed-mode-architecture)
35. [Competitive Landscape](#competitive-landscape)

**Appendices**
36. [File Relationship Summary](#file-relationship-summary)
37. [Key Principles](#key-principles)
38. [Production Discoveries](#production-discoveries)

---

# Part 1 — What OpenClaw Is

## Overview

OpenClaw is a persistent AI agent framework with tools, memory, cron jobs, and messaging integrations — running in a Docker container the user controls. It is a single Node.js process (the **Gateway**) that acts as a control plane. Everything else connects to it.

The key architectural insight: **the workspace files are the agent.** Everything about identity, behavior, memory, and rules lives in plain Markdown files on disk. The LLM is the raw intelligence; the files are the personality, constraints, and accumulated knowledge.

Key facts:
- Single process, single config file (`openclaw.json`), filesystem-backed state (no database except SQLite for memory search)
- ~13,500 tokens of configuration across 11+ files
- ~200+ configurable fields, 47+ built-in agent tools
- CLI talks to Gateway via WebSocket RPC (`ws://127.0.0.1:18789`)
- Control UI is a Lit web-component app served by the Gateway itself
- 11+ primary messaging channels (Telegram, WhatsApp, Discord, Slack, Signal, iMessage, Teams, Matrix, IRC, iMessage/BlueBubbles, Google Chat) compiled-in or as plugins; 100+ total plugin extensions
- Media understanding pipeline: image, audio, and video analysis with configurable model providers
- Voice capabilities: voice calls, Talk Mode (real-time conversation), TTS, real-time transcription
- Agent runtime (`PiEmbeddedRunner`) runs in-process; tools are function calls or Docker exec for sandboxed ops
- Config schema is TypeBox (`src/config/schema.ts`) — unknown keys cause Gateway to refuse to start
- Configuration priority: **Environment Variables > Config File > Default Values**

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
│  │ Loader   │  │ Manager   │  │ (11+ built-in:       │  │
│  │ (config/ │  │ (config/  │  │  telegram, discord,  │  │
│  │  config  │  │  sessions │  │  whatsapp, slack,    │  │
│  │  .ts)    │  │  .ts)     │  │  + 100+ plugins)     │  │
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

## Key Directories

| Path | Purpose | Sensitive? |
|------|---------|------------|
| `~/.openclaw/` | Root config, credentials, state | **Yes** — `chmod 700` |
| `~/.openclaw/openclaw.json` | Central configuration file | **Yes** — contains tokens, model config |
| `~/.openclaw/workspace/` | Default agent workspace (the "brain") | **Yes** — private memory |
| `~/.openclaw/credentials/` | Channel auth (WhatsApp creds, tokens) | **Critical** — never commit to git |
| `~/.openclaw/sessions/` | Session transcripts (`.jsonl`) | Sensitive — conversation history |
| `~/.openclaw/cron/` | Persisted scheduled jobs (`jobs.json` + `runs/`) | Operational |
| `~/.openclaw/skills/` | Installed skills from ClawHub | Review before installing |
| `~/.openclaw/browser/` | Managed Chromium state | Operational |
| `~/.openclaw/.env` | Secrets (API keys, tokens) | **Critical** — `chmod 600` |

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

## Three Communication Protocols

ClawHQ communicates with OpenClaw through three protocol layers (not to be confused with messaging channels like Telegram/WhatsApp — see [Messaging Channels](#messaging-channels) below):

| Protocol | What it's for | When to use |
|----------|--------------|-------------|
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

## Messaging Channels

OpenClaw supports 11+ primary messaging channels with 100+ total plugin extensions. Channels are either compiled into the core or loaded as plugins at startup.

### Primary Channels

| Channel | Type | Key Features |
|---------|------|-------------|
| **Telegram** | Built-in | Bot API, DM/group, inline commands, media, approval callbacks |
| **WhatsApp** | Built-in | Phone-based, multi-account, media, read receipts, reactions |
| **Discord** | Built-in | Bot, guilds, threads, reactions, voice channel awareness |
| **Slack** | Built-in | Bot + app tokens, channels, threads, reactions |
| **Signal** | Built-in | Phone-based, end-to-end encrypted |
| **iMessage** | Built-in | macOS only, requires companion app or BlueBubbles bridge |
| **Microsoft Teams** | Plugin | Federated OAuth, reactions, file attachments, delegated auth |
| **Matrix** | Plugin | Federated, self-hosted compatible |
| **IRC** | Plugin | Traditional IRC protocol |
| **Google Chat** | Plugin | Workspace integration |
| **Mattermost** | Plugin | Self-hosted team chat |

### Additional Plugin Channels

Twitch, Nostr, LINE, Feishu/Lark, Zalo, Nextcloud Talk, Synology Chat, BlueBubbles (iMessage bridge), QQ, Webhook (generic HTTP), and more. The plugin ecosystem is actively growing.

All channels share common config: `enabled`, `dmPolicy` (pairing/allowlist/open/disabled), `allowFrom`, `groupPolicy`, `ackReaction`. See the [Channel Configuration](#channel-configuration) section in Part 3 for details.

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

# Part 2 — The Workspace (The Agent's Brain)

## Workspace File System

When OpenClaw starts a session, it reads specific files and assembles the agent's context. Understanding what each file controls is essential to deep personalization.

### The 8 Auto-Loaded Files Constraint

**Critical architectural constraint:** OpenClaw auto-loads exactly **8 filenames** at boot: `SOUL.md`, `AGENTS.md`, `USER.md`, `TOOLS.md`, `IDENTITY.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, and `MEMORY.md`. Any file with a different name (like `health-profile.md`, `notes.md`, or `knowledge-base.md`) is **never** injected into the agent's context — the agent literally cannot see it unless it explicitly reads it with a tool call. The `bootstrap-extra-files` hook also only accepts these same basenames. This means critical knowledge must live in one of the 8 standard files, or the agent won't know about it after compaction.

Additional template files exist in the official docs (`GOALS.md`, `SOUVENIR.md`, `BOOT.md`) but these are either loaded via hooks or are referenced by convention in AGENTS.md instructions rather than auto-injected.

### Workspace Directory Structure

```
~/.openclaw/workspace/
├── AGENTS.md          # Operating manual — boot sequence, rules, checklists table
├── SOUL.md            # Persona, tone, values, hard limits
├── TOOLS.md           # Env-specific: SSH hosts, TTS voices, camera IDs
├── USER.md            # Human profile (main sessions only)
├── IDENTITY.md        # Name, emoji, avatar
├── HEARTBEAT.md       # Periodic task instructions
├── BOOT.md            # Startup hook actions (optional, loaded via hook)
├── BOOTSTRAP.md       # First-run onboarding (delete after use)
├── MEMORY.md          # Long-term curated memory (main sessions only)
├── memory/
│   ├── YYYY-MM-DD.md  # Daily session logs (append-only)
│   └── archive/       # Old logs (> 30 days)
├── skills/            # Workspace-specific skills (override managed ones)
├── hooks/             # Workspace-specific hooks (highest precedence)
├── checklists/        # Operation checklists referenced by AGENTS.md
├── canvas/            # Files for node displays
└── docs/              # On-demand docs (NOT auto-loaded every turn)
```

### Symlink Security Constraint

OpenClaw's `resolveAgentWorkspaceFilePath()` runs an `assertNoPathAliasEscape` security check on every file. This verifies each file's `realpath` stays strictly inside the workspace root. Symlink targets that resolve outside the workspace are **silently rejected** — no error logged, the file is simply ignored. This means workspace files must be real copies, not symlinks pointing to a source repo or shared directory. Maintain a source-of-truth repository separately and copy files over when deploying changes.

### Files Loaded Every Session (Core Identity Stack)

These are injected into the agent's context at the start of **every** session. They define the agent's identity and operating contract.

#### `SOUL.md` — The Agent's Character Sheet

**Purpose:** Persona, tone, values, hard boundaries. This is the most important file in the ecosystem — it defines *who your agent is*.

**The key distinction:** "Soul is what the model embodies. Identity is what users see. You can have a formal, precise soul with a playful emoji and nickname — internal behavior and external presentation don't have to match." SOUL.md is entirely prompt-driven — no special model fine-tuning, just well-crafted markdown injected into the system prompt before every message.

**What belongs here:**
- Core personality traits and communication style ("Direct, friendly, patient. Never condescending.")
- Hard behavioral limits ("Never share internal pricing," "Always recommend consulting a professional for legal questions")
- Value system and ethical boundaries
- Tone and voice guidelines
- What the agent should and shouldn't do unprompted
- Conditional mode switching (different behavior for code review vs. brainstorming)
- Tool preferences ("Prefer official documentation over Stack Overflow," "Always use conventional commits format")

**What does NOT belong here:**
- Operational procedures (→ AGENTS.md)
- Temporary tasks or project tickets (creates unstable behavior)
- Personal preferences about the human (→ USER.md)
- Tool environment details (→ TOOLS.md)

**Typical sections:**
```markdown
## Identity
Who the agent is, role description, core self-perception

## Style / Communication
How the agent speaks, tone preferences, behavioral traits

## Values / Principles
What the agent prioritizes, decision-making framework

## Boundaries / Hard Limits
What the agent must NEVER do — this matters as much as what it should do

## Conditional Modes
Mode-specific behavior:
  ## Mode: Code Review
  - Check for security vulnerabilities first
  - Be direct about issues — don't sugarcoat
  ## Mode: Brainstorming
  - Generate quantity over quality initially
  - Don't self-censor ideas

## Tool Preferences
Which tools to prefer for which tasks

## Context
Persistent context the agent always needs (tech stack, sprint cycle, code style)

## Example Responses (optional)
Specific examples of desired behavior — "show, don't just tell"
```

**Best practices:**
- Keep it focused on *identity* and *character*, not operational procedures (those go in `AGENTS.md`)
- Include explicit hard limits — these are your guardrails
- Be specific about tone: vague instructions like "be helpful" don't shape behavior; "teach first, sell second" does
- Include contradictions where they're genuine — "Real people have inconsistent views. Include contradictions — they're what make you identifiably you." (from `aaronjmars/soul.md`)
- "Someone reading your SOUL.md should be able to predict your takes on new topics. If they can't, it's too vague." (from official docs)
- Recommended length: 50-150 lines. A few well-chosen rules work better than many vague ones
- Make it read-only (`chmod 444`) to prevent the agent from self-modifying its own personality — this was a documented attack vector in the ClawHavoc campaign, which specifically targeted SOUL.md with hidden instructions in base64 strings and zero-width Unicode characters
- Version-control it with git to track personality evolution over time
- Keep it under the truncation limit (files over 20,000 chars get truncated; aggregate cap is 150,000 chars across all bootstrap files)

**Dynamic SOUL.md — the `soul-evil` hook:** OpenClaw's hook system can swap SOUL.md content with an alternate file during a scheduled window or by random chance — in memory only, without modifying files on disk. The alternate file path is configured in the hook; if missing, the hook logs a warning and keeps normal SOUL.md. Sub-agents are unaffected. This is primarily used for fun/testing but illustrates why SOUL.md should be immutable on disk.

**Community soul frameworks:** The `aaronjmars/soul.md` GitHub repo extends the concept with a multi-file soul specification: `SOUL.md` (identity, worldview, opinions), `STYLE.md` (voice, syntax, writing patterns), `SKILL.md` (operating modes like tweet/essay/chat), `MEMORY.md` (session continuity), plus a `data/` directory for raw source material (writing samples, influences) and `examples/` for good/bad output calibration. This framework treats identity as composable, forkable, and evolvable across any agent platform.

**Official templates available:** Generic (minimal), C-3PO themed, Architect CEO persona. Community templates vary from personal assistant to customer support to DevOps automation agents.

**ClawHQ generation:** `src/design/identity/soul.ts` generates SOUL.md from blueprint personality, customization answers, use-case mapping, and day-in-the-life narrative. Token budget enforcement via `BOOTSTRAP_MAX_CHARS` (20,000 default).

#### `AGENTS.md` — Standard Operating Procedures

**Purpose:** Operating instructions, workflow rules, memory management directives, and behavioral priorities. If SOUL.md answers "who are you?", AGENTS.md answers "what do you do and how?" This is the top-level operating contract: priorities, boundaries, workflow, and quality bar. It's the largest and most important file for agents with complex workflows.

**What belongs here:**
- Session startup checklist (what to read, in what order)
- Memory management rules (when to write, what goes where)
- Safety rules and approval gates
- Communication rules (when to speak vs. stay quiet, especially in group chats)
- Git workflow and commit conventions
- Tool usage guidelines and restrictions
- Checklists routing table (mapping operations to checklist files in `checklists/`)
- Skill notes and tool-specific guidance
- Shared spaces configuration (for multi-agent setups)

**What does NOT belong here:**
- Personal preferences about the user (→ USER.md)
- Temporary tasks or project tickets (creates drift)
- Environment-specific tool details like SSH hosts (→ TOOLS.md)

**Best practices:**
- Put *stable rules* here, not temporary tasks
- This is where you define the agent's workflow discipline
- Include explicit memory hygiene instructions
- Gate MEMORY.md loading to main sessions only: "Main session only: Read MEMORY.md" — this prevents private memory from leaking into group chats
- Use the checklists routing table to reference operation-specific checklists in `checklists/` (deploy, gateway restart, config patch) rather than bloating AGENTS.md itself
- Default safety template includes: "Don't dump directories or secrets into chat," "Don't run destructive commands unless explicitly asked," "Don't send partial/streaming replies to external messaging surfaces"

**Example structure:**
```markdown
## Every Session
Before doing anything else:
1. Read `SOUL.md` — this is who you are
2. Read `USER.md` — this is who you're helping
3. Read `memory/YYYY-MM-DD.md` (today + yesterday) for recent context
4. If in MAIN SESSION: Also read `MEMORY.md`

## Memory Rules
- Decisions, preferences, and durable facts → `MEMORY.md`
- Day-to-day notes and running context → `memory/YYYY-MM-DD.md`
- If someone says "remember this," write it immediately
- After completing meaningful work: git commit + push

## Safety
- Show the plan, get explicit approval, then execute
- No autonomous bulk operations
- No destructive commands without confirmation
```

**ClawHQ generation:** `src/design/identity/agents.ts` generates AGENTS.md from blueprint toolbelt (tools with categories), skill inventory, and autonomy model (what requires approval).

#### `USER.md` — Context About the Human

**Purpose:** Who you are, how to address you, your preferences, timezone, work context, communication style. This is the personalization layer — what makes the agent feel like it *knows* you rather than starting cold. Only loaded in main/private sessions, never in group chats (same gating as MEMORY.md).

**What belongs here:**
- Your name and how you prefer to be addressed
- Timezone and location (relevant for scheduling, weather, etc.)
- Professional context (role, company, current projects)
- Communication preferences (direct answers vs. explanations, verbosity level)
- Dietary restrictions, health context, or other personal facts the agent needs
- Authorization levels (e.g., "Can approve refunds up to $50")
- Output formatting preferences
- Recurring constraints the agent should know

**Best practices:**
- This file stays static until you manually update it — it's not a live database
- Be explicit: "Direct answers. No filler. Copy-pasteable commands." shapes behavior far more than hoping the agent figures it out — "Add to USER.md that I want short answers and copy-pastable commands" is the fastest way to get consistent behavior
- Include anything that would be awkward to re-explain every session
- USER.md has no strict size limit and is reliably loaded every session — it's the best place for user-specific knowledge that must be available in every context
- For sensitive personal information, consider what truly needs to be in every session vs. what can live in MEMORY.md and be retrieved on demand
- Over time, the agent may notice patterns and promote them from daily notes into USER.md or MEMORY.md — but explicit instructions are more reliable than hoping it figures it out

#### `IDENTITY.md` — Name, Vibe, and Presentation

**Purpose:** The agent's name, emoji, avatar path, and presentation metadata. Created/updated during the bootstrap ritual or via `openclaw agents set-identity`.

**Template fields from official docs:**
- **Name:** Pick something you like
- **Creature:** AI? Robot? Familiar? Ghost in the machine? Something weirder?
- **Vibe:** How do you come across? Sharp? Warm? Chaotic? Calm?
- **Emoji:** Your signature — pick one that feels right
- **Avatar:** Workspace-relative path, `http(s)` URL, or data URI

The official template notes: "This isn't just metadata" — it's designed for the agent to fill in during its first conversation, making it a collaborative identity-building exercise.

**Best practices:**
- This is metadata, not personality — personality goes in SOUL.md
- Make it read-only alongside SOUL.md (`chmod 444`)
- `set-identity --from-identity` reads from the workspace root
- If the agent introduces itself using the config agent ID instead of its persona name, the most common cause is boot files not loading (often due to the symlink escape issue)

### Files Loaded Conditionally

#### `TOOLS.md` — Tool Usage Notes

**Purpose:** Documents environment-specific notes and conventions for your setup. This is guidance only — it does not grant or revoke tool permissions (that's handled in `openclaw.json` via `tools.allow`/`tools.deny`).

**What belongs here (from official docs):**
- Camera names and locations
- SSH hosts and aliases (e.g., `home-server → 192.168.1.100, user: admin`)
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Notes about local tool quirks
- Preferred tools for specific tasks
- Tools that should be avoided and why
- Custom CLI wrappers or scripts the agent can use
- Skill-specific environment notes ("If you need local-only notes, put them in TOOLS.md")

**What does NOT belong here:** Tool definitions, tool permissions, or anything that should be enforced rather than suggested. Those go in `openclaw.json`.

#### `HEARTBEAT.md` — Autonomous Check-in Checklist

**Purpose:** Optional tiny checklist for heartbeat runs (the periodic "is anything worth doing?" check). The heartbeat is the mechanism that makes the agent feel aware even when you're not talking to it.

**What belongs here:**
- Brief checklist of things to monitor (inbox, calendar, git status, system health)
- Keep it extremely short — each heartbeat run consumes tokens

**How it works:** OpenClaw reads HEARTBEAT.md on each heartbeat tick (default: every 30 minutes). If the file exists but is effectively empty (only blank lines and markdown headers), OpenClaw skips the heartbeat run to save API calls. If the file is missing, the heartbeat still runs and the model decides what to do. The agent returns `HEARTBEAT_OK` if nothing needs attention (stripped from delivery); if something is actionable, it returns the alert text without `HEARTBEAT_OK`.

**Heartbeat configuration in `openclaw.json`:**
```json5
{
  agents: {
    defaults: {
      heartbeat: {
        every: "30m",              // interval (duration string; default 30m, 1h for OAuth)
        target: "last",            // last | none | <channel id>
        to: "+15551234567",        // optional recipient override
        model: "anthropic/claude-opus-4-5",  // optional model override
        activeHours: { start: "08:00", end: "24:00", timezone: "America/Los_Angeles" },
        includeReasoning: false,   // deliver separate Reasoning: message
        lightContext: true,        // only load HEARTBEAT.md (not full bootstrap)
        isolatedSession: true,     // fresh session, no prior conversation history
        suppressToolErrorWarnings: true,
      },
    },
  },
}
```

**Cost optimization options:**
- `lightContext: true` — limits bootstrap files to just HEARTBEAT.md (~2-5K tokens vs. full context)
- `isolatedSession: true` — no prior conversation history (avoids sending ~100K tokens per run)
- Combine both for maximum savings
- Per-agent heartbeat overrides via `agents.list[].heartbeat`

**Community pattern — rotating heartbeat:** Instead of separate cron jobs for each check, use a single HEARTBEAT.md with a `heartbeat-state.json` tracking file. On each tick, the agent calculates which check is most overdue (respecting time windows), runs only that check, updates the timestamp, and reports only if actionable. Spreads load and reduces costs.

**Critical cost warning:** Native heartbeat can become a major token sink. Heartbeat turns frequently run with the full main-session context (170k–210k input tokens per run has been observed). Best practice is to disable native heartbeat and use isolated cron-driven heartbeats instead, which run in their own lightweight session without dragging the full chat history.

#### `BOOT.md` — Gateway Restart Ritual

**Purpose:** Optional startup checklist executed on gateway restart when internal hooks are enabled. Runs once per restart via the `boot-md` bundled hook.

**Activation:** Requires `hooks.internal.enabled: true` in config, plus `openclaw hooks enable boot-md`. Not active by default.

**What belongs here:**
- Initialization steps that should happen on every cold start
- Keep it short; use the message tool for outbound sends
- System health checks, integration verification, morning status report

#### `BOOTSTRAP.md` — First-Run Interview

**Purpose:** One-time first-run ritual for gathering identity/context and writing the initial workspace files from conversation. Only created for a brand-new workspace.

**Best practices:**
- Run it intentionally as your first message: "Hey, let's get you set up. Read BOOTSTRAP.md and walk me through it."
- After setup, skip future runs with `agent.skipBootstrap: true` when managing files manually
- Large bootstrap files are truncated at `bootstrapMaxChars` (default: 20,000) and `bootstrapTotalMaxChars` (default: 150,000)

### Truncation Limits

| Limit | Default | What it controls |
|-------|---------|-----------------|
| `bootstrapMaxChars` | 20,000 chars | Maximum per-file identity content |
| `bootstrapTotalMaxChars` | 150,000 chars | Aggregate cap across all bootstrap files |

These are character counts, not tokens — 150K chars ≈ 50K tokens. Use `/context list` in-session to see exactly what's loaded, truncated, or missing.

---

## System Prompt Assembly Order

Understanding how OpenClaw assembles the system prompt is critical for managing context budgets and debugging behavior. The prompt builder (`src/agents/prompt-builder.ts`) constructs the prompt in this order:

```
1. [Identity Section]
   ├── SOUL.md content
   ├── IDENTITY.md content
   └── identity.* from openclaw.json (name, theme, emoji)

2. [Skills Section]
   ├── ## voice-call
   │   └── Content of voice-call/SKILL.md
   ├── ## lobster
   │   └── Content of lobster/SKILL.md
   └── (each loaded skill whose tools are available)

3. [Tools Section]
   └── Structured function definitions sent to model API

4. [Workspace Bootstrap Files]
   ├── AGENTS.md
   ├── USER.md (main session only)
   ├── TOOLS.md
   ├── HEARTBEAT.md
   └── BOOTSTRAP.md (if present and not skipped)

5. [Memory Section]
   ├── MEMORY.md (main session only, never group contexts)
   └── memory/YYYY-MM-DD.md (today + yesterday)

6. [Context Files]
   └── Any additional context from hooks (bootstrap-extra-files)
```

**Skill injection rule:** A skill is included in the system prompt only if: (a) the skill is loaded (not disabled, passes allowlist), (b) at least one of the skill's tools is available (passes tool policy), and (c) the session's prompt mode includes skills.

**Truncation applies at two levels:** Per-file at `bootstrapMaxChars` (default 20,000 chars) and aggregate across all bootstrap files at `bootstrapTotalMaxChars` (default 150,000 chars). Use `/context list` in-session to see exactly what's loaded, truncated, or missing.

---

## The Memory System

OpenClaw's memory is what transforms it from a stateless chatbot into a persistent assistant. The core philosophy: **files are the source of truth; the model only "remembers" what gets written to disk.**

### Two-Layer Memory Architecture

#### Layer 1: `memory/YYYY-MM-DD.md` — Daily Logs (Append-Only)

- Automatically loaded: today + yesterday at session start
- Running context, session notes, what happened today
- Think of these as a journal — good for continuity across a few days
- The agent creates these automatically during sessions
- Older daily logs are accessible via `memory_search`

#### Layer 2: `MEMORY.md` — Curated Long-Term Memory

- Loaded only in the main, private session (never in group contexts — this protects sensitive info)
- Curated facts, preferences, project summaries, lessons learned
- This is the stuff you want to persist across months
- **Keep it short** — anything that doesn't need to be in every session can live in daily logs; the agent will find it through semantic search when needed

### Memory Tools Available to the Agent

| Tool | Purpose |
|------|---------|
| `memory_search` | Semantic recall over indexed snippets (hybrid: 70% vector / 30% BM25 keyword) |
| `memory_get` | Targeted read by file and line range; returns empty gracefully if file doesn't exist |

### Memory Search Configuration (`openclaw.json`)

```json5
{
  agents: {
    defaults: {
      memorySearch: {
        enabled: true,
        provider: "voyage",       // auto-detected from available API keys
        model: "voyage-3-large",  // provider-specific embedding model
        sources: ["memory", "sessions"],
        indexMode: "hot",
        minScore: 0.3,
        maxResults: 20,
        candidateMultiplier: 3,   // top maxResults * candidateMultiplier retrieved
        extraPaths: ["../team-docs", "/srv/shared-notes/overview.md"],
        fallback: "local",        // fallback provider: openai | gemini | local | none
        remote: {
          baseUrl: "https://api.example.com/v1/",  // for OpenAI-compatible endpoints
          apiKey: "YOUR_API_KEY",
          headers: { "X-Custom-Header": "value" },
        },
      },
      compaction: {
        reserveTokensFloor: 20000,
        mode: "archive",          // archive | summary
        memoryFlush: {
          enabled: true,          // default: true — pre-compaction memory save
          softThresholdTokens: 4000,
          systemPrompt: "Session nearing compaction. Store durable memories now.",
          prompt: "Write any lasting notes to memory/YYYY-MM-DD.md; reply with NO_REPLY if nothing to store.",
        },
      },
      contextPruning: {
        mode: "cache-ttl",        // smart defaults auto-enable for Anthropic profiles
        ttl: "24h",
        keepLastAssistants: 100,
      },
    },
  },
}
```

Supported embedding providers: OpenAI, Gemini, Voyage (recommended), Mistral, Ollama, and local GGUF models. OpenClaw auto-detects your embedding provider from available API keys. The hybrid search combines vector similarity (semantic match — wording can differ) with BM25 keyword relevance (exact tokens like IDs, env vars, code symbols).

**Memory search internals:** SQLite-based with `sqlite-vec` extension. Chunks are ~400 tokens with 80-token overlap. Index stores embedding provider/model + endpoint fingerprint + chunking params — if any change, OpenClaw automatically resets and reindexes. Freshness maintained via file watcher on `MEMORY.md`, `memory/`, and `memorySearch.extraPaths` with 1.5s debounce.

**Context pruning vs. compaction:** Pruning runs before each LLM call, trimming old tool results from the in-memory context (doesn't touch session files on disk). Compaction rewrites conversation history, which invalidates the prompt cache — every unnecessary compaction is both a reliability and cost problem. The memory flush runs a silent agentic turn before compaction to remind the model to persist important context.

**Session transcript indexing:** OpenClaw can automatically save and index past conversations, making them searchable in future sessions. Session transcripts use delta thresholds to trigger background sync. This enables the agent to recall decisions made weeks ago through `memory_search`.

### Memory Lifecycle: Hot / Warm / Cold Tiers

Without management, agent memory grows at ~120KB/day during active use (360KB in 3 days observed in production). ClawHQ implements tiered lifecycle management:

```
Hot (in context)          Warm (indexed)           Cold (archived)
≤7 days, ≤50KB           7-90 days                90+ days
Full fidelity             Summarized, indexed      Summarized, compressed
In every conversation     Searchable on demand     Retrievable on demand
```

**Implementation:** `src/evolve/memory/lifecycle.ts` — defaults: 50KB hot max, 24h hot retention, 168h (7 day) warm retention, cold never purged.

| Transition | What Happens | When |
|---|---|---|
| Hot → Warm | Conversation memories older than 7 days are summarized, key facts extracted, full text moved to warm storage | Daily (configurable) |
| Warm → Cold | Warm memories older than 90 days are further compressed, PII masked, archived | Weekly (configurable) |
| Cold → Deleted | Cold memories older than retention period are permanently removed | Per retention policy |

Each transition preserves important information while reducing token cost. Summarization is LLM-powered (using the agent's own subagent model) — it understands context, not just truncation. PII masking runs at each transition.

### Memory Best Practices

1. **Write it down immediately.** If something matters, tell the agent to write it to memory. Don't rely on conversation context surviving compaction.
2. **Weekly curation ritual.** Review the last 7–14 days of daily logs. Extract patterns, update MEMORY.md, archive or clean up old daily logs.
3. **Separate concerns.** Decisions and preferences → MEMORY.md. Running context → daily logs. Don't duplicate between them.
4. **Mind the truncation limits.** Per-file: 20,000 chars (`bootstrapMaxChars`). Aggregate: 150,000 chars (`bootstrapTotalMaxChars`). These are character counts, not tokens — 150K chars ≈ 50K tokens.
5. **Use `/context list` to diagnose.** This shows exactly what's loaded, what's truncated, and what's missing. Always check this before troubleshooting memory issues.
6. **Proactive compaction.** Run `/compact` before context overflow. When a session approaches the limit, OpenClaw triggers a silent memory flush, but this is best-effort — build manual save points as backup.
7. **Git-back your workspace.** Run `git init` in the workspace directory. Set up auto-commit via cron or heartbeat. Keep `~/.openclaw/credentials/` and `openclaw.json` out of the repo.

### Advanced Memory Options

For workspaces that outgrow basic memory search:

- **Cognee (graph memory):** Extracts entities and relationships from Markdown files into a knowledge graph, enabling relational queries
- **Mem0 (auto-capture):** Watches conversations, extracts structured facts automatically, deduplicates, and stores as embeddings — useful for conversational agents where you don't want to manually curate memory
- **QMD sidecar:** Advanced retrieval backend with MMR diversity re-ranking and temporal decay
- **memsearch (standalone library):** The OpenClaw memory architecture extracted as a plug-and-play library for any agent framework

---

## Identity Drift

The agent's identity is defined by structured files (SOUL.md, USER.md, AGENTS.md, HEARTBEAT.md, TOOLS.md). Without governance, these files drift:

| Drift Type | What Happens |
|---|---|
| **Bloat** | Files grow as users add context, exceeding `bootstrapMaxChars` and getting silently truncated |
| **Staleness** | Information becomes outdated (old job title, changed interests, deprecated tools) |
| **Contradiction** | Different files make conflicting claims (SOUL says "never trade stocks," TOOLS lists a trading tool) |
| **Scope creep** | Agent's role expands gradually beyond original intent |

OpenClaw treats identity files as opaque markdown — it reads them, includes them in the prompt, and never modifies them. This means ClawHQ owns the identity file lifecycle completely without interference.

---

# Part 3 — Configuration

## openclaw.json Reference

Located at `~/.openclaw/openclaw.json`, this is the heart of the system.

### Gateway Configuration
```json
{
  "gateway": {
    "port": 18789,
    "auth": {
      "token": "YOUR_SECURE_TOKEN"
    },
    "http": {
      "securityHeaders": {
        "strictTransportSecurity": true
      }
    },
    "controlUi": {
      "allowedOrigins": ["https://your-domain.com"]
    }
  }
}
```

**Critical:** Never use `"allowedOrigins": ["*"]` outside tightly controlled local testing. Never bind to `0.0.0.0` without understanding the exposure. Gateway port default: 18789, bind default: 127.0.0.1. Changes require restart. Reload modes: hybrid/hot/restart/off.

### Identity Configuration

The `identity` block in `openclaw.json` controls the agent's display presentation across channels and the Control UI. This is separate from SOUL.md (behavioral identity) and IDENTITY.md (workspace-level metadata).

```json5
{
  identity: {
    name: "Samantha",          // Agent display name
    theme: "helpful sloth",    // Personality theme (for UI/branding)
    emoji: "🦥",               // Used for reactions, display
    avatar: "avatars/sam.png", // Path or URL
  },
}
```

The `identity.name` appears in channel messages and the Control UI. The `identity.emoji` is used for auto-reactions. The `identity.avatar` can be a workspace-relative path, http(s) URL, or data URI. Changes hot-reload without restart.

### Channel Configuration
```json5
{
  channels: {
    telegram: {
      enabled: true,
      botToken: "123:abc",
      dmPolicy: "pairing",       // pairing | allowlist | open | disabled
      allowFrom: ["tg:123"],     // only for allowlist/open
    },
    whatsapp: {
      dmPolicy: "pairing",
      allowFrom: ["+15555550123"],
      selfChatMode: false,
      groupPolicy: "allowlist",
      groups: { "*": { requireMention: true } },
      ackReaction: { emoji: "👀", direct: true, group: "mentions" },
      sendReadReceipts: true,
      textChunkLimit: 4000,
      mediaMaxMb: 50,
    },
  },
}
```

20+ providers supported. Four `dmPolicy` modes: `pairing` (default — requires 6-digit verification code, owner approves via `openclaw pairing approve <channel> <code>`), `allowlist` (whitelist), `open` (anyone can message — not recommended), `disabled`.

Channel-specific fields: WhatsApp uses phone numbers, Telegram uses bot tokens + user IDs, Discord needs applicationId + guildId, Slack needs botToken + appToken + signingSecret, iMessage needs cliPath + dbPath.

Each channel also has: `enabled`, `allowFrom`, `groupPolicy`, `configWrites`, `ackReaction` (auto-react on receipt with emoji), per-account heartbeat overrides.

**Multi-account channels:** Some channels support multiple accounts (e.g., WhatsApp personal + business). Per-account configuration available via `channels.<provider>.accounts.<name>.*`.

### Model/Provider Configuration

OpenClaw is model-agnostic. Built-in providers: anthropic, openai, google, deepseek, mistral, openrouter, xai, minimax, ollama. The `api` field controls which request format is used: `"anthropic"` for the Anthropic API, `"openai-responses"` for most OpenAI-compatible servers, `"openai-completions"` for Ollama. If a model doesn't support tool calling, set `reasoning: false` and don't use it as a primary agent model — OpenClaw's tool system requires function calling support.

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "anthropic/claude-opus-4-6",
        fallbacks: ["anthropic/claude-sonnet-4-6", "openai/gpt-5.2"],
      },
      models: {
        "anthropic/claude-opus-4-6": { alias: "Opus" },
        "anthropic/claude-sonnet-4-6": { alias: "Sonnet" },
        "openai/gpt-5.2": { alias: "GPT" },
      },
      imageModel: "openai/gpt-image-1",
      imageMaxDimensionPx: 1200,  // controls image downscaling for vision tokens
    },
  },
}
```

`agents.defaults.models` defines the model catalog and acts as the allowlist for the `/model` command. Model refs use `provider/model` format (e.g., `anthropic/claude-opus-4-6`).

**Auth profiles** — Multiple credentials per provider with sequential failover on rate limits:

```json5
{
  auth: {
    profiles: {
      "anthropic:subscription": { provider: "anthropic", mode: "oauth", email: "[email protected]" },
      "anthropic:api": { provider: "anthropic", mode: "api_key" },
      "openai:default": { provider: "openai", mode: "api_key" },
    },
    order: {
      anthropic: ["anthropic:subscription", "anthropic:api"],
      openai: ["openai:default"],
    },
  },
}
```

Profiles in `order` are tried sequentially — if the first profile hits a rate limit, OpenClaw falls back to the next. Auth mode options: `"oauth"` (Anthropic subscription), `"api_key"` (standard API key).

**Model choice matters for security:** Older/smaller/legacy models are significantly less robust against prompt injection and tool misuse. For tool-enabled agents, use the strongest, latest-generation instruction-hardened model available.

### Tools & Permissions
```json5
{
  tools: {
    profile: "messaging",        // base allowlist preset
    allow: ["group:runtime", "group:fs"],
    deny: ["exec"],
    exec: {
      host: "gateway",
      security: "full",
      safeBins: ["curl", "jq", "rg"],
    },
    byProvider: {
      "openai/*": { deny: ["browser", "exec"] },  // restrict for specific providers
    },
    elevated: true,              // escape hatch: run exec on host when sandboxed
  },
}
```

**Tool profiles** (base allowlists applied before `allow`/`deny`):

| Profile | Tools Included |
|---------|---------------|
| `minimal` | `session_status` only |
| `coding` | `group:fs`, `group:runtime`, `group:sessions`, `group:memory`, `image` |
| `messaging` | Messaging tools + basic session tools |

Per-agent override: `agents.list[].tools.profile` overrides the global default.

**Tool groups:** `group:fs` (file operations), `group:runtime` (exec, process), `group:sessions` (session management), `group:memory` (memory tools).

**Deny wins:** If a tool appears in both `allow` and `deny`, it's denied. `*` wildcards supported. Matching is case-insensitive.

**Per-provider restrictions:** `tools.byProvider` restricts tools for specific model providers without changing global defaults. Useful for limiting capabilities when falling back to weaker models.

Profiles: coding/messaging/custom. Group support: `group:runtime`, `group:fs`, `group:sessions`, etc. Exec host: sandbox/gateway/node. Exec security: allowlist/ask/auto. Web tools: search provider selection, API keys, fetch limits.

### Skills Configuration
```json
{
  "skills": {
    "enabled": true,
    "allowList": ["skill-a", "skill-b"],
    "denyList": ["exec", "browser"]
  }
}
```

Skills can be filtered per-agent — different agents can have different skill sets.

### Agent Defaults
```json
{
  "agents": {
    "defaults": {
      "workspace": "~/.openclaw/workspace",
      "compaction": {
        "memoryFlush": true,
        "reserve": 4096
      },
      "bootstrapMaxChars": 20000,
      "bootstrapTotalMaxChars": 150000,
      "memorySearch": {
        "extraPaths": []
      }
    }
  }
}
```

### Sandbox & Isolation
```json5
{
  agents: {
    defaults: {
      sandbox: {
        mode: "non-main",          // off | non-main | all
        scope: "session",          // session | agent | shared
        docker: {
          image: "openclaw/sandbox:latest",
          network: "none",         // no network by default
          env: { "MY_API_KEY": "..." },
          binds: ["/home/user/source:/source:rw"],
          setupCommand: "apt-get install -y nodejs",
          readOnlyRoot: true,
          memory: "2g",
          cpus: "2",
          pidsLimit: 256,
          user: "1000:1000",
          capDrop: ["ALL"],
          tmpfs: ["/tmp:rw,noexec,nosuid,size=256m"],
        },
        browser: {
          autoStart: true,
          autoStartTimeoutMs: 10000,
        },
      },
    },
  },
}
```

**Mode explained:** `"off"` = tools run on host. `"non-main"` = subagents and cron jobs run in Docker containers while main DM session runs on host. `"all"` = everything sandboxed. Requires Docker CLI inside gateway image (`OPENCLAW_INSTALL_DOCKER_CLI=1`) and Docker socket access.

**Scope:** Controls how many containers are created per session/agent/shared.

**Sandbox details:**
- Inbound media is copied into the sandbox workspace (`media/inbound/*`)
- The `read` tool is sandbox-rooted when sandboxed
- With `workspaceAccess: "none"`, eligible skills are mirrored into sandbox workspace (`<workspace>/skills/`)
- Sandbox containers run with no network by default; override with `docker.network`
- Sandbox browser uses dedicated Docker network (`openclaw-sandbox-browser`) separate from global bridge
- `tools.elevated` is an explicit escape hatch: runs `exec` on the host even when sandboxed. If sandboxing is off, `elevated` has no effect
- `/exec` directives only apply for authorized senders and persist per session; to hard-disable exec, use tool policy deny

**Known security issues (Snyk Labs, Feb 2026):** Two sandbox bypass vulnerabilities were disclosed: (1) `/tools/invoke` endpoint wasn't merging sandbox allow/deny lists into runtime policy, allowing sandboxed sessions to invoke management tools. (2) TOCTOU race condition in `assertSandboxPath` via symlink manipulation allowing filesystem escape. Both were patched. Run `openclaw update` to ensure you have fixes.

### Sessions

`session.dmScope` (main/per-peer/per-channel-peer/per-account-channel-peer), identity links, reset mode (daily/idle/manual), thread bindings.

### Secrets

`secrets.providers` for env/file/exec backends. Any field accepting a SecretRef needs a toggle: "Paste value" vs. "Reference secret."

### The Golden Config Pattern

OpenClaw rewrites `openclaw.json` on startup and can strip custom settings. Protect your config with a "golden copy":

```bash
# After configuring everything correctly:
cp ~/.openclaw/openclaw.json ~/.openclaw/config-backups/openclaw.json.golden

# On startup, restore after the gateway's config touch (~10s):
sleep 15 && cp ~/.openclaw/config-backups/openclaw.json.golden ~/.openclaw/openclaw.json
```

The gateway picks up the change via its dynamic config watcher — no second restart needed.

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

### Config Management Meta-Capabilities

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

---

## The 14 Configuration Landmines

Every item below was discovered running a production agent. Each silently breaks the agent — no errors, no warnings. ClawHQ's config generator (`src/design/configure/generate.ts`) prevents all 14 by construction. The validator (`src/config/validate.ts`) enforces them continuously.

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

## Multi-Agent Routing

OpenClaw natively supports multiple agents via `agents.list[]` + `bindings[]`:

```json5
{
  agents: {
    list: [
      { id: "clawdius", default: true, workspace: "/home/node/.openclaw/workspace" },
      { id: "clawdia", workspace: "/home/node/.openclaw/agents/clawdia/agent/workspace" },
    ],
    bindings: [
      { agentId: "clawdia", match: { channel: "telegram", peer: { kind: "direct", id: "<chat-id>" } } },
      { agentId: "clawdius", match: { channel: "whatsapp" } },
    ],
  },
}
```

Use routing bindings to pin inbound channel traffic to specific agents. Each agent gets its own workspace with independent SOUL.md, USER.md, MEMORY.md — share a common AGENTS.md for operating rules while giving each a unique personality.

### Per-Agent Overrides

Each agent in `agents.list[]` can override most global defaults:

```json5
{
  agents: {
    list: [
      {
        id: "support",
        workspace: "~/.openclaw/workspace-support",
        model: { primary: "anthropic/claude-sonnet-4-6" },  // cheaper model for routine work
        tools: {
          profile: "messaging",
          allow: ["slack"],
          deny: ["exec", "browser"],
        },
        skills: {
          allowList: ["customer-support", "email-triage"],
        },
        sandbox: {
          mode: "all",           // sandbox everything for this agent
        },
        heartbeat: {
          every: "1h",
          target: "whatsapp",
          to: "+15551234567",
        },
      },
    ],
  },
}
```

**Overridable per-agent:** model, tools (profile/allow/deny), skills (allowList), sandbox (mode/scope/docker), heartbeat (every/target/to/model), workspace path.

**Agent creation CLI:**
```bash
openclaw agents add my-assistant --model anthropic/claude-sonnet-4-6 --tools web_search,message --workspace ~/.openclaw/workspace-assistant
openclaw agents bind --agent work --bind telegram:ops
openclaw agents bind --agent main --bind whatsapp
```

`clawhq agent add <id>` scaffolds a new agent within an existing deployment — creates workspace, identity files, memory directories, and updates `openclaw.json`.

---

## Automation: Cron, Heartbeat, and Hooks

### Cron Jobs (Time-Based)

Gateway's built-in scheduler. Jobs persist under `~/.openclaw/cron/` and survive restarts. Persisted at `~/.openclaw/cron/jobs.json`.

**Three schedule kinds:**

| Kind | Format | Example |
|------|--------|---------|
| `cron` | 5-field cron expression | `"0 8 * * *"` (daily at 8 AM) |
| `every` | Interval in milliseconds | `1800000` (every 30 min) |
| `at` | One-shot ISO timestamp | `"2026-04-05T09:00:00Z"` |

One-shot (`at`) jobs auto-delete after success by default; set `deleteAfterRun: false` to keep them. If an ISO timestamp omits a timezone, it's treated as UTC.

```json5
{
  name: "Morning Brief",
  schedule: { kind: "cron", expr: "0 8 * * *" },
  sessionTarget: "isolated",   // isolated | main
  agentId: "main",             // optional: bind to specific agent
  payload: {
    kind: "agentTurn",
    message: "Summarize today's calendar, tasks, and priorities.",
  },
}
```

**Key fields:** `sessionTarget` ("main" = enqueues system event in active chat, "isolated" = background lightweight session), `agentId` (optional binding to specific agent — falls back to default if missing), `delivery` ("announce" | "none" | "errors"), `model` (per-job override), `activeHours` (waking hours constraint with timezone).

**Main session vs. Isolated session:** Main session jobs enqueue a system event and run on the next heartbeat (access full context). Isolated jobs run in a dedicated lightweight session (cheaper, no context bleed). Jobs are identified by a stable `jobId` used by CLI/Gateway APIs.

**Cron syntax trap (LM-09):** Stepping like `5/15` is invalid — must be `3-58/15`. Invalid syntax causes jobs to silently not run. Cron expressions use `croner`; if timezone is omitted, the Gateway host's local timezone is used.

**CLI quickstart:**
```bash
openclaw cron add --name "Calendar check" --at "20m" --session main --system-event "Next heartbeat: check calendar." --wake now
openclaw cron list
openclaw cron remove <jobId>
```

### Heartbeat (Periodic Awareness)

Heartbeat checks in periodically, applies judgment, and stays quiet if nothing matters. Configured via `HEARTBEAT.md` and the config file.

**Cost trap:** Use isolated cron jobs instead of native heartbeat for cost control. Native heartbeat can fire more frequently than configured (system events and exec completions trigger extra runs) and loads the full main-session context each time (170k–210k input tokens per run observed).

### Hooks (Event-Driven)

Hooks are TypeScript modules that fire on specific events. They extend the agent lifecycle without modifying core OpenClaw code.

**Hook discovery (in order of precedence):**
1. **Workspace hooks:** `<workspace>/hooks/` — per-agent, highest precedence
2. **Managed hooks:** `~/.openclaw/hooks/` — user-installed, shared across workspaces
3. **Bundled hooks:** `<openclaw>/dist/hooks/bundled/` — shipped with OpenClaw

Managed hook directories can be either a single hook or a hook pack (npm package directory). During onboarding (`openclaw onboard`), you're prompted to enable recommended hooks.

**Bundled hooks:**

| Hook | Event | Purpose |
|------|-------|---------|
| `session-memory` | `/new` command | Saves session context to memory when you start a new session |
| `command-logger` | All commands | Audit trail logged to `~/.openclaw/logs/commands.log` |
| `boot-md` | Gateway start | Runs BOOT.md when the gateway starts (requires `hooks.internal.enabled: true`) |
| `bootstrap-extra-files` | `agent:bootstrap` | Injects additional workspace files from configured glob/path patterns (only recognized bootstrap basenames: AGENTS.md, TOOLS.md) |
| `soul-evil` | Scheduled/random | Swaps SOUL.md content with an alternate file during a scheduled window — in memory only, without modifying files on disk |

**Custom hooks:** Place in `<workspace>/hooks/` or `~/.openclaw/hooks/` with a `HOOK.md` file describing the hook's purpose and configuration. OpenClaw scans these directories at startup.

**Hook configuration:**
```json5
{
  hooks: {
    enabled: true,
    token: "shared-secret",
    path: "/hooks",
    defaultSessionKey: "hook:ingress",
    allowRequestSessionKey: false,
    allowedSessionKeyPrefixes: ["hook:"],
    internal: {
      enabled: true,
      entries: {
        "session-memory": { enabled: true },
        "bootstrap-extra-files": {
          enabled: true,
          paths: ["packages/*/AGENTS.md", "packages/*/TOOLS.md"],
        },
      },
    },
    mappings: [
      {
        match: { path: "gmail" },
        action: "agent",
        agentId: "main",
        deliver: true,
      },
    ],
  },
}
```

**Webhook hooks:** External webhook routing via `hooks.mappings[]`, Gmail Pub/Sub integration (`hooks.gmail.*`). Treat all hook/webhook payload content as untrusted input. Keep `allowUnsafeExternalContent` flags disabled unless doing tightly scoped debugging.

**Hook management CLI:**
```bash
openclaw hooks enable session-memory
openclaw hooks disable command-logger
openclaw hooks list
```

---

## Skills System

Skills are the modular capability layer of OpenClaw. A skill is a markdown-based documentation file (`SKILL.md`) that teaches the agent *when* and *how* to use tools effectively. Skills don't grant tool access — that's handled by tool policy — but they provide the context, constraints, and step-by-step guidance the agent needs to use tools well.

### Skill Architecture

A skill is a folder containing:
```
my-skill/
├── SKILL.md        # Skill documentation (YAML frontmatter + markdown instructions)
├── install.sh      # Optional install script (NOT auto-executed for security)
├── config.json     # Optional config schema
├── templates/      # Optional reference templates
└── scripts/        # Optional helper scripts
```

The `SKILL.md` file has YAML frontmatter (metadata: name, description, tools, dependencies) followed by markdown instructions (behavioral guidance, examples, constraints).

### Skill Sources (Three Tiers)

| Source | Location | Precedence |
|--------|----------|------------|
| **Workspace skills** | `<workspace>/skills/` | Highest — per-agent, overrides managed/bundled |
| **Managed skills** | `~/.openclaw/skills/` | User-installed from ClawHub, shared across workspaces |
| **Bundled skills** | `<openclaw>/dist/skills/bundled/` | Shipped with OpenClaw core |

### Skill Injection Rules

A skill appears in the system prompt only when all three conditions are met:
1. The skill is loaded (not disabled, passes allowlist)
2. At least one of the skill's tools is available (passes tool policy in `openclaw.json`)
3. The session's prompt mode includes skills (default behavior)

Skills are injected into the system prompt between the Identity section and the Tools section. Each appears as a named markdown section (`## skill-name` followed by the content of the skill's `SKILL.md`).

### Skill Configuration

```json5
{
  skills: {
    enabled: true,
    allowList: ["web-search", "morning-brief", "voice-call"],  // only these skills loaded
    denyList: ["browser-automation"],
    entries: {
      "web-search": {
        enabled: true,
        env: { "SEARCH_API_KEY": "sk-..." },  // skill-specific env vars
      },
    },
  },
}
```

Per-agent skill filtering: `agents.list[].skills.allowList` overrides global skill settings. Different agents can have different skill sets — a research agent might have web search while a DevOps agent has infrastructure management.

Skill environment variables (`skills.entries[name].env`) are set in the agent's environment and available to tool execution. Sandboxed sessions inherit skill env vars via Docker `--env` flags.

### Skill Management

```bash
openclaw skills list              # List installed skills
openclaw skills info web-search   # Show skill details + tool manifest
openclaw skills check --eligible  # Verify requirements are met
openclaw skills install <name> --allow-tools file_read,web_get  # Install with restricted permissions
```

The `--allow-tools` flag sets a deny-by-default policy per skill. Only the tools you list are available to the skill at runtime, not just by convention. If the skill tries to use a tool not in the allowlist, it gets a permission denied error at runtime (logged in the session log).

### Skill Security

- Skill names are sanitized to prevent path traversal
- Skill sync destinations confined to sandbox `skills/` root
- Plugin and hook install scripts disabled via `--ignore-scripts` to prevent lifecycle script execution during install
- Skills run inside the prompt context — they can influence agent behavior but are subject to tool policy enforcement
- Community skills should be reviewed before installation (ClawHavoc campaign in January 2026 found hundreds of malicious skills on ClawHub including Atomic Stealer payloads, keyloggers, and SOUL.md/MEMORY.md injection)
- Skills that make repeated API calls can generate unexpected costs if they run in loops

---

## Plugins

Plugins are TypeScript modules that extend OpenClaw at the runtime level — deeper than skills, which only affect the prompt. Plugins can register channels, model providers, tools, skills, speech engines, image generation, commands, hooks, and Gateway RPC methods.

### Plugin Architecture

Plugins run in-process with the Gateway (treat as trusted code). They have two phases:

1. **Discovery + Validation:** Uses `openclaw.plugin.json` manifest and JSON Schema — no code execution. OpenClaw validates config, explains missing/disabled plugins, and builds UI/schema hints.
2. **Runtime Loading:** Enabled plugins loaded via `jiti` and register capabilities into a central registry via `register(api)`.

**Plugin manifest** is the control-plane source of truth. The runtime module registers actual behavior (hooks, tools, commands, provider flows).

### Plugin Capabilities

| Capability | Example |
|-----------|---------|
| **Channels** | Custom messaging platforms (Teams, Matrix, SMS) |
| **Model providers** | Custom or self-hosted model endpoints |
| **Tools** | New agent tools beyond the built-in set |
| **Skills** | Bundled skill documentation |
| **Speech** | TTS/STT engines (ElevenLabs, etc.) |
| **Image generation** | Image providers (fal, DALL-E, etc.) |
| **CLI commands** | Custom slash commands that execute without invoking the AI agent |
| **Hooks** | Event-driven automation extensions |
| **Gateway RPC** | Custom Gateway API endpoints |

### Plugin Management

```bash
openclaw plugins list
openclaw plugins info my-plugin
openclaw plugins install my-plugin     # npm specs only (registry packages)
openclaw plugins enable my-plugin
openclaw plugins disable my-plugin
openclaw plugins doctor                # Report plugin load errors
```

Plugin install only accepts npm registry specs (package name + optional exact version or dist-tag). Git/URL/file specs and semver ranges are rejected for security. Bare specs and `@latest` stay on the stable track.

### Plugin Configuration

```json5
{
  plugins: {
    entries: {
      "my-plugin": {
        enabled: true,
        config: { /* plugin-specific settings */ },
      },
    },
    load: {
      paths: ["~/.openclaw/plugins/custom"],  // additional plugin directories
    },
  },
}
```

### Notable Memory Plugins

| Plugin | Architecture | Use Case |
|--------|-------------|----------|
| `memory-core` (default) | SQLite + sqlite-vec, keyword + vector hybrid | Standard memory search, works out of the box |
| `memory-wiki` | Markdown wiki-based | Structured knowledge base with pages, cross-references, and diary UI |
| `memory-lancedb` | LanceDB vector database | High-performance vector search for large memory stores |
| **Active Memory** | Dedicated sub-agent | Automatic context recall before main reply (v2026.4.10+) |
| **QMD** | Local sidecar, reranking, query expansion | Better recall accuracy, indexes directories outside workspace |
| **Cognee** | Knowledge graph + entity extraction | Relational queries ("who manages auth?"), auto-indexes MEMORY.md |
| **Mem0** | Auto-extraction, vector DB, deduplication | Automatic fact capture without manual curation, cloud or self-hosted |

---

## Media Understanding

OpenClaw can interpret images, transcribe audio, and analyze video when configured. This is **not enabled by default** — it requires explicit config even when the model supports the modality.

### Configuration

```json5
{
  tools: {
    media: {
      // Shared fallback models for all media types
      models: [{ provider: "anthropic", model: "claude-sonnet-4-6" }],
      concurrency: 2,  // max concurrent media ops per turn

      image: {
        enabled: true,
        models: [{ provider: "ollama", model: "<local-model-tag>" }],
        timeoutSeconds: 120,  // increase for local models (default 30s)
        maxBytes: 10485760,   // 10MB max per image
      },
      audio: {
        enabled: true,
        models: [{ provider: "openai", model: "whisper-1" }],
        timeoutSeconds: 60,
        language: "en",       // language hint for transcription
      },
      video: {
        enabled: true,
        models: [{ provider: "google", model: "gemini-2.5-pro" }],
        timeoutSeconds: 180,
      },
    },
  },
}
```

### Media Staging Pipeline

When a user shares media (screenshot, voice note, PDF) via a messaging channel:

1. Channel adapter downloads the file to `~/.openclaw/media/` (the media directory)
2. Staging pipeline copies it into `workspace/media/inbound/<filename>` (sandbox-safe)
3. Media understanding model processes the content and adds the description to the agent's context
4. Agent sees the interpreted text, not the raw file

**Key gotcha:** `tools.fs.workspaceOnly: true` does NOT block media understanding. The staging pipeline operates independently of the agent's file tools — it copies files into workspace before the agent processes them. The `fs` restriction only governs the agent's `read`/`write`/`edit` tools.

### Supported Modalities

| Modality | Capability | Example Use |
|----------|-----------|-------------|
| **Image** | Vision/description | Screenshots, stock charts, whiteboard photos, PDFs |
| **Audio** | Transcription | Voice notes, meeting recordings |
| **Video** | Description | Screen recordings, video messages |

### Provider Notes

- **Ollama (local):** Gemma4:26b is vision-capable. Set `timeoutSeconds: 120`+ for local inference — default 30s is too short for 26B parameters on mixed CPU/GPU.
- **Anthropic:** Claude Sonnet/Opus support image understanding natively.
- **OpenAI:** Whisper for audio transcription, GPT-4o for image understanding.
- **Google:** Gemini models support all three modalities.

---

## Voice & Real-time Capabilities

OpenClaw supports voice interaction through multiple subsystems:

| Capability | Plugin/Module | Description |
|-----------|--------------|-------------|
| **Voice Calls** | `voice-call` plugin | Inbound/outbound voice calls with real-time speech |
| **Talk Mode** | `talk-voice` plugin | Real-time conversational voice (push-to-talk or hands-free) |
| **TTS** | `src/tts/` | Text-to-speech output with provider registry (ElevenLabs, etc.) |
| **Real-time Transcription** | `src/realtime-transcription/` | Live audio stream transcription |
| **Phone Control** | `phone-control` plugin | Phone device integration |

Talk Mode supports MLX local speech provider on macOS for zero-latency, fully offline voice interaction.

### TTS Configuration

```json5
{
  tts: {
    provider: "elevenlabs",     // or "openai", "mlx" (local)
    voice: "rachel",
    autoMode: true,             // auto-detect when to speak
  },
}
```

---

## Diagnostics & Observability

### OpenTelemetry Integration

OpenClaw supports full OpenTelemetry export for traces, metrics, and logs via the `diagnostics-otel` plugin.

```json5
{
  diagnostics: {
    otel: {
      enabled: true,
      endpoint: "http://localhost:4318",
      protocol: "http/protobuf",  // or "grpc"
      serviceName: "openclaw-agent",
      traces: true,
      metrics: true,
      logs: true,
      sampleRate: 1.0,
      flushIntervalMs: 5000,
    },
  },
}
```

### Diagnostic Flags

```json5
{
  diagnostics: {
    flags: ["cache-trace"],    // wildcard support: ["*"] enables all
  },
}
```

Cache trace logging writes JSONL output for embedded agent run inspection — useful for debugging tool execution and model behavior.

### Additional Config Sections

| Section | Purpose |
|---------|---------|
| `diagnostics.*` | OpenTelemetry, debug flags, cache trace |
| `logging.*` | Log levels, file paths, console style, redaction |
| `update.*` | Update channel (stable/beta/dev), auto-update |
| `ui.*` | UI accent color, assistant name/avatar |
| `meta.*` | Config metadata (lastTouched version/timestamp) |

---

## Built-in Tools Inventory

47+ built-in tools ship with OpenClaw core. They are the typed function definitions sent to the model API that the agent can invoke.

### Core Tool Groups

| Group | Tools | Purpose |
|-------|-------|---------|
| `group:fs` | `read`, `write`, `edit`, `apply_patch` | File system operations within workspace |
| `group:runtime` | `exec`, `process` | Shell command execution, process management |
| `group:sessions` | `session_status`, `sessions_spawn`, `sessions_send`, `sessions_list`, `sessions_history`, `sessions_yield` | Session management, subagent spawning, cross-session messaging |
| `group:memory` | `memory_search`, `memory_get` | Semantic search and file retrieval over memory |
| `group:web` | `web_search`, `web_fetch`, `browser` | Web search, page fetch, browser automation |

### Individual Tools

**File System & Execution**

| Tool | Purpose | Notes |
|------|---------|-------|
| `exec` | Execute shell commands | Subject to sandbox, elevated mode, security policy |
| `read` | Read files (sandbox-rooted when sandboxed) | |
| `write` | Write files | |
| `edit` | Edit files in-place | |
| `apply_patch` | Apply unified diff patches | |

**Web & Search**

| Tool | Purpose | Notes |
|------|---------|-------|
| `browser` | Browse web pages via CDP/Chromium | Auto-starts sandbox browser when needed |
| `web_search` | Web search | Providers: Brave, DuckDuckGo, Exa, Perplexity, Tavily, SearXNG |
| `web_fetch` | Fetch web page content | Subject to SSRF policy |

**Media & Content Generation**

| Tool | Purpose | Notes |
|------|---------|-------|
| `image` | Analyze images with vision model | Requires `tools.media.image.enabled` |
| `image_generate` | Generate or edit images | Providers: OpenAI (GPT-Image-1), Google, fal |
| `video_generate` | Generate video | Providers: Seedance 2.0, etc. |
| `music_generate` | Generate music/audio | |
| `tts` | Text-to-speech | Providers: ElevenLabs, OpenAI, MLX (local) |
| `pdf` | Analyze PDF documents | Native provider support |
| `canvas` | Canvas rendering for visual content | |

**Communication & Sessions**

| Tool | Purpose | Notes |
|------|---------|-------|
| `message` | Send messages to channels | Subject to channel config and permissions |
| `cron` | Manage cron jobs (add/edit/remove/list) | |
| `sessions_spawn` | Spawn subagent sessions | Subject to `subagents.*` config |
| `sessions_send` | Send messages to other sessions | Cross-session communication |
| `sessions_list` | List active sessions | |
| `sessions_history` | Read session transcript history | |
| `sessions_yield` | Yield control back to parent session | For subagent coordination |
| `session_status` | Query session metadata | Always available |
| `agents_list` | List configured agents | |
| `subagents` | Manage subagent lifecycle | |
| `update_plan` | Update an in-progress plan | |
| `gateway` | Gateway management operations | |

**Memory**

| Tool | Purpose | Notes |
|------|---------|-------|
| `memory_search` | Semantic search over memory files | Requires `memorySearch.enabled` |
| `memory_get` | Read specific memory file or line range | |

**Device & Nodes**

| Tool | Purpose | Notes |
|------|---------|-------|
| `nodes_canvas` | Node display management | For paired companion devices |
| `nodes_camera` | Capture camera/screen from nodes | Requires foregrounded node app |
| `nodes_location` | Get device location | Returns JSON (lat/lon/accuracy/timestamp) |
| `nodes_run` | Execute commands on remote nodes | |
| `nodes_notify` | Send notifications to nodes | |

**Subagent spawning:** `sessions_spawn` supports inline file attachments for subagent runtime (name, content, optional encoding and mimeType). Files are materialized into the child workspace at `.openclaw/attachments/<uuid>/` with a `.manifest.json` metadata file. Subject to `agents.defaults.subagents.runTimeoutSeconds`.

---

# Part 4 — Security

## Threat Model & Hardening

OpenClaw is an agent with shell access, browser control, and the ability to send messages on your behalf — on a loop, without asking. The attack surface is enormous:

1. **Host compromise:** Open ports, weak SSH, unpatched runtimes, sloppy containers. Once an attacker lands, they inherit whatever OpenClaw can reach.
2. **Prompt injection:** Attackers hide instructions inside content OpenClaw reads — emails, GitHub issues, web pages, even screenshots with text.
3. **Secret leakage:** If the agent can read `~/.ssh` or `.env` files, a single bad tool call turns into full account takeover.
4. **Supply chain (ClawHub skills):** The ClawHavoc campaign targeted workspace files with malicious skills containing hidden instructions.
5. **Cross-site WebSocket hijacking:** CVE-2026-25253 (CVSS 8.8) — any website could steal auth tokens via a malicious link.

### Hardening Checklist

#### Gateway & Network
- [ ] Bind gateway to `127.0.0.1` only — never `0.0.0.0`
- [ ] Set a strong `gateway.auth.token` (treat like a domain admin password)
- [ ] Inject token via environment variables, not static config files
- [ ] Use SSH tunnel, Tailscale, or VPN for remote access — never expose the port directly
- [ ] Run `openclaw security audit --deep` regularly (especially after config changes)
- [ ] Never use `controlUi.allowedOrigins: ["*"]`
- [ ] Validate WebSocket origin headers on all upgrade requests
- [ ] Disable mDNS/Bonjour service discovery in container

#### Filesystem & Secrets
- [ ] `chmod 700 ~/.openclaw`
- [ ] `chmod 600 ~/.openclaw/.env` and `~/.openclaw/credentials/`
- [ ] `chmod 600 ~/.openclaw/credentials/whatsapp/*/creds.json`
- [ ] Store secrets in `~/.openclaw/secrets/` with `chmod 700` (dir) and `chmod 600` (files)
- [ ] Load secrets via service manager, not interactive shell (avoids `.bash_history` leakage)
- [ ] Keep secrets out of the agent's reachable filesystem
- [ ] Make identity files read-only: `chmod 444 SOUL.md IDENTITY.md MEMORY.md`

#### Agent Behavior
- [ ] Use `pairing` or `allowlist` DM policy — never `open` with tools enabled
- [ ] Require `@mention` gating in group chats
- [ ] Limit high-risk tools (`exec`, `browser`, `web_fetch`) to trusted agents
- [ ] Use the strongest available model for tool-enabled agents
- [ ] Treat all external content (links, attachments, pasted text) as hostile
- [ ] Block destructive commands: recursive deletes, force pushes, arbitrary network calls

#### Container/Docker Deployment
```yaml
services:
  openclaw:
    image: openclaw/agent:latest
    security_opt:
      - no-new-privileges:true
    read_only: true
    user: "1000:1000"
    cap_drop:
      - ALL
    tmpfs:
      - /tmp:rw,noexec,nosuid
```

#### ClawHub Skills
- [ ] Never install skills blindly — review the GitHub repo first
- [ ] Only load skills you explicitly trust
- [ ] ClawHub has VirusTotal scanning since February 2026, but review is still recommended
- [ ] ClawHQ vetting pipeline: stage → vet → approve → activate (every install creates rollback snapshot)

#### Monitoring & Recovery
- [ ] Enable comprehensive session and action logging
- [ ] Nightly backups of `~/.openclaw/` (state + workspace)
- [ ] Git-back your workspace (but keep credentials and `openclaw.json` out of the repo)
- [ ] If a token leaks, rotate immediately — don't debate it
- [ ] Have a recovery plan: scripts to rebuild the Gateway from a fresh OS

---

## Container Hardening Matrix

Three postures from development-friendly to maximum lockdown. Hardened is the default — users get hardened containers without knowing what `cap_drop` means. Implementation: `src/build/docker/posture.ts`.

| Control | Minimal | Hardened | Under-Attack |
|---|---|---|---|
| Linux capabilities | `cap_drop: ALL` | `cap_drop: ALL` | `cap_drop: ALL` |
| Privilege escalation | `no-new-privileges` | `no-new-privileges` | `no-new-privileges` |
| Filesystem | Writable rootfs | Read-only rootfs | Read-only rootfs + encrypted workspace |
| User | Non-root (UID 1000) | Non-root (UID 1000) | Non-root (UID 1000) |
| Temp storage | tmpfs 512MB, nosuid | tmpfs 256MB, nosuid | tmpfs 128MB, noexec/nosuid |
| Network isolation | ICC not enforced | ICC disabled, auto-firewall | ICC disabled + air-gap egress |
| Resource limits | None | 2 CPU, 2GB RAM, 256 PIDs | 1 CPU, 1GB RAM, 128 PIDs |
| Runtime sandbox | — | gVisor | gVisor |
| Identity files | — | Read-only mount, immutable identity | Read-only mount + integrity hash |
| Workspace | Writable | Writable (scoped) | Writable (encrypted at rest) |

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

## Egress Firewall

iptables rules restricting container network access. Implementation: `src/build/launcher/firewall.ts`.

- Allow established/related connections (return traffic)
- Allow DNS (UDP/TCP 53) — required for API resolution
- Allow HTTPS (TCP 443) — required for API calls
- Allowlist-only mode: restrict HTTPS to specific domains (e.g., `imap.gmail.com`, `api.todoist.com`)
- Air-gap mode: block all egress except ESTABLISHED/RELATED
- Log and drop everything else

The firewall is implemented as a dedicated iptables chain (`CLAWHQ_FWD`) attached to the Docker bridge interface.

**Critical operational detail (LM-13):** After every `docker compose down`, Docker destroys and recreates the bridge interface, invalidating the chain. ClawHQ detects this and reapplies automatically — a landmine that has caused hours of debugging in manual setups. The Deploy toolchain applies the firewall; Doctor verifies it continuously.

---

## Prompt Injection Defense

Implementation: `src/secure/sanitizer/` with rules documented in `src/secure/sanitizer/RULES.md`.

### Pipeline

```
Input → Detect → Score → [Quarantine | Sanitize] → [Wrap] → Output
```

1. **Detect**: Run all rules against input text, collect threats with category/tier/severity
2. **Score**: Weighted sum (high=0.4, medium=0.2, low=0.1), capped at 1.0
3. **Quarantine** (score >= 0.6): Replace content with notice, log for review
4. **Sanitize** (score < 0.6): Strip/replace detected threats in-place
5. **Wrap** (optional): Add `<untrusted-content>` data-boundary markers

### Detection Rules

**Tier 1 — High Detectability (near-zero false positives):**
- Invisible Unicode (zero-width spaces, joiners, directional overrides, tag characters)
- Injection keywords (explicit attempts to override system prompt)
- Delimiter spoofing (fake system/assistant/user markers)
- Encoded payloads (base64, hex, URL-encoded instructions)
- Decode instructions ("decode this base64...")
- Exfiltration markup (hidden links, image tags for data exfiltration)

- Exfiltration instructions (natural-language requests to send data externally)
- Secret leak detection (AWS keys, GitHub PATs, Slack tokens, OpenAI keys, JWTs, private keys)

Confusable normalization (Cyrillic/Greek/fullwidth → ASCII) is applied before Tier 1 pattern matching to catch obfuscated injection keywords. For adversarial prompt injection (semantic override, social engineering), use model-based detection — regex cannot reliably catch motivated attackers.

The sanitizer sits between external content ingestion and LLM context assembly. It complements the egress firewall — the firewall restricts what goes out, the sanitizer restricts what comes in.

---

## Secret Scanning

ClawHQ recommends [gitleaks](https://github.com/gitleaks/gitleaks) for secret scanning (800+ patterns, actively maintained). `clawhq scan` checks for gitleaks availability and runs it against the deployment directory.

### Supply Chain Security

| Control | What It Does |
|---|---|
| Skill vetting | Regex-based scanning for outbound HTTP, shell execution, and file escape patterns |
| Approval gate | High-stakes actions (send, delete, purchase) require user approval via Telegram |
| Egress firewall | Port-aware domain allowlist prevents unauthorized outbound connections |

---

## Credential Health Probes

Implementation: `src/secure/credentials/probes.ts`. Timeout: 10 seconds per probe.

| Integration | Health Probe | What It Tests |
|---|---|---|
| Email (IMAP) | `himalaya account check` | IMAP + SMTP auth, server reachable |
| Calendar (CalDAV) | CalDAV PROPFIND request | Auth valid, calendar accessible |
| Tasks (Todoist) | `todoist projects` list | API key valid, API reachable |
| Code (GitHub) | `gh auth status` | PAT valid, scopes sufficient |
| Research (Tavily) | Search query | API key valid, quota remaining |
| Finance (Yahoo) | Quote fetch | Endpoint reachable (no auth) |

Probes run on schedule (configurable per blueprint). Failures trigger alerts with specific remediation steps. Credential expiry tracked where APIs expose it — 7-day advance warnings.

---

# Part 5 — Deployment & Operations

## Two-Stage Docker Build

```
Stage 1: openclaw:local (base image)
├── OpenClaw source (upstream)
├── apt packages: tmux, ffmpeg, jq, ripgrep (configurable per blueprint)
├── Node.js runtime + dependencies
└── Base tools: git, curl, openssl

Stage 2: openclaw:custom (user layer)
├── himalaya (IMAP email client, static musl binary)
├── gh (GitHub CLI)
├── Additional tools declared by blueprint
├── Integration CLI wrappers (todoist, ical, quote, tavily, email)
├── Skills (morning-brief, construct, etc.)
└── Custom user tools
```

Stage 1 rebuilds only when OpenClaw upstream changes or apt packages change. Stage 2 rebuilds when tools, skills, or integration wrappers change. ClawHQ wraps Docker CLI — it builds *on top of* OpenClaw's Dockerfiles (`Dockerfile`, `Dockerfile.sandbox`, `Dockerfile.sandbox-browser`, `Dockerfile.sandbox-common`), not by modifying them. Sandbox setup requires `scripts/sandbox-setup.sh`.

---

## Blueprint System

Blueprints are complete agent designs — YAML files that configure every dimension of OpenClaw for a specific job. Choose a blueprint ("Email Manager," "Stock Trading Assistant," "Meal Planner"), customize it, and ClawHQ forges a hardened, running agent.

### Blueprint Schema (14 Sections)

Defined in `src/design/blueprints/types.ts`, validated by 70+ checks in `src/design/blueprints/validate.ts`:

| Section | What it controls |
|---|---|
| `use_case_mapping` | What the blueprint replaces, tagline, description, day-in-the-life narrative |
| `customization_questions` | 1-3 questions asked during setup (select or free-text) |
| `personality` | Tone, style, relationship model, boundaries |
| `security_posture` | Hardening level (minimal/hardened/under-attack), egress rules, identity mount |
| `monitoring` | Heartbeat frequency, health checks, quiet hours, alert triggers |
| `memory_policy` | Hot/warm/cold tier sizes, retention periods, summarization aggressiveness |
| `cron_config` | Heartbeat, work session, morning brief schedules |
| `autonomy_model` | Default autonomy level (low/medium/high), approval gates |
| `model_routing_strategy` | Local vs. cloud default, escalation categories, quality threshold |
| `integration_requirements` | Required, recommended, optional integrations |
| `channels` | Supported messaging channels, default channel |
| `skill_bundle` | Included and recommended skills |
| `toolbelt` | Role description, tool inventory with categories, skill descriptions |

### Example Blueprint (Email Manager)

```yaml
name: Email Manager
version: "1.0.0"

use_case_mapping:
  replaces: Gmail / Outlook / Apple Mail (manual triage)
  tagline: "Inbox zero, email triage, calendar-aware digests, task extraction"
  description: >
    Purpose-built email operations agent. Triages your inbox every 15 minutes,
    extracts action items into tasks, guards your calendar, and delivers a
    morning digest so you start the day informed — not overwhelmed.

personality:
  tone: direct
  style: "efficient, no fluff, protective of attention"
  relationship: email operations manager
  boundaries: "never sends without approval on first contact"

security_posture:
  posture: hardened
  egress: allowlist-only
  egress_domains: [imap.gmail.com, smtp.gmail.com, api.todoist.com]
  identity_mount: read-only

memory_policy:
  hot_max: "120KB"
  hot_retention: "7d"
  warm_retention: "90d"
  cold_retention: "365d"
  summarization: balanced

autonomy_model:
  default: medium
  requires_approval: [sending_messages, account_changes, public_posts]

toolbelt:
  role: "Email operations manager"
  tools:
    - name: email
      category: email
      required: true
      description: "Email reading, triage, and drafting via himalaya"
    - name: ical
      category: calendar
      required: true
      description: "Calendar awareness via CalDAV"
    - name: todoist
      category: tasks
      required: false
      description: "Task extraction and tracking via Todoist API"
```

### Built-in Blueprints

| Blueprint | Relationship | Operational Profile |
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
| `Dockerfile` | Custom layer — binary installs from GitHub releases | Composed from integration selections |
| `workspace/SOUL.md` | Agent mission, principles, hard stops, data covenant | #8: token budget vs. `bootstrapMaxChars` |
| `workspace/USER.md` | User context placeholder | #8: kept within token budget |
| `workspace/IDENTITY.md` | Agent name, personality summary | Auto-generated from blueprint |
| `workspace/AGENTS.md` | Tool inventory, skill inventory, autonomy model | Auto-populated from blueprint |
| `workspace/HEARTBEAT.md` | Recon phases — auto-populated from enabled integrations | #9: schedule syntax validated |
| `workspace/TOOLS.md` | Tool inventory — cross-referenced against installed tools | Cross-referenced against actually-installed tools |
| `workspace/MEMORY.md` | Long-term memory skeleton with sections | Pre-structured for the agent |
| `workspace/<tool>` | CLI tools — email, tasks, todoist, ical, quote, tavily, todoist-sync | Generated based on integration selections, chmod +x |
| `workspace/skills/` | Construct + morning-brief skill templates | Skills from blueprint's `skillsIncluded` |
| `cron/jobs.json` | Scheduled job definitions (OpenClaw native format) | #9: stepping syntax validated, timezone-correct |

---

## Integration Layer

### Provider-Agnostic Categories

| Category | Example Providers | Interface |
|---|---|---|
| **Email** | Gmail, iCloud, Outlook, Fastmail, ProtonMail | `email inbox`, `email send`, `email search` |
| **Calendar** | Google, iCloud, Outlook, Fastmail | `ical today`, `ical create` |
| **Tasks** | Todoist, TickTick, Linear, Notion, Asana | `todoist list`, `todoist add`, `todoist complete` |
| **Messaging** | Telegram, WhatsApp, Slack, Discord, Signal, iMessage, Teams, Matrix | Channel config |
| **Files** | Google Drive, Dropbox, iCloud Drive | `files list`, `files get` |
| **Code** | GitHub, GitLab, Sentry | `gh repo list`, `gh issue list`, `gh pr create` |
| **Finance** | Yahoo Finance, Alpha Vantage | `quote AAPL` |
| **Research** | Tavily, Perplexity | `tavily search <query>` |
| **Notes** | Notion, Obsidian | `notes search`, `notes create` |
| **Health** | Garmin, Apple Health | `health log`, `health summary` |
| **CRM** | Salesforce, HubSpot | `crm contacts`, `crm deals` |

### Workspace Tool Registry (Implemented)

The init wizard generates CLI tools based on integration selections. Each tool is a self-contained bash/python3 script installed to the agent's workspace with `chmod +x`. Implementation: `src/design/tools/`.

| Integration | Generated Tool | Language | Binary Deps | Env Vars |
|---|---|---|---|---|
| *always* | `tasks` | bash + jq | jq | — |
| email | `email` | bash | himalaya | — |
| calendar | `ical` | bash + python3 | curl | ICAL_USER, ICAL_PASS, ICAL_SERVER |
| tasks (todoist) | `todoist` | python3 | python3 | TODOIST_API_KEY |
| tasks (todoist) | `todoist-sync` | bash | curl, jq | TODOIST_API_KEY |
| research | `tavily` | bash | curl, jq | TAVILY_API_KEY |
| markets | `quote` | bash | curl, jq, awk | — |

The `tasks` tool includes: 12 configurable channels, 3 autonomy levels (do/do-tell/flag), 4 priority levels, recon staleness tracking, 4-hour notification cooldown, and atomic JSON writes.

The `approve-action` platform tool implements autonomy gates for high-stakes actions.

The Dockerfile generator composes binary install fragments from integration selections. Always included: curl, jq, rg. Conditionally included: himalaya (email), gh (GitHub), git (from source), ffmpeg (media), whisper (transcription, optional ~2GB).

---

## Doctor: Preventive Diagnostics

Implementation: `src/operate/doctor/checks.ts` (checks) + `src/operate/doctor/fix.ts` (auto-fix).

18 preventive checks covering all known failure modes. Every check runs in parallel — the user gets a complete picture in one pass.

| Category | Checks |
|---|---|
| **Config validation** | config-exists, config-valid, compose-exists |
| **Secrets & permissions** | secrets-perms (.env mode 0600), creds-perms (credentials.json mode 0600) |
| **Docker runtime** | docker-running, container-running, cap-drop, no-new-privileges, user-uid |
| **Agent health** | identity-size (vs. bootstrapMaxChars), cron-syntax, env-vars, workspace-exists, gateway-reachable |
| **Infrastructure** | firewall-active, disk-space, air-gap-active |

Auto-fix capabilities: file permissions (chmod), critical landmine violations in openclaw.json, container hardening issues.

---

## Diagnostic Commands

| Command | Purpose |
|---------|---------|
| `openclaw doctor` | Surface risky/misconfigured DM policies and general health |
| `openclaw security audit` | Check security posture |
| `openclaw security audit --deep` | Comprehensive security check |
| `openclaw security audit --fix` | Auto-fix flagged issues |
| `openclaw status` | Overall system status |
| `openclaw channels status --probe` | Channel health check |
| `openclaw models status --probe` | Model auth status |
| `/context list` (in session) | See exactly what's loaded, truncated, or missing |
| `/compact` (in session) | Proactively compact context before overflow |
| `clawhq doctor [--fix]` | ClawHQ's 18-check diagnostics with auto-fix |
| `clawhq status [--watch]` | Single-pane dashboard |
| `clawhq creds` | Credential health probes |
| `clawhq scan` | Secret scanning via gitleaks |
| `clawhq audit` | Tool execution + egress audit trail (append-only JSONL) |
| `clawhq verify` | Verify all integrations work from inside container |

---

# Part 6 — Platform & Business

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
| Server sizing | Recommend CPU/RAM/storage based on workload and blueprint |
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

### Skill Library

Pre-built capabilities that blueprints include:

- **morning-brief** — daily briefing (tasks, calendar, priorities)
- **email-digest** — summarize and triage incoming email
- **meeting-prep** — research attendees, prep talking points
- **session-report** — work session ledger and time tracking
- **construct** — autonomous self-improvement (agent builds its own tools)

Open-source. Community-contributed. Reviewed for safety.

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

The cPanel analogy: every successful open-source infrastructure engine eventually gets a control panel.

| Engine | Operational Burden | Control Panel |
|---|---|---|
| Linux | Server admin, security, mail, cron | cPanel, Plesk, Webmin |
| WordPress | Hosting, updates, security, backups | WordPress.com, managed WP hosting |
| Kubernetes | Container orchestration, networking | Rancher, OpenShift |
| **OpenClaw** | **Agent config, security, monitoring, evolution** | **ClawHQ** |

---

# Appendices

## File Relationship Summary

```
openclaw.json (central config — JSON5, hot-reloaded by Gateway)
├── identity.*     → Display name, theme, emoji, avatar
├── agents.*       → Workspace paths, model routing, per-agent overrides
│   ├── defaults   → Global agent defaults (model, tools, sandbox, heartbeat, compaction)
│   └── list[]     → Per-agent: workspace, model, tools, skills, sandbox, heartbeat
├── auth.*         → Auth profiles per provider, failover order
├── channels.*     → Telegram, WhatsApp, Discord, Slack, Signal, iMessage, etc.
├── tools.*        → Allow/deny lists, profiles, groups, per-provider restrictions, exec config
│   └── media.*    → Image/audio/video understanding: models, timeouts, concurrency
├── sandbox.*      → Docker isolation: mode, scope, image, network, binds, limits
├── session.*      → DM scope, thread bindings, reset mode
├── skills.*       → Global allowList/denyList, per-skill env vars and config
├── plugins.*      → Plugin entries, load paths, per-plugin config
├── memorySearch.* → Provider, model, extraPaths, fallback, scoring
├── compaction.*   → reserveTokensFloor, memoryFlush settings
├── contextPruning.* → Mode (cache-ttl), TTL, keepLastAssistants
├── cron.*         → Cron runner config, run log pruning
├── hooks.*        → Webhook routing, internal hooks, Gmail Pub/Sub
├── gateway.*      → Port, auth token, HTTP security headers, controlUi
├── browser.*      → CDP settings, Chromium profile
├── logging.*      → Level, file path, console style, redaction
├── env.*          → Environment variables, shell env passthrough
├── secrets.*      → Secret provider backends (env/file/exec)
├── discovery.*    → mDNS/Bonjour service discovery
├── diagnostics.*  → OpenTelemetry export, debug flags, cache trace
├── logging.*      → Log levels, file paths, console style, redaction
├── update.*       → Update channel (stable/beta/dev), auto-update
├── ui.*           → UI accent color, assistant name/avatar
└── meta.*         → Config metadata (lastTouched version/timestamp)

workspace/ (the agent's brain — 8 files auto-loaded each session)
├── SOUL.md          ← WHO the agent is (personality, values, hard limits, style)
├── IDENTITY.md      ← WHAT the agent is called (name, creature, vibe, emoji, avatar)
├── AGENTS.md        ← HOW the agent operates (SOP, workflow, rules, checklists routing)
├── USER.md          ← WHO you are (preferences, context — main session only)
├── TOOLS.md         ← Environment notes (SSH hosts, device names, tool quirks)
├── HEARTBEAT.md     ← Periodic awareness checklist (optional, read each heartbeat tick)
├── BOOT.md          ← Gateway restart ritual (optional, loaded via boot-md hook)
├── BOOTSTRAP.md     ← First-run interview (one-time, delete after use)
├── MEMORY.md        ← Long-term curated memory (main session only, never group chats)
├── memory/
│   ├── YYYY-MM-DD.md ← Daily logs (append-only, today + yesterday auto-loaded)
│   └── archive/      ← Old logs (> 30 days)
├── skills/           ← Workspace-specific skills (override managed/bundled)
├── hooks/            ← Workspace-specific hooks (highest precedence)
├── checklists/       ← Operation checklists referenced by AGENTS.md routing table
├── canvas/           ← Files for node displays
└── docs/             ← On-demand docs (NOT auto-loaded — read by tool call only)

~/.openclaw/ (system state — never commit to git)
├── openclaw.json    ← Central configuration (JSON5, hot-reloaded)
├── .env             ← Secrets (chmod 600)
├── credentials/     ← Channel auth tokens (chmod 600)
├── sessions/        ← Session transcripts (.jsonl)
├── cron/
│   ├── jobs.json    ← Persisted scheduled job definitions
│   └── runs/        ← Job execution history (.jsonl per job)
├── media/           ← Inbound media files (images, audio, video, PDFs)
│   └── inbound/     ← Channel-downloaded attachments staged for processing
├── skills/          ← Installed ClawHub skills (managed tier)
├── hooks/           ← User-installed hooks (managed tier, shared across workspaces)
├── plugins/         ← Installed plugins
├── browser/         ← Managed Chromium state
├── logs/            ← Runtime logs (commands.log, etc.)
└── memory/          ← Memory index (SQLite + sqlite-vec)
```

---

## Key Principles

1. **Files are the agent.** Everything about identity, behavior, and memory is plain Markdown on disk. You can edit with any text editor, version-control with git, and copy to another server for an identical agent.

2. **Separate identity from operations from knowledge.** SOUL.md = who. AGENTS.md = how. USER.md = context. MEMORY.md = accumulated knowledge. Don't cross the streams.

3. **Write to disk or lose it.** The model only "remembers" what gets written to files. Conversation context doesn't survive compaction. If it matters, persist it.

4. **Start with least privilege, expand deliberately.** Begin with `pairing` DM policy, minimal tool access, and Telegram only. Add capabilities as you gain confidence.

5. **Treat external input as hostile.** Every message, link, attachment, and web page the agent processes could contain adversarial instructions. Use the strongest available model, sandbox tool execution, and keep secrets out of reach.

6. **Make identity files immutable.** `chmod 444` on SOUL.md, IDENTITY.md. The agent should not be able to rewrite its own personality — this is a documented attack vector.

7. **Monitor costs.** Heartbeat and memory search can become token sinks. Use isolated cron sessions instead of native heartbeat. Check `/context list` to see what's consuming your context window.

---

## Production Discoveries

| Discovery | Implication |
|---|---|
| 40% of config is universal, 60% is personalized | Config generator separates the two |
| 14 config landmines silently break agents | Every landmine is a rule — impossible to ship a broken config |
| Identity files corrupt, bloat, and go stale | Identity governance: structured YAML, token budgets, staleness detection |
| Memory accumulates at ~120KB/day | Memory lifecycle: hot/warm/cold tiers, auto-summarization, size caps |
| Credentials expire silently | Credential health: probes, expiry tracking, renewal notifications |
| Security is opt-in, defaults are dangerous | Security hardened by default — every blueprint starts secure |
| Native heartbeat is a token sink | Isolated cron sessions instead of main-session heartbeat |
| Production agents need ongoing SRE | The entire platform exists because this is true |

See also: [`docs/KB.md`](KB.md) — operational knowledge base for lessons learned in production.
