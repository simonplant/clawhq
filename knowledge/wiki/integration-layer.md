---
title: Integration layer
category: Features
status: active
date: 2026-04-22
tags: [integrations, tools, cli, providers, openclaw, operation]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# Integration layer

## Provider-agnostic categories

Each category abstracts over multiple providers. The agent's tool
interface doesn't change when the provider changes.

| Category | Example providers | Interface |
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

## Workspace tool registry

Each integration installs a self-contained CLI tool into the agent's
workspace with `chmod +x`:

| Integration | Generated tool | Language | Binary deps | Env vars |
|---|---|---|---|---|
| *always* | `tasks` | bash + jq | jq | — |
| email | `email` | bash | himalaya | — |
| calendar | `ical` | bash + python3 | curl | ICAL_USER, ICAL_PASS, ICAL_SERVER |
| tasks (Todoist) | `todoist` | python3 | python3 | TODOIST_API_KEY |
| tasks (Todoist) | `todoist-sync` | bash | curl, jq | TODOIST_API_KEY |
| research | `tavily` | bash | curl, jq | TAVILY_API_KEY |
| markets | `quote` | bash | curl, jq, awk | — |

The `tasks` tool is always present. It includes 12 configurable
channels, 3 autonomy levels (do / do-tell / flag), 4 priority levels,
recon staleness tracking, 4-hour notification cooldown, and atomic
JSON writes.

The `approve-action` platform tool implements autonomy gates for
high-stakes actions — any "send", "delete", or "purchase" operation
routes through this before execution.

## Why tools live in the workspace

Each tool is a script. Script-based tools beat library-based tools in
the OpenClaw context for three reasons:

1. **Agent-inspectable.** The agent can read its own tools if it needs
   to understand their interface; it cannot (easily) read the source
   of a linked library.
2. **Sandbox-friendly.** A script with declared binary dependencies
   works the same inside and outside the sandbox container. Libraries
   require their runtime.
3. **Version-controllable.** Tool scripts live in the workspace and go
   into the same git history as SOUL.md. A tool's behavior changing
   is a commit, not a silent dependency update.

## Environment variables

Each integration declares its required env vars; they land in `.env`
at deployment generation time (mode 0600). See
[[env-missing-required-variables]] for the failure
mode when the two drift apart.

Env var naming convention: `<INTEGRATION>_<FIELD>` in SCREAMING_SNAKE.
Always uppercase. Never inlined in config files.

## Dockerfile composition

Integration selections determine which binaries get installed in
Stage 2 of the two-stage Docker build:

- Always: `curl`, `jq`, `rg`
- Email: `himalaya`
- GitHub: `gh`
- Git from source: `git` (latest release)
- Media: `ffmpeg`
- Transcription (optional, ~2GB): `whisper`

See [[two-stage-docker-build]] for the full build
pipeline.

## Credential health

Integrations with expiring credentials get probed on a schedule. See
[[credential-health-probes]] for the probe set and
the 7-day-advance warning behavior.

## See also

- [[credential-health-probes]]
- [[env-missing-required-variables]]
- [[two-stage-docker-build]]
