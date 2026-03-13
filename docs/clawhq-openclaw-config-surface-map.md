# OpenClaw Configuration Surface Map

**Source:** Official docs (docs.openclaw.ai), configuration reference, CLI reference, channel docs, tools docs, security docs  
**Purpose:** Every configurable surface in OpenClaw that ClawHQ needs to expose in a cPanel-like GUI  
**Date:** March 2026

---

## How to read this

Each section represents a **panel or screen** in the ClawHQ interface. Under each, every configurable field is listed with its JSON path in `openclaw.json`, type, default, and what UI element it maps to.

**Priority tags:**
- 🔴 **Critical** — Must have for MVP; users will break things without it
- 🟡 **Important** — High-value for day-1 users; differentiator
- 🟢 **Nice-to-have** — Power users; can ship after MVP

---

## 1. IDENTITY & PERSONA 🔴

The agent's personality and branding. First thing users customize.

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `identity.name` | string | "Clawd" | Text input | 🔴 |
| `identity.theme` | string | — | Text input / dropdown presets ("helpful assistant", "sarcastic dev", etc.) | 🟡 |
| `identity.emoji` | string | "🦞" | Emoji picker | 🟢 |
| `identity.avatar` | string (path/URL) | — | Image uploader | 🟢 |

**Workspace files that define persona (file editor needed):**

| File | Purpose | UI Element | Priority |
|------|---------|------------|----------|
| `SOUL.md` | Core personality, values, communication style | Rich text / markdown editor | 🔴 |
| `IDENTITY.md` | Who the agent is, background, role | Markdown editor | 🟡 |
| `USER.md` | Info about the owner (preferences, context) | Markdown editor | 🟡 |
| `AGENTS.md` | Multi-agent coordination instructions | Markdown editor | 🟡 |
| `TOOLS.md` | Tool usage guidance and restrictions | Markdown editor | 🟡 |
| `BOOT.md` | Bootstrap instructions run on first session | Markdown editor | 🟢 |
| `BOOTSTRAP.md` | Extended bootstrap context | Markdown editor | 🟢 |
| `HEARTBEAT.md` | Instructions for proactive check-in behavior | Markdown editor | 🟢 |

---

## 2. AI MODEL CONFIGURATION 🔴

Which AI models power the agent, how they failover, and how they're authenticated.

### 2.1 Primary Model & Fallbacks

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `agents.defaults.model.primary` | string | — | Dropdown (provider/model format) | 🔴 |
| `agents.defaults.model.fallbacks` | string[] | [] | Ordered list builder with drag-reorder | 🔴 |
| `agents.defaults.models` | object | — | Model catalog table: alias, settings per model | 🟡 |
| `agents.defaults.imageMaxDimensionPx` | number | 1200 | Slider / number input | 🟢 |

### 2.2 Model Providers

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `models.providers.<name>.apiKey` | string / SecretRef | — | Password input + "Test Connection" button | 🔴 |
| `models.providers.<name>.baseUrl` | string | provider default | URL input (for custom/self-hosted) | 🟡 |
| `models.providers.<name>.api` | string | — | Dropdown: "openai-chat", "openai-responses", "anthropic" | 🟡 |
| `models.providers.<name>.models` | object | — | Model alias mapping table | 🟢 |

Built-in providers: `anthropic`, `openai`, `google`, `deepseek`, `mistral`, `openrouter`, `xai`, `minimax`, `ollama`

### 2.3 Auth Profiles (credential rotation)

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `auth.profiles.<name>.mode` | enum | — | Dropdown: "api_key", "oauth", "setup-token" | 🟡 |
| `auth.profiles.<name>.email` | string | — | Email input (for OAuth) | 🟡 |
| `auth.order.<provider>` | string[] | — | Ordered list of profile names per provider | 🟡 |

---

## 3. CHANNEL CONFIGURATION 🔴

Each messaging platform has its own config section. This is the most complex area.

### 3.1 Per-Channel Settings (repeated for each provider)

Providers: `whatsapp`, `telegram`, `discord`, `slack`, `signal`, `imessage`, `bluebubbles`, `googlechat`, `msteams`, `matrix`, `mattermost`, `irc`, `feishu`, `line`, `nostr`, `nextcloud`, `synology`, `tlon`, `twitch`, `zalo`, `webchat`

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `channels.<provider>.enabled` | boolean | true (if section exists) | Toggle switch | 🔴 |
| `channels.<provider>.botToken` | string | — | Password input + "Validate" button | 🔴 |
| `channels.<provider>.dmPolicy` | enum | "pairing" | Dropdown: pairing / allowlist / open / disabled | 🔴 |
| `channels.<provider>.allowFrom` | string[] | [] | Tag input (phone numbers, user IDs) | 🔴 |
| `channels.<provider>.groupPolicy` | enum | — | Dropdown: allowlist / open / disabled | 🟡 |
| `channels.<provider>.groupAllowFrom` | string[] | — | Tag input (group IDs) | 🟡 |
| `channels.<provider>.groups.*` | object | — | Per-group settings table | 🟡 |
| `channels.<provider>.groups.*.requireMention` | boolean | true | Toggle per group | 🟡 |
| `channels.<provider>.configWrites` | boolean | true | Toggle (allow channel-initiated config changes) | 🟢 |
| `channels.<provider>.accounts` | object[] | — | Multi-account table (for multi-number setups) | 🟢 |
| `channels.<provider>.defaultAccount` | string | — | Dropdown (from accounts list) | 🟢 |

### 3.2 Channel Defaults

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `channels.defaults.groupPolicy` | enum | "allowlist" | Dropdown | 🟡 |
| `channels.modelByChannel` | object | — | Table: channel ID → model override | 🟢 |

### 3.3 Channel-Specific Fields (notable examples)

**WhatsApp:** `channels.whatsapp.allowFrom` (phone numbers with +), `groups.*.requireMention`  
**Telegram:** `botToken`, `allowedUsers` (Telegram user IDs), `defaultAccount`, multi-account support  
**Discord:** `applicationId`, `botToken`, `guildId`, `threadBindings` (focus/unfocus/spawn)  
**Slack:** `botToken`, `appToken`, `signingSecret`, channel/room allowlists  
**iMessage:** `cliPath`, `dbPath`, `remoteHost`, `attachmentRoots`  
**Google Chat:** `serviceAccountRef` (SecretRef for service account JSON)

---

## 4. AGENT MANAGEMENT 🔴

Single-agent and multi-agent configuration.

### 4.1 Agent Defaults (apply to all agents)

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `agents.defaults.workspace` | string | "~/.openclaw/workspace" | Path input / browse | 🔴 |
| `agents.defaults.model` | object | — | (See Model Configuration above) | 🔴 |
| `agents.defaults.heartbeat.every` | duration | "0m" (disabled) | Duration picker / slider | 🟡 |
| `agents.defaults.heartbeat.target` | enum | "last" | Dropdown: last / whatsapp / telegram / discord / none | 🟡 |
| `agents.defaults.heartbeat.directPolicy` | enum | "allow" | Dropdown: allow / block | 🟢 |
| `agents.defaults.elevated.enabled` | boolean | false | Toggle (enable elevated/thinking mode) | 🟡 |

### 4.2 Agent List (multi-agent)

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `agents.list[]` | array of objects | — | Agent cards/table with add/edit/delete | 🟡 |
| `agents.list[].id` | string | — | Text input (agent identifier) | 🟡 |
| `agents.list[].default` | boolean | false | Radio button (one default) | 🟡 |
| `agents.list[].workspace` | string | — | Path input | 🟡 |
| `agents.list[].model` | object | — | Model config per agent (overrides defaults) | 🟡 |
| `agents.list[].tools` | object | — | Tool allow/deny per agent | 🟡 |
| `agents.list[].sandbox` | object | — | Sandbox config per agent | 🟡 |
| `agents.list[].groupChat.mentionPatterns` | string[] | — | Tag input for mention triggers | 🟡 |

### 4.3 Agent Bindings (routing rules)

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `bindings[]` | array of objects | — | Visual binding editor: match → agent | 🟡 |
| `bindings[].agentId` | string | — | Dropdown (from agents.list) | 🟡 |
| `bindings[].match.channel` | string | — | Dropdown (channel providers) | 🟡 |
| `bindings[].match.accountId` | string | — | Text input | 🟢 |
| `bindings[].match.peer.kind` | enum | — | Dropdown: group / dm | 🟢 |
| `bindings[].match.peer.id` | string | — | Text input (group/user ID) | 🟢 |
| `bindings[].type` | string | — | Dropdown: default / acp | 🟢 |

### 4.4 Sub-Agent Configuration

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `agents.defaults.subagents.model` | string | (inherits caller) | Dropdown | 🟡 |
| `agents.defaults.subagents.thinking` | object | (inherits caller) | Config panel | 🟢 |
| `agents.defaults.subagents.runTimeoutSeconds` | number | 0 | Number input | 🟢 |
| `agents.defaults.subagents.archiveAfterMinutes` | number | 60 | Number input | 🟢 |
| `agents.defaults.subagents.maxDepth` | number | — | Number input (nesting limit) | 🟢 |
| `agents.list[].subagents.allowAgents` | string[] | — | Multi-select from agent list | 🟢 |

---

## 5. TOOLS & PERMISSIONS 🔴

Controls what the agent can do — the most security-critical configuration area.

### 5.1 Global Tool Policy

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `tools.profile` | enum | — | Dropdown: "coding" / "messaging" / custom | 🔴 |
| `tools.allow` | string[] | — | Multi-select checklist with group:* support | 🔴 |
| `tools.deny` | string[] | — | Multi-select checklist (deny wins over allow) | 🔴 |

**Available tools:** `exec`, `process`, `read`, `write`, `edit`, `apply_patch`, `browser`, `canvas`, `web_search`, `web_fetch`, `cron`, `gateway`, `message`, `nodes`, `image`, `pdf`, `memory_search`, `memory_get`, `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`, `session_status`, `agents_list`

**Tool groups:** `group:runtime`, `group:fs`, `group:sessions`, `group:memory`, `group:web`, `group:ui`, `group:automation`, `group:messaging`, `group:nodes`, `group:openclaw`

### 5.2 Exec Tool Configuration

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `tools.exec.host` | enum | "sandbox" | Dropdown: sandbox / gateway / node | 🔴 |
| `tools.exec.security` | enum | — | Dropdown: allowlist / ask / auto | 🔴 |
| `tools.exec.safeBins` | string[] | — | Tag input (allowed safe binaries) | 🟡 |
| `tools.exec.safeBinTrustedDirs` | string[] | — | Path list | 🟡 |
| `tools.exec.pathPrepend` | string | — | Text input (prepend to PATH) | 🟢 |
| `tools.exec.notifyOnExit` | boolean | true | Toggle | 🟢 |
| `tools.exec.approvalRunningNoticeMs` | number | 10000 | Number input | 🟢 |
| `tools.exec.applyPatch.enabled` | boolean | false | Toggle (experimental) | 🟢 |
| `tools.exec.applyPatch.workspaceOnly` | boolean | true | Toggle | 🟢 |

### 5.3 Web Tools

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `tools.web.search.enabled` | boolean | — | Toggle | 🔴 |
| `tools.web.search.provider` | enum | (auto-detect) | Dropdown: brave / perplexity / gemini / grok / kimi | 🟡 |
| `tools.web.search.apiKey` | string | — | Password input + "Test" button | 🔴 |
| `tools.web.search.maxResults` | number | 5 | Number input / slider | 🟢 |
| `tools.web.search.timeoutSeconds` | number | 30 | Number input | 🟢 |
| `tools.web.search.cacheTtlMinutes` | number | 15 | Number input | 🟢 |
| `tools.web.fetch.enabled` | boolean | true | Toggle | 🟡 |
| `tools.web.fetch.maxChars` | number | 50000 | Number input | 🟢 |
| `tools.web.fetch.maxCharsCap` | number | 50000 | Number input | 🟢 |
| `tools.web.fetch.timeoutSeconds` | number | 30 | Number input | 🟢 |
| `tools.web.fetch.cacheTtlMinutes` | number | 15 | Number input | 🟢 |
| `tools.web.fetch.userAgent` | string | — | Text input | 🟢 |
| `tools.web.fetch.firecrawl.apiKey` | string | — | Password input (optional anti-bot fallback) | 🟢 |

### 5.4 Tool Loop Detection

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `tools.loopDetection` | object | — | Config panel | 🟢 |

### 5.5 Session Tools

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `tools.sessions.visibility` | enum | "tree" | Dropdown: self / tree / agent / all | 🟡 |
| `tools.agentToAgent` | object | — | Agent-to-agent messaging config | 🟢 |

---

## 6. SANDBOX & ISOLATION 🔴

Docker-based execution sandboxing.

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `agents.defaults.sandbox.mode` | enum | "off" | Dropdown: off / non-main / all | 🔴 |
| `agents.defaults.sandbox.scope` | enum | "session" | Dropdown: session / agent / shared | 🟡 |
| `agents.defaults.sandbox.workspaceAccess` | enum | "none" | Dropdown: none / ro / rw | 🟡 |
| `agents.defaults.sandbox.workspaceRoot` | string | "~/.openclaw/sandboxes" | Path input | 🟢 |
| `agents.defaults.sandbox.docker.image` | string | "openclaw-sandbox:bookworm-slim" | Text input | 🟡 |
| `agents.defaults.sandbox.docker.network` | string | "none" | Dropdown: none / custom network name | 🟡 |
| `agents.defaults.sandbox.docker.readOnlyRoot` | boolean | true | Toggle | 🟡 |
| `agents.defaults.sandbox.docker.memory` | string | "1g" | Input with unit selector | 🟡 |
| `agents.defaults.sandbox.docker.memorySwap` | string | "2g" | Input with unit selector | 🟢 |
| `agents.defaults.sandbox.docker.cpus` | number | 1 | Number input / slider | 🟡 |
| `agents.defaults.sandbox.docker.pidsLimit` | number | 256 | Number input | 🟢 |
| `agents.defaults.sandbox.docker.user` | string | "1000:1000" | Text input | 🟢 |
| `agents.defaults.sandbox.docker.capDrop` | string[] | ["ALL"] | Multi-select | 🟢 |
| `agents.defaults.sandbox.docker.tmpfs` | string[] | ["/tmp","/var/tmp","/run"] | Tag input | 🟢 |
| `agents.defaults.sandbox.docker.env` | object | — | Key-value editor | 🟢 |
| `agents.defaults.sandbox.docker.setupCommand` | string | — | Text input | 🟢 |
| `agents.defaults.sandbox.docker.dns` | string[] | — | Tag input | 🟢 |
| `agents.defaults.sandbox.docker.extraHosts` | string[] | — | Tag input (host:ip) | 🟢 |
| `agents.defaults.sandbox.docker.binds` | string[] | — | Mount point editor (src:dest:mode) | 🟢 |
| `agents.defaults.sandbox.docker.seccompProfile` | string | — | File path input | 🟢 |
| `agents.defaults.sandbox.docker.apparmorProfile` | string | — | Text input | 🟢 |
| `agents.defaults.sandbox.browser.enabled` | boolean | false | Toggle | 🟢 |
| `agents.defaults.sandbox.browser.allowHostControl` | boolean | false | Toggle | 🟢 |

---

## 7. SESSION MANAGEMENT 🟡

How conversations are scoped, isolated, and reset.

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `session.dmScope` | enum | "main" | Dropdown: main / per-peer / per-channel-peer / per-account-channel-peer | 🔴 |
| `session.identityLinks` | array | — | Identity mapping table (collapse cross-channel identities) | 🟡 |
| `session.reset.mode` | enum | — | Dropdown: daily / idle / manual | 🟡 |
| `session.reset.atHour` | number | 4 | Hour picker (0-23) | 🟡 |
| `session.reset.idleMinutes` | number | 120 | Number input | 🟡 |
| `session.threadBindings.enabled` | boolean | — | Toggle | 🟢 |
| `session.threadBindings.idleHours` | number | 24 | Number input | 🟢 |
| `session.threadBindings.maxAgeHours` | number | 0 | Number input (0 = unlimited) | 🟢 |

---

## 8. GATEWAY SERVER 🔴

Core server configuration. Changes here require a restart.

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `gateway.port` | number | 18789 | Number input | 🔴 |
| `gateway.bind` | string | "127.0.0.1" | Dropdown: 127.0.0.1 / 0.0.0.0 / custom IP + security warning | 🔴 |
| `gateway.mode` | enum | "local" | Dropdown: local / remote | 🔴 |
| `gateway.auth.token` | string / SecretRef | — | Password input + "Generate Random" button | 🔴 |
| `gateway.auth.password` | string | — | Password input | 🟡 |
| `gateway.auth.mode` | enum | — | Dropdown: token / password (required if both set) | 🟡 |
| `gateway.auth.allowTailscale` | boolean | — | Toggle | 🟢 |
| `gateway.reload.mode` | enum | "hybrid" | Dropdown: hybrid / hot / restart / off | 🟡 |
| `gateway.reload.debounceMs` | number | 300 | Number input | 🟢 |
| `gateway.remote` | object | — | Remote gateway connection config | 🟡 |
| `gateway.tailscale` | object | — | Tailscale serve/funnel configuration | 🟡 |
| `gateway.http.endpoints.responses` | object | — | OpenAI-compatible endpoint config | 🟢 |

---

## 9. AUTOMATION (CRON & HOOKS) 🟡

Scheduled tasks and webhook-driven automation.

### 9.1 Cron Configuration

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `cron.enabled` | boolean | — | Toggle | 🟡 |
| `cron.maxConcurrentRuns` | number | 2 | Number input | 🟡 |
| `cron.sessionRetention` | duration / false | "24h" | Duration input + disable toggle | 🟢 |
| `cron.runLog.maxBytes` | string | "2mb" | Input with unit | 🟢 |
| `cron.runLog.keepLines` | number | 2000 | Number input | 🟢 |

**Cron jobs** are stored in `~/.openclaw/cron/jobs.json` — need a **visual cron job builder**:

| Job Field | Type | UI Element | Priority |
|-----------|------|------------|----------|
| `name` | string | Text input | 🟡 |
| `schedule.kind` | enum | Dropdown: cron / interval | 🟡 |
| `schedule.expr` | string | Visual cron builder (like crontab.guru) | 🟡 |
| `sessionTarget` | enum | Dropdown: isolated / existing session key | 🟡 |
| `payload.kind` | enum | Dropdown: agentTurn / etc. | 🟡 |
| `payload.message` | string | Text area | 🟡 |

### 9.2 Hooks (Webhooks)

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `hooks.enabled` | boolean | false | Toggle | 🟡 |
| `hooks.token` | string | — | Password input ("shared secret") | 🟡 |
| `hooks.path` | string | "/hooks" | Text input | 🟢 |
| `hooks.defaultSessionKey` | string | "hook:ingress" | Text input | 🟢 |
| `hooks.allowRequestSessionKey` | boolean | false | Toggle | 🟢 |
| `hooks.allowedSessionKeyPrefixes` | string[] | ["hook:"] | Tag input | 🟢 |
| `hooks.mappings[]` | array | — | **Mapping builder:** match path → action + agentId + deliver | 🟡 |
| `hooks.gmail` | object | — | Gmail Pub/Sub integration panel | 🟡 |
| `hooks.gmail.allowUnsafeExternalContent` | boolean | false | Toggle + security warning | 🟢 |

---

## 10. BROWSER AUTOMATION 🟡

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `browser.enabled` | boolean | true | Toggle | 🟡 |
| `browser.defaultProfile` | string | "chrome" | Text input | 🟢 |
| `browser.profiles` | object | — | Profile manager (multi-browser instance) | 🟢 |

---

## 11. SKILLS MANAGEMENT 🟡

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `skills.entries.<name>` | object | — | Skills table: name, enabled, config | 🟡 |
| `skills.entries.<name>.apiKey` | string / SecretRef | — | Password input per skill | 🟡 |
| `skills.entries.<name>.enabled` | boolean | true | Toggle per skill | 🟡 |

**Workspace skills** are in `workspace/skills/` — need a **skill file browser**.  
**Managed skills** installed via `openclaw skills install` — need an **install/remove GUI**.

---

## 12. PLUGINS 🟢

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `plugins.entries.<name>.enabled` | boolean | — | Toggle per plugin | 🟢 |
| `plugins.entries.<name>.config` | object | — | Plugin-specific config editor | 🟢 |

Bundled plugins include: `feishu`, `acpx`, `voice-call`, `zalo-personal`

---

## 13. MEDIA & AUDIO 🟡

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `tools.media` | object | — | Media understanding config (image/audio/video) | 🟡 |
| `audio` | object | — | Audio processing settings | 🟡 |
| `talk` | object | — | Talk mode (continuous voice conversation) | 🟢 |
| `talk.apiKey` | string | — | Password input (TTS provider key) | 🟢 |

---

## 14. MEMORY & SEARCH 🟡

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `memorySearch.provider` | enum | — | Dropdown: openai / gemini / voyage / local | 🟡 |
| `memorySearch.apiKey` | string | — | Password input | 🟡 |
| `memorySearch` | object | — | Embedding model, index config | 🟢 |

**Memory files** in `workspace/memory/` — need a **memory file browser and editor**.

---

## 15. MESSAGES & UI 🟢

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `messages.groupChat.mentionPatterns` | string[] | — | Tag input | 🟡 |
| `ui` | object | — | UI/dashboard preferences | 🟢 |
| `logging` | object | — | Log level, format, destination | 🟡 |
| `logging.level` | enum | — | Dropdown: debug / info / warn / error | 🟡 |

---

## 16. NETWORKING & DISCOVERY 🟢

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `discovery.mdns.enabled` | boolean | — | Toggle (mDNS/Bonjour) | 🟡 |
| `discovery.mdns.minimal` | boolean | — | Toggle (minimal broadcast mode) | 🟡 |
| `discovery.dnssd` | object | — | Wide-area DNS-SD config | 🟢 |
| `canvasHost` | object | — | Canvas/A2UI hosting config | 🟢 |

---

## 17. SECRETS MANAGEMENT 🔴

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `secrets.providers` | object | — | Secret provider configuration (env/file/exec) | 🔴 |
| SecretRef fields throughout config | object | — | Unified secret reference UI wherever apiKey/token appears | 🔴 |

Any field that accepts a SecretRef needs a toggle: "Paste value" vs. "Reference secret" (env var name, file path, or exec command).

---

## 18. ENVIRONMENT VARIABLES 🟡

| Config Path | Type | Default | UI Element | Priority |
|-------------|------|---------|------------|----------|
| `env` | object | — | Key-value editor for inline env vars | 🟡 |
| `env.vars` | object | — | Additional env vars | 🟡 |
| `env.shellEnv.enabled` | boolean | false | Toggle (import from login shell) | 🟢 |
| `env.shellEnv.timeoutMs` | number | 15000 | Number input | 🟢 |

Also: `~/.openclaw/.env` file — need a **.env file editor**.

---

## 19. CONFIG MANAGEMENT META 🟡

These aren't OpenClaw settings but ClawHQ needs them to manage config lifecycle.

| Capability | Description | Priority |
|-----------|-------------|----------|
| **Config validation** | Run `openclaw doctor` equivalent before saving | 🔴 |
| **Config diff view** | Show what changed before apply | 🔴 |
| **Config backup on change** | Auto-backup before every write | 🔴 |
| **Hot reload indicator** | Show whether a change needs restart or applies live | 🟡 |
| **Config versioning** | Git-backed config history with diff and rollback | 🟡 |
| **$include management** | Visual split/merge for multi-file configs | 🟢 |
| **Config templates** | Pre-built configs for common use cases | 🟡 |
| **Config export/import** | Download/upload complete config as JSON5 | 🟡 |
| **Raw JSON editor** | Escape hatch for power users (with syntax highlighting + validation) | 🔴 |

---

## SUMMARY STATISTICS

| Category | Total Fields | 🔴 Critical | 🟡 Important | 🟢 Nice-to-have |
|----------|-------------|-------------|--------------|----------------|
| Identity & Persona | 12 | 2 | 4 | 6 |
| AI Models | 15 | 4 | 6 | 5 |
| Channels | 30+ per provider | 8 | 10 | 12+ |
| Agents | 25 | 3 | 14 | 8 |
| Tools & Permissions | 35 | 5 | 8 | 22 |
| Sandbox | 25 | 1 | 6 | 18 |
| Sessions | 9 | 1 | 5 | 3 |
| Gateway | 12 | 5 | 4 | 3 |
| Automation | 18 | 0 | 10 | 8 |
| Browser | 3 | 0 | 1 | 2 |
| Skills | 3+ | 0 | 3 | 0 |
| Plugins | 2+ | 0 | 0 | 2+ |
| Media/Audio | 4 | 0 | 2 | 2 |
| Memory | 3 | 0 | 2 | 1 |
| Messages/UI | 3 | 0 | 2 | 1 |
| Networking | 4 | 0 | 2 | 2 |
| Secrets | 2+ | 2 | 0 | 0 |
| Environment | 4 | 0 | 2 | 2 |
| **TOTAL** | **~200+ configurable fields** | **~31** | **~81** | **~97** |

---

## MVP PANEL PRIORITIES (suggested build order)

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
