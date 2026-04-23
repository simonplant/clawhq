---
title: Auto-reply router
subject: openclaw
type: component
status: active
openclaw_version: ">=v2026.4.12"
last_verified: 2026-04-22
location: "src/auto-reply/reply.ts"
role: "Channel message dispatch: access control → session resolve → agent dispatch"
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
source_types: [compiled-reference]
see_also:
  - openclaw/component/gateway-process.md
  - openclaw/configuration/openclaw-json-schema.md
  - openclaw/security/threat-model.md
tags: [routing, channels, sessions, dispatch]
---

# Auto-reply router

## Purpose

The router that sits between messaging channel adapters and the agent
runtime. Every inbound message — Telegram, WhatsApp, Discord, Slack,
etc. — passes through it before the model sees anything.

Three stages, in order:

1. **Access control** — does this sender/channel/group combination
   have permission to talk to the agent?
2. **Session resolve** — which session does this message belong to?
   (main, per-peer, per-channel-peer, per-account-channel-peer)
3. **Agent dispatch** — which agent handles this session? (binding
   table lookup, fallback to default agent)

## Access control

Governed by per-channel DM policy (`channels.<name>.dmPolicy`) and
allowFrom/denyFrom lists:

| Policy | Behavior |
|---|---|
| `pairing` | Only paired devices can DM the agent |
| `allowlist` | Only senders in `allowFrom` can DM |
| `open` | Anyone who reaches the channel can DM (dangerous) |
| `disabled` | No DMs accepted on this channel |

Group message handling is controlled by `groupPolicy` and typically
requires `@mention` gating — the agent stays silent unless addressed.

## Session resolution

`session.dmScope` controls how inbound messages get bucketed into
sessions:

| Scope | One session per |
|---|---|
| `main` | Everything collapses into one shared session |
| `per-peer` | Per unique sender |
| `per-channel-peer` | Per (channel, sender) pair |
| `per-account-channel-peer` | Per (account, channel, sender) triple |

Finer scopes prevent cross-contamination. Coarser scopes give the
agent more continuity across interactions.

Session reset mode (`session.reset`) determines when a session is
considered fresh:

- `daily` — reset each calendar day.
- `idle` — reset after N minutes of no activity.
- `manual` — persist indefinitely until cleared via CLI.

## Agent dispatch

After session resolution, the router consults `agents.bindings[]` to
determine which agent handles this session:

```json5
{
  agents: {
    bindings: [
      {
        agentId: "clawdia",
        match: {
          channel: "telegram",
          peer: { kind: "direct", id: "<chat-id>" }
        }
      },
      { agentId: "clawdius", match: { channel: "whatsapp" } },
    ],
  },
}
```

First matching binding wins. If no binding matches, the router falls
back to the default agent (`agents.list[].default: true`).

## Why ClawHQ should not replicate this

The Auto-reply router is load-bearing OpenClaw infrastructure. ClawHQ's
responsibility is to configure it correctly (DM policies, session
scopes, binding tables) — not to intercept or replace it. See the
"What OpenClaw Already Handles" section of the original compiled
reference.

## Security implications

The router is the inbound trust boundary. Every hardening choice
downstream (sandbox mode, tool policy, prompt injection sanitizer)
assumes that messages that reach the model have already passed access
control here. A misconfigured `dmPolicy` (e.g., `open` on a public
channel with no `@mention` gating) undermines every downstream
control.

Default posture: start with `pairing` and narrow `allowFrom` lists,
expand deliberately. See [[openclaw/finding/key-principles]] principle
#4 (least privilege).
