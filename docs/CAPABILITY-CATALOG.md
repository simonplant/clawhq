# ClawHQ Capability Catalog

> The à la carte menu. Every tool category an OpenClaw agent can use, which providers serve each, what CLIs exist, and what a standardized integration looks like.

**Updated:** 2026-04-03 · **Source:** OpenClaw docs, ClawHub registry (13,700+ skills), awesome-openclaw-skills (5,200+), awesome-openclaw-agents (177 templates), production operation of Clawdius.

---

## How Integrations Work in OpenClaw

An agent's capabilities come from three layers:

1. **Built-in tools** — Typed functions OpenClaw ships natively: `exec`, `read`, `write`, `browser`, `web_search`, `message`, `cron`, `memory_search`, `image`, etc. Always available (subject to tool policy).

2. **Skills** — SKILL.md files injected into the system prompt that teach the agent *when and how* to use tools. Community skills on ClawHub (13,700+), workspace skills, bundled skills.

3. **Workspace CLI tools** — Bash/Python scripts in the workspace that the agent invokes via `exec`. These are the bridge between the agent and external services. Each tool wraps a specific provider's CLI or API.

ClawHQ blueprints generate Layer 3 (workspace CLI tools) and configure Layer 1 (tool policy) and Layer 2 (skill selection). The pattern for each integration category below is: **CLI tool → provider-specific config → credential management → egress domain allowlist → skill to teach the agent how to use it.**

---

## Integration Categories

### 1. Email

The most requested capability. Every "personal assistant" blueprint needs email.

| Provider | Protocol | CLI Tool | Auth Method | Egress Domains | Notes |
|----------|----------|----------|-------------|----------------|-------|
| **Gmail** | IMAP/SMTP | Himalaya | App Password (requires 2FA) | `imap.gmail.com`, `smtp.gmail.com` | Most common. Regular passwords rejected — must use App Passwords. |
| **iCloud Mail** | IMAP/SMTP | Himalaya | App-specific password | `imap.mail.me.com`, `smtp.mail.me.com` | Apple requires app-specific password from appleid.apple.com |
| **Outlook/Microsoft 365** | IMAP/SMTP or Graph API | Himalaya (IMAP) or `gws` skill (Graph) | App Password or OAuth | `outlook.office365.com`, `smtp.office365.com` | Graph API skill exists on ClawHub for richer access |
| **Fastmail** | IMAP/SMTP + JMAP | Himalaya | App Password | `imap.fastmail.com`, `smtp.fastmail.com` | Also supports JMAP for modern API access |
| **ProtonMail** | IMAP via ProtonMail Bridge | Himalaya | Bridge password | `127.0.0.1` (local bridge) | Requires ProtonMail Bridge running locally — adds complexity |
| **Generic IMAP** | IMAP/SMTP | Himalaya | Password/App Password | Provider-specific | Himalaya supports any IMAP/SMTP server via TOML config |

**Primary CLI: [Himalaya](https://github.com/pimalaya/himalaya)** — Rust-based, static musl binary, structured JSON output, supports IMAP/SMTP/Notmuch/Sendmail. Interactive config wizard (`himalaya account config`). This is the de facto standard for OpenClaw email integration.

**ClawHub skills:** `himalaya` (CLI wrapper), Gmail/Email (read/send), Google Workspace `gws` (Gmail + Drive + Calendar + 100 more via single skill), Outlook via Graph API.

**Standard tool template:**
```bash
#!/bin/bash
# email — wrapper for himalaya
# Usage: email inbox | email read <id> | email send <to> <subject> | email search <query>
case "$1" in
  inbox)  himalaya envelope list --output json ;;
  read)   himalaya message read "$2" --output json ;;
  send)   himalaya message send --to "$2" --subject "$3" ;;
  search) himalaya envelope list --output json --filter "$2" ;;
esac
```

---

### 2. Calendar

| Provider | Protocol | CLI Tool | Auth Method | Egress Domains | Notes |
|----------|----------|----------|-------------|----------------|-------|
| **Google Calendar** | CalDAV or Google API | `khal`/`vdirsyncer` (CalDAV) or `gcalcli` (API) | OAuth or App Password | `apidata.googleusercontent.com`, `www.googleapis.com` | `gcalcli` is Google-specific; CalDAV is universal |
| **iCloud Calendar** | CalDAV | `khal`/`vdirsyncer` | App-specific password | `caldav.icloud.com` | Standard CalDAV |
| **Fastmail** | CalDAV | `khal`/`vdirsyncer` | App Password | `caldav.fastmail.com` | Standard CalDAV |
| **Outlook/Exchange** | CalDAV or Graph API | `khal`/`vdirsyncer` or Graph skill | OAuth | `outlook.office365.com` | Graph API provides richer access |
| **Nextcloud** | CalDAV | `khal`/`vdirsyncer` or Nextcloud skill | Password | Self-hosted URL | Nextcloud ClawHub skill also covers tasks, files, contacts |
| **Generic CalDAV** | CalDAV | `khal`/`vdirsyncer` | Password | Provider-specific | Universal — any CalDAV server works |

**Primary CLIs:**
- **khal** — Terminal calendar viewer, reads from vdirsyncer-synced local store
- **vdirsyncer** — CalDAV/CardDAV sync daemon, keeps local copy in sync with server
- **gcalcli** — Google Calendar-specific CLI (not universal)
- **curl + CalDAV** — Direct PROPFIND/REPORT/PUT requests for lightweight integration

**ClawHub skills:** CalDAV Calendar (iCloud, Google, Fastmail, Nextcloud), Google Workspace `gws`, Nextcloud (calendar + tasks + files + contacts in one skill).

---

### 3. Tasks / Todo

| Provider | API | CLI Tool | Auth Method | Egress Domains | Notes |
|----------|-----|----------|-------------|----------------|-------|
| **Todoist** | REST API v2 | `todoist` (Python) | API Token | `api.todoist.com` | Most popular in OpenClaw community. Free tier works. |
| **TickTick** | REST API | Custom script | OAuth | `api.ticktick.com` | Less community support than Todoist |
| **Linear** | GraphQL API | `linear` CLI | API Key | `api.linear.app` | Popular for dev teams. ClawHub skill exists. |
| **Asana** | REST API | Composio MCP or custom | OAuth/PAT | `app.asana.com` | MCP server available via Composio |
| **Apple Reminders** | AppleScript/Shortcuts | ClawHub skill | Local (macOS only) | None (local) | macOS only. ClawHub skill exists. |
| **Notion** | REST API | Custom script | Integration Token | `api.notion.so` | ClawHub skill exists. Databases + pages. |
| **Trello** | REST API | ClawHub skill | API Key + Token | `api.trello.com` | ClawHub skill exists |
| **Google Tasks** | Google API | `gws` skill | OAuth | `www.googleapis.com` | Part of Google Workspace skill bundle |
| **Nextcloud Tasks** | CalDAV (VTODO) | Nextcloud skill | Password | Self-hosted URL | Via the Nextcloud combined skill |
| **GitHub Issues** | GitHub API | `gh` CLI | PAT or OAuth | `api.github.com` | `gh issue list`, `gh issue create` |
| **Jira** | REST API | ClawHub skill | API Token | `*.atlassian.net` | ClawHub skill exists |

**Primary CLIs:** Provider-specific. Todoist has the best community-built Python wrapper for OpenClaw. `gh` for GitHub Issues. Linear has its own CLI. Most others use curl + API wrappers.

**The Composio shortcut:** Composio's MCP Tool Router provides managed OAuth + unified tool calling for 1,000+ apps including Todoist, Asana, Trello, Notion, Jira, etc. — single plugin, handles auth, token refresh, and scoping. Tradeoff: adds a cloud dependency.

---

### 4. Messaging Channels

These are OpenClaw's built-in channel adapters — not external tools. Configured in `openclaw.json` under `channels.*`.

| Channel | Config Key | Auth Setup | Key Constraints |
|---------|-----------|------------|-----------------|
| **Telegram** | `channels.telegram` | BotFather token | Free bot, separate identity. Most common starting channel. |
| **WhatsApp** | `channels.whatsapp` | Phone number + QR pairing | Needs dedicated number (eSIM recommended). Agent runs on YOUR account. |
| **Discord** | `channels.discord` | Application ID + Guild ID + Bot Token | Bot identity. Multi-server support. |
| **Slack** | `channels.slack` | Bot Token + App Token + Signing Secret | Workspace-scoped. |
| **Signal** | `channels.signal` | Phone number registration | Privacy-focused. Requires signal-cli. |
| **iMessage** | `channels.imessage` (BlueBubbles) | BlueBubbles server on Mac | macOS only. Both user and agent text from same surface. |
| **Teams** | Plugin channel | OAuth | Via community plugin |
| **Matrix** | Plugin channel | Access token | Via community plugin |

**Key decision:** Telegram is the lowest-friction starting channel (free bot, separate identity, no phone number needed). WhatsApp is the most natural for personal use but requires a dedicated number.

---

### 5. Research / Web Search

| Provider | API | CLI/Skill | Auth Method | Egress Domains | Notes |
|----------|-----|-----------|-------------|----------------|-------|
| **Tavily** | REST API | `tavily` (bash) | API Key | `api.tavily.com` | Purpose-built for AI agents. Best structured output. |
| **Brave Search** | REST API | ClawHub plugin | API Key | `api.search.brave.com` | Privacy-focused. Plugin exists. |
| **Perplexity** | REST API | Custom | API Key | `api.perplexity.ai` | Good for synthesized answers |
| **Google Search** | Custom Search JSON API | Custom | API Key | `www.googleapis.com` | Requires Custom Search Engine setup |
| **DuckDuckGo** | Instant Answer API | Custom | None | `api.duckduckgo.com` | Limited — no full search results |
| **SearXNG** | REST API | Custom | None (self-hosted) | Self-hosted URL | Self-hosted meta-search. Maximum sovereignty. |
| **OpenClaw built-in** | `web_search` tool | Native | Via model provider | Varies | Built into OpenClaw — uses configured search provider |

**Recommendation:** Tavily for best AI-agent integration. SearXNG for maximum sovereignty (self-hosted, no API key).

---

### 6. Finance / Markets

| Provider | Data Type | CLI/Skill | Auth Method | Egress Domains | Notes |
|----------|-----------|-----------|-------------|----------------|-------|
| **Yahoo Finance** | Quotes, history | `yfinance` (Python) or `quote` (bash) | None | `query1.finance.yahoo.com` | Free, no auth. Limited rate. |
| **Alpha Vantage** | Quotes, fundamentals | Custom | API Key (free tier) | `www.alphavantage.co` | Free tier: 25 req/day |
| **Polygon.io** | Real-time + historical | Custom | API Key | `api.polygon.io` | Paid for real-time. Free delayed. |
| **Interactive Brokers** | Trading + data | IBKR Client Portal API | OAuth | `localhost` (gateway) | Requires IB Gateway running locally |
| **Alpaca** | Trading + data | Alpaca Python SDK | API Key | `api.alpaca.markets` | Commission-free trading API |
| **TradingView** | Charts + analysis | Browser automation | Login | `www.tradingview.com` | Via OpenClaw browser tool — screenshot charts, run analysis |
| **Coinbase** | Crypto | Coinbase SDK | API Key | `api.coinbase.com` | |
| **SEC EDGAR** | Filings | `sec-filing-watcher` skill | None | `efts.sec.gov` | ClawHub skill exists for filing monitoring |

**Simon's pattern:** Yahoo Finance for quotes (free, no auth), TradingView via browser automation for charts/analysis, custom scripts for portfolio tracking.

---

### 7. Notes / Knowledge Base

| Provider | API | CLI/Skill | Auth Method | Egress Domains | Notes |
|----------|-----|-----------|-------------|----------------|-------|
| **Obsidian** | Local filesystem | Direct file access | None (local) | None | Agent reads/writes vault files directly. Most sovereign option. |
| **Notion** | REST API | ClawHub skill | Integration Token | `api.notion.so` | Pages + databases. Good structured data. |
| **Apple Notes** | AppleScript | ClawHub skill | Local (macOS) | None | macOS only |
| **Google Keep** | No public API | Unofficial or via `gws` | OAuth | `www.googleapis.com` | Limited API support |
| **Logseq** | Local filesystem | Direct file access | None (local) | None | Similar to Obsidian — local Markdown files |
| **Nextcloud Notes** | REST API | Nextcloud skill | Password | Self-hosted URL | Part of Nextcloud combined skill |

**Sovereign option:** Obsidian or Logseq — local Markdown files, no API, no egress. Agent reads/writes to the vault directory via workspace mounts.

---

### 8. Code / Development

| Provider | API | CLI Tool | Auth Method | Egress Domains | Notes |
|----------|-----|----------|-------------|----------------|-------|
| **GitHub** | REST/GraphQL | `gh` CLI | PAT or OAuth | `api.github.com` | Issues, PRs, repos, actions. First-class CLI. |
| **GitLab** | REST/GraphQL | `glab` CLI | PAT | `gitlab.com` or self-hosted | Similar to `gh` |
| **Sentry** | REST API | `sentry-cli` | Auth Token | `sentry.io` | Error monitoring |
| **Linear** | GraphQL | `linear` CLI | API Key | `api.linear.app` | Issue tracking for dev teams |
| **Git** | Local | `git` | SSH key or token | Git remote host | Always available via `exec` |
| **CI/CD** | Various | Provider CLI | Varies | Varies | GitHub Actions, GitLab CI, etc. |

**Standard setup:** `gh` CLI + `git` covers 90% of dev workflows. Both are static binaries installable in the Docker build.

---

### 9. Smart Home

| Platform | API | CLI/Skill | Auth Method | Egress Domains | Notes |
|----------|-----|-----------|-------------|----------------|-------|
| **Home Assistant** | REST API | ClawHub skill or HA add-on | Long-lived access token | HA instance URL | Full add-on exists to run OpenClaw inside HAOS |
| **HomeKit** | HomeKit framework | macOS only | Local | None | Requires Mac with HomeKit configured |
| **Google Home** | Limited API | Custom | OAuth | `homegraph.googleapis.com` | Limited third-party API access |
| **Philips Hue** | REST API | Custom | Bridge API key | Bridge local IP | Local network — no egress needed |
| **MQTT** | MQTT protocol | `mosquitto_pub`/`sub` | Varies | Broker address | Universal IoT protocol |

**The Claudette pattern:** Dan Malone's raccoon-persona agent controls Home Assistant, chose its own TTS voice, and has the entire workspace synced to GitHub nightly. The HA REST API + long-lived token is the standard approach.

---

### 10. Health / Fitness

| Provider | API | CLI/Skill | Auth Method | Egress Domains | Notes |
|----------|-----|-----------|-------------|----------------|-------|
| **WHOOP** | REST API | Custom | OAuth | `api.prod.whoop.com` | Recovery, strain, sleep data |
| **Garmin** | Connect API | Custom | OAuth | `connect.garmin.com` | Activity, sleep, body composition |
| **Apple Health** | HealthKit | macOS/iOS Shortcuts | Local | None | Export via Shortcuts or direct HealthKit access |
| **Oura** | REST API | Custom | PAT | `api.ouraring.com` | Sleep, readiness, activity |
| **Strava** | REST API | Custom | OAuth | `www.strava.com` | Activities, routes |
| **Cronometer** | No public API | Browser automation | Login | `cronometer.com` | Nutrition tracking — no API, needs browser |
| **MyFitnessPal** | Limited API | Custom | OAuth | `api.myfitnesspal.com` | Nutrition. API access limited. |

**Practical reality:** Most health APIs require OAuth flows that are painful to automate. WHOOP and Oura have the most agent-friendly APIs (straightforward token auth). Apple Health requires macOS Shortcuts or HealthKit export.

---

### 11. Weather / Location

| Provider | API | CLI/Skill | Auth Method | Egress Domains | Notes |
|----------|-----|-----------|-------------|----------------|-------|
| **OpenWeatherMap** | REST API | Custom | API Key (free tier) | `api.openweathermap.org` | Free tier: 1,000 calls/day |
| **Weather.gov** | REST API | Custom | None | `api.weather.gov` | US only. No auth needed. |
| **Open-Meteo** | REST API | Custom | None | `api.open-meteo.com` | Free, no auth, global coverage |
| **AccuWeather** | REST API | Custom | API Key | `dataservice.accuweather.com` | Free tier limited |

**ClawHub:** Weather skill exists. Open-Meteo is the most sovereign option (free, no auth, no API key).

---

### 12. Files / Cloud Storage

| Provider | API | CLI Tool | Auth Method | Egress Domains | Notes |
|----------|-----|----------|-------------|----------------|-------|
| **Google Drive** | Google API | `rclone` or `gws` skill | OAuth | `www.googleapis.com` | Via Google Workspace skill or rclone |
| **Dropbox** | REST API | `rclone` | OAuth | `api.dropboxapi.com` | |
| **iCloud Drive** | No public API | macOS filesystem | Local | None | Accessible as local files on macOS |
| **OneDrive** | Graph API | `rclone` | OAuth | `graph.microsoft.com` | |
| **Nextcloud** | WebDAV | Nextcloud skill or `rclone` | Password | Self-hosted URL | |
| **Local filesystem** | — | Native `read`/`write` tools | None | None | Always available. Most sovereign. |

**Primary CLI:** `rclone` — universal cloud storage CLI supporting 40+ providers with a single binary. Handles sync, mount, and file operations.

---

### 13. Voice / Speech

| Provider | Capability | CLI/Skill | Auth Method | Egress Domains | Notes |
|----------|-----------|-----------|-------------|----------------|-------|
| **OpenAI Whisper** | STT (Speech-to-Text) | OpenClaw native | OpenAI API key | `api.openai.com` | Built into OpenClaw for voice messages |
| **ElevenLabs** | TTS (Text-to-Speech) | ClawHub skill | API Key | `api.elevenlabs.io` | High-quality voice synthesis |
| **Whisper.cpp** | STT (local) | `whisper-cpp` | None (local) | None | Local speech recognition, no cloud |
| **Piper** | TTS (local) | `piper` | None (local) | None | Local TTS, no cloud |
| **macOS `say`** | TTS (local) | `say` command | None (local) | None | macOS only. Claudette uses "Laura" voice. |

**Sovereign option:** Whisper.cpp for local STT + Piper for local TTS. No cloud dependency.

---

### 14. CRM / Business

| Provider | API | CLI/Skill | Auth Method | Egress Domains | Notes |
|----------|-----|-----------|-------------|----------------|-------|
| **Salesforce** | REST API | Composio MCP | OAuth | `*.salesforce.com` | |
| **HubSpot** | REST API | ClawHub skill or Composio | API Key | `api.hubapi.com` | |
| **Pipedrive** | REST API | Custom | API Key | `api.pipedrive.com` | |
| **Airtable** | REST API | ClawHub skill | PAT | `api.airtable.com` | Flexible structured data |
| **Google Sheets** | Google API | `gws` skill | OAuth | `sheets.googleapis.com` | Many people use Sheets as a lightweight CRM |

---

### 15. Media / Image / Video

| Provider | Capability | CLI/Skill | Auth Method | Egress Domains | Notes |
|----------|-----------|-----------|-------------|----------------|-------|
| **OpenAI (DALL-E/GPT Image)** | Image generation | OpenClaw native `image_generate` | API Key | `api.openai.com` | Built-in |
| **fal.ai** | Image generation | OpenClaw native | API Key | `api.fal.ai` | Built-in alternative provider |
| **FFmpeg** | Audio/video processing | `ffmpeg` | None (local) | None | Standard media tool |
| **Sora** | Video generation | Custom | OpenAI API | `api.openai.com` | Community examples exist (watermark removal, UGC generation) |
| **ComfyUI** | Image generation (local) | Custom | None (local) | None | Local Stable Diffusion. "Creative designer" skill exists. |
| **ImageMagick** | Image manipulation | `convert`/`magick` | None (local) | None | Standard image tool |

---

## The Standard Integration Template

Every integration in a ClawHQ blueprint follows the same pattern:

```
1. PROVIDER SELECTION
   User picks provider (e.g., Gmail vs Fastmail vs generic IMAP)

2. CREDENTIAL COLLECTION
   Provider-specific auth (App Password, API Key, OAuth token)
   Stored in credentials.json (mode 0600), never in config

3. EGRESS ALLOWLIST
   Provider-specific domains added to security_posture.egress_domains
   E.g., ["imap.gmail.com", "smtp.gmail.com"]

4. WORKSPACE TOOL GENERATION
   Bash/Python wrapper script generated for the provider's CLI
   Installed to workspace with chmod +x
   Structured JSON output for agent consumption

5. SKILL CONFIGURATION
   SKILL.md teaches the agent when/how to use the tool
   Schedule, boundaries, approval gates configured per blueprint

6. CREDENTIAL HEALTH PROBE
   Provider-specific connectivity test (IMAP auth, API validation, etc.)
   10-second timeout, specific remediation on failure
   Run on schedule + on demand via `clawhq creds`

7. DOCTOR CHECK
   Verify tool is installed, credential is valid, egress domain is allowed
```

This template is what makes multi-provider support tractable. When adding "Fastmail email" vs "Gmail email," steps 2-3 change (different domains, different auth), but the tool wrapper (step 4) is identical because both use Himalaya/IMAP. The skill (step 5) is also identical — the agent doesn't care which email provider backs the `email` tool.

---

## Coverage Matrix

How many providers does ClawHQ currently support vs. what exists in the ecosystem:

| Category | ClawHQ Built | Ecosystem Available | Priority Additions |
|----------|-------------|--------------------|--------------------|
| Email | Gmail (via Himalaya) | 6+ IMAP providers | Fastmail, iCloud, generic IMAP templates |
| Calendar | iCloud CalDAV | CalDAV universal, Google API, Nextcloud | Google Calendar, Fastmail, generic CalDAV |
| Tasks | Todoist | 10+ providers | Linear, Apple Reminders, Notion, GitHub Issues |
| Messaging | Telegram, WhatsApp, Discord, Slack, Signal | 8+ channels | iMessage (BlueBubbles), Teams, Matrix |
| Research | Tavily | 6+ search providers | Brave Search, SearXNG (self-hosted) |
| Finance | Yahoo Finance | 7+ data providers | Alpha Vantage, Polygon (real-time), Alpaca (trading) |
| Notes | — | 6+ providers | Obsidian (local), Notion, Nextcloud Notes |
| Code/Dev | GitHub (`gh`) | 5+ platforms | GitLab, Linear, Sentry |
| Smart Home | — | 5+ platforms | Home Assistant (REST API) |
| Health | — | 6+ providers | WHOOP, Oura, Garmin |
| Weather | — | 4+ providers | Open-Meteo (free, no auth) |
| Files | — | 5+ providers | rclone (universal), local filesystem |
| Voice | Whisper (via OpenAI) | 4+ engines | ElevenLabs, Whisper.cpp (local), Piper (local) |
| CRM | — | 5+ providers | HubSpot, Airtable |
| Media | — | 5+ tools | FFmpeg (always), ComfyUI (local), DALL-E (via OpenClaw) |

---

## Design Principles for the Tool Layer

**1. Himalaya is the email standard.** It handles any IMAP/SMTP server with a single binary. Don't build provider-specific email tools — build provider-specific Himalaya configs.

**2. CalDAV is the calendar standard.** Use `khal`/`vdirsyncer` or direct CalDAV requests. Don't build provider-specific calendar tools — build provider-specific CalDAV configs.

**3. Structured JSON output everywhere.** Every tool wrapper outputs JSON. The agent parses JSON reliably. It parses human-readable text unreliably. This is non-negotiable.

**4. Provider selection is a credential and egress problem, not a tool problem.** Gmail vs Fastmail vs iCloud is a matter of which IMAP server + which app password + which egress domains. The `email` tool wrapper is identical for all three.

**5. Sovereign options first.** For every category, prefer the option that runs locally with no cloud dependency. Obsidian over Notion. SearXNG over Tavily. Whisper.cpp over OpenAI Whisper. Open-Meteo over AccuWeather. Offer cloud options for better quality, but local should always be default.

**6. Composio for the long tail.** For providers with complex OAuth flows (Salesforce, HubSpot, Asana, etc.), the Composio MCP plugin handles auth management across 1,000+ apps. Tradeoff: adds a cloud dependency. Worth it for integrations used infrequently where building a custom tool wrapper isn't justified.

**7. One binary, one tool.** Each category has one primary CLI tool. Email = Himalaya. Calendar = khal/vdirsyncer. GitHub = gh. Files = rclone. Don't offer multiple CLIs for the same category — pick the best one and standardize on it.
