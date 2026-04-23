---
title: Gateway process
category: Features
status: active
date: 2026-04-22
tags: [gateway, architecture, rpc, websocket, openclaw, component]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# Gateway process

## Purpose

The Gateway is OpenClaw's single control-plane process. Everything
connects to it: CLI, Control UI, companion apps, messaging channel
adapters, the agent runtime, cron scheduler, hooks, plugins.

Single Node.js process. One config file (`openclaw.json`).
Filesystem-backed state. No database except SQLite for memory search.

## Responsibilities

The Gateway owns:

- **Config loading** — reads `openclaw.json`, validates against
  TypeBox schema, rewrites on startup (see
  [[golden-config-pattern]]).
- **Session management** — resolves channel → session → agent bindings.
- **Channel adapters** — Telegram, WhatsApp, Discord, Slack, etc.;
  either compiled-in or loaded as plugins.
- **Auto-reply router** — access control, session resolve, agent
  dispatch. See [[auto-reply-router]].
- **Agent runtime hosting** — `PiEmbeddedRunner` runs agents in-process.
- **Cron scheduler** — persisted jobs under `~/.openclaw/cron/`.
- **Hooks and webhooks** — event-driven extensions.
- **WebSocket hub** — serves CLI, Control UI, TUI, companion apps.
- **Plugin loading** — at startup.
- **Skills registry** — indexes skills, applies allow/deny lists.
- **Browser control** — CDP/Chrome for the browser tool.

## Ports and endpoints

- **WebSocket RPC:** `ws://127.0.0.1:18789` — CLI, Control UI, apps.
- **HTTP:** whatever the `gateway.http` config specifies; hosts the
  Control UI static assets and any webhook endpoints.

Binding should be **loopback-only by default**. Exposing the Gateway
on `0.0.0.0` is a security error; remote access goes through
Tailscale, SSH tunnels, or Cloudflare Tunnel — not direct port
exposure.

## Config priority

**Environment Variables > Config File > Default Values.** If a field
is set via env var, the config file value is ignored. If neither,
defaults apply.

## Config rewrite on startup

The Gateway rewrites `openclaw.json` on startup — normalizing
structure, applying defaults, removing unknown keys. This is the
mechanism that causes landmines 2 and 3
([[allowed-origins-stripped]],
[[trusted-proxies-stripped]]).

Fields added after the initial onboard can be stripped if they weren't
emitted by the wizard. The [[golden-config-pattern]]
is the mitigation.

After the startup rewrite, the Gateway enters a main loop with a
**dynamic config watcher** that picks up changes to `openclaw.json`
at runtime without requiring a restart.

## Hot-reload vs. restart-required

Many config changes apply live via the dynamic watcher:

- Channel configuration
- Tool allow/deny lists
- Cron jobs
- Hook mappings
- Skills allow/deny lists

Some require a Gateway restart:

- `gateway.*` changes (port, auth token, HTTP security headers)
- `plugins.*` changes (plugin load paths, initialization)
- `sandbox.*` changes (Docker mode, scope)

When in doubt, restart — the live reload's scope is documented per-field
in the config schema.

## Commands

```bash
openclaw gateway            # start the gateway
openclaw gateway install    # install as launchd/systemd daemon
openclaw gateway restart
openclaw gateway status
```

ClawHQ deployments run the Gateway under Docker rather than using
`gateway install` — the ClawHQ orchestration layer manages lifecycle
via `docker compose`.

## Security boundary

The Gateway is the trust boundary between untrusted input (messages,
webhooks, web content) and the model. Every piece of untrusted content
passes through the Gateway before reaching the agent runtime, which
means hardening the Gateway's input sanitization and output delivery
is where the threat model lives. See
[[threat-model]].

## See also

- [[workspace-as-agent]]
- [[auto-reply-router]]
- [[openclaw-json-schema]]
- [[golden-config-pattern]]
