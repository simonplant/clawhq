---
title: openclaw.json schema
category: Features
status: active
date: 2026-05-14
openclaw_version: "v2026.5.7"
tags: [config, schema, reference, openclaw, configuration]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
  - raw/openclaw-discovery-2026-05-14.md
---

# openclaw.json schema

Central configuration. JSON5 (comments and trailing commas allowed).
Hot-reloaded by the Gateway via a dynamic config watcher.

## Top-level sections

Table verified against running engine v2026.5.7 (see [discovery 2026-05-14](../raw/openclaw-discovery-2026-05-14.md)).
Sections without an explicit version annotation date back to v2026.4.12 and remain
in the running schema.

| Section | Purpose | Landmines |
|---|---|---|
| `agents.*` | Workspace paths, model routing, per-agent overrides | — |
| `auth.*` | Auth profiles per provider, failover order | — |
| `channels.*` | Telegram, WhatsApp, Discord, Slack, Signal, iMessage, etc. | — |
| `tools.*` | Allow/deny, profiles, groups, exec config | 4, 5, 14 |
| `session.*` | DM scope, thread bindings, reset mode | — |
| `skills.*` | Global allowList/denyList, per-skill env and config | — |
| `plugins.*` | Plugin entries, load paths, per-plugin config | — |
| `cron.*` | Cron runner config, run log pruning | 9 |
| `hooks.*` | Webhook routing, internal hooks, Gmail Pub/Sub | — |
| `gateway.*` | Port, auth token, HTTP security headers, controlUi | 1, 2, 3 |
| `browser.*` | CDP settings, Chromium profile | — |
| `logging.*` | Level, file path, console style, redaction | — |
| `env.*` | Environment variables, shell env passthrough | 11 |
| `secrets.*` | Secret provider backends (env/file/exec) | — |
| `discovery.*` | mDNS/Bonjour service discovery | — |
| `diagnostics.*` | OpenTelemetry export, debug flags, cache trace | — |
| `update.*` | Update channel (stable/beta/dev), auto-update | — |
| `ui.*` | UI accent color, assistant name/avatar | — |
| `meta.*` | Config metadata (lastTouched version/timestamp) | — |
| `models.*` | Provider-backed model configuration | — |

### Added in v2026.5.7

These top-level sections appeared between v2026.4.12 and v2026.5.7. Each
needs its own ingest pass — descriptions below are placeholders inferred
from CLI subcommand names and the schema dump
(see [discovery 2026-05-14](../raw/openclaw-discovery-2026-05-14.md)).

| Section | Inferred purpose | Status |
|---|---|---|
| `accessGroups.*` | Group-based access control | needs ingest |
| `acp.*` | Agent Control Protocol config | needs ingest |
| `approvals.*` | Exec approvals (gateway / node host) | needs ingest |
| `audio.*` | Audio I/O config (TTS/STT?) | needs ingest |
| `bindings[]` | Array — likely keybindings or channel→agent bindings | needs ingest |
| `broadcast.*` | Multi-channel broadcast routing | needs ingest |
| `canvasHost.*` | Canvas surface host config | needs ingest |
| `cli.*` | CLI behavior overrides | needs ingest |
| `commands.*` | Command registry / aliases | needs ingest |
| `commitments.*` | Inferred follow-up commitments tracking | needs ingest |
| `crestodian.*` | Unknown — investigate | needs ingest |
| `mcp.*` | OpenClaw MCP server / bridge config | needs ingest |
| `media.*` | Media handling (was part of `messages.*`?) | needs ingest |
| `memory.*` | Memory subsystem (supersedes `memorySearch.*`) | needs ingest |
| `messages.*` | Message routing / formatting | needs ingest |
| `nodeHost.*` | Headless node host service config | needs ingest |
| `proxy.*` | OpenClaw debug proxy config | needs ingest |
| `surfaces.*` | UI surface registry (terminal / browser / canvas) | needs ingest |
| `talk.*` | Talk/voice subsystem | needs ingest |
| `web.*` | Web surface config | needs ingest |
| `wizard.*` | Onboarding wizard state | needs ingest |

### Superseded between v2026.4.12 and v2026.5.7

- **`identity.*`** — **Superseded:** removed from top level in v2026.5.7.
  Display name / theme / emoji / avatar fields likely moved under
  `agents.*` or `ui.*`. Confirm via `openclaw config schema | jq` before
  removing references from blueprint compilers. (see [discovery 2026-05-14](../raw/openclaw-discovery-2026-05-14.md))
- **`memorySearch.*`** — **Superseded:** renamed to `memory.*` in v2026.5.7
  (high confidence — only candidate top-level key in the new schema).
  Provider, model, extraPaths, fallback, scoring fields likely live under
  `memory.*` now. (see [discovery 2026-05-14](../raw/openclaw-discovery-2026-05-14.md))
- **`compaction.*`** — **Superseded:** removed from top level in v2026.5.7.
  `reserveTokensFloor`, `memoryFlush` likely folded into `session.*` or
  `memory.*`. (see [discovery 2026-05-14](../raw/openclaw-discovery-2026-05-14.md))
- **`contextPruning.*`** — **Superseded:** removed from top level in v2026.5.7.
  `mode`, `ttl`, `keepLastAssistants` likely folded into `session.*` or
  `memory.*`. (see [discovery 2026-05-14](../raw/openclaw-discovery-2026-05-14.md))
- **`sandbox.*`** — **Superseded:** removed from top level in v2026.5.7
  despite the `openclaw sandbox` CLI subcommand still existing. Config
  may have moved under `agents.*` or `tools.*`. Verify before relying on
  `sandbox.image` / `sandbox.network` keys. (see [discovery 2026-05-14](../raw/openclaw-discovery-2026-05-14.md))

Full schema lives in `src/config/schema.ts` (TypeBox). **Unknown keys
cause the Gateway to refuse to start** — which means blueprints emitting
the superseded keys above will fail validation on v2026.5.7.

## Configuration priority

**Environment Variables > Config File > Default Values.**

If a field is set via env var, the config file value is ignored. If
neither, defaults apply. Env var names follow the
`OPENCLAW_<SECTION>_<FIELD>` convention.

## Field counts by category

| Category | Total | Critical | Important | Nice-to-have |
|---|---|---|---|---|
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
| **Total** | **~200+** | **~31** | **~81** | **~97** |

The distribution matters: of the ~200+ fields, only ~31 are critical
to get right. The 14 landmines all land in that critical subset.

## Runtime mapping

Where each config section is actually consumed:

| Section | Consumer | Timing |
|---|---|---|
| `identity.*` | `src/agents/prompt-builder.ts` | Per agent turn |
| `agents.*` | `src/agents/piembeddedrunner.ts` | Gateway startup |
| `models.*` | Model provider modules | Gateway startup |
| `channels.*` | Channel adapter startup | Channel connects on boot |
| `tools.*` | Tool policy engine | Per tool call |
| `sandbox.*` | `src/agents/sandbox.ts` | Docker exec per sandbox session |
| `session.*` | `src/config/sessions.ts` | Session resolution per message |
| `gateway.*` | `src/gateway/server.ts` | Applied at startup (restart required) |
| `cron.*` | Cron scheduler | Jobs loaded at startup |
| `hooks.*` | Webhook handler | Applied at startup |
| `browser.*` | Browser controller | Applied when browser tool invoked |
| `skills.*` | Skills loader | Skills registered at startup |
| `plugins.*` | `src/plugins/loader.ts` | Plugins loaded at startup |
| `memorySearch.*` | `src/memory/` | Queried during prompt build |
| `discovery.*` | mDNS/Bonjour module | Applied at startup |
| `secrets.*` | SecretRef resolver | At config load time |

## Hot-reload vs. restart-required

Live-reload:

- Channels
- Tool allow/deny
- Cron jobs
- Hook mappings
- Skills allow/deny

Restart-required:

- `gateway.*`
- `plugins.*`
- `sandbox.*`

When in doubt, restart. The cost is low; the cost of assuming live
reload when the change requires a restart is an agent running an old
config with no obvious signal.

## Golden config pattern

The Gateway rewrites `openclaw.json` on startup, which can strip fields
the onboarding wizard didn't originally emit. Critical fields can be
lost on restart: `allowedOrigins`, `trustedProxies`,
`dangerouslyDisableDeviceAuth`. The
[[golden-config-pattern]] is the mitigation.

## See also

- [discovery 2026-05-14](../raw/openclaw-discovery-2026-05-14.md) — first /openclaw-sync run; full version/schema delta
- [[gateway-process]]
- [[golden-config-pattern]]
- [[allowed-origins-stripped]]
- [[trusted-proxies-stripped]]
- [[cron-stepping-syntax-invalid]] — `cron.jobs[].schedule.expr` landmine; schema-level validation needed
