---
title: HEARTBEAT.md
subject: openclaw
type: component
status: active
openclaw_version: ">=v2026.4.12"
last_verified: 2026-04-22
location: "{workspace}/HEARTBEAT.md"
role: "Periodic awareness checklist — what to check between conversations"
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
source_types: [compiled-reference]
see_also:
  - openclaw/finding/heartbeat-token-sink.md
  - openclaw/pattern/rotating-heartbeat.md
  - openclaw/component/agents-md.md
  - openclaw/configuration/openclaw-json-schema.md
tags: [heartbeat, automation, cron, cost]
---

# HEARTBEAT.md

## Purpose

Optional tiny checklist for heartbeat runs — the periodic "is anything
worth doing?" check. The mechanism that makes the agent feel aware
even when you're not actively talking to it.

## What belongs here

- Brief checklist of things to monitor (inbox, calendar, git status,
  system health)
- Keep it extremely short — every heartbeat run consumes tokens

## How it works

OpenClaw reads HEARTBEAT.md on each heartbeat tick (default: every
30 minutes):

- If the file exists but is effectively empty (only blank lines and
  markdown headers), OpenClaw skips the run to save API calls.
- If the file is missing, the heartbeat still runs and the model
  decides what to do.
- The agent returns `HEARTBEAT_OK` if nothing needs attention
  (stripped from delivery); if something is actionable, it returns
  the alert text without `HEARTBEAT_OK`.

## Configuration

```json5
{
  agents: {
    defaults: {
      heartbeat: {
        every: "30m",              // default 30m, 1h for OAuth
        target: "last",            // last | none | <channel id>
        to: "+15551234567",        // optional recipient override
        model: "anthropic/claude-opus-4-5",  // optional model override
        activeHours: {
          start: "08:00", end: "24:00",
          timezone: "America/Los_Angeles",
        },
        includeReasoning: false,   // deliver separate Reasoning: message
        lightContext: true,        // only load HEARTBEAT.md (not full bootstrap)
        isolatedSession: true,     // fresh session, no prior history
        suppressToolErrorWarnings: true,
      },
    },
  },
}
```

## Cost optimization

- `lightContext: true` — limits bootstrap files to just HEARTBEAT.md
  (~2–5K tokens vs. full context).
- `isolatedSession: true` — no prior conversation history (avoids
  sending ~100K tokens per run).
- Combine both for maximum savings.
- Per-agent overrides via `agents.list[].heartbeat`.

## Critical cost warning

**Native heartbeat can become a major token sink.** Heartbeat turns
frequently run with the full main-session context (170k–210k input
tokens per run has been observed).

Best practice: **disable native heartbeat and use isolated cron-driven
heartbeats instead.** These run in their own lightweight session
without dragging the full chat history. See
[[openclaw/finding/heartbeat-token-sink]] and
[[openclaw/pattern/rotating-heartbeat]].

## Rotating heartbeat pattern

Instead of separate cron jobs for each check, use a single
HEARTBEAT.md with a `heartbeat-state.json` tracking file. On each tick:

1. Calculate which check is most overdue (respecting time windows).
2. Run only that check.
3. Update the timestamp.
4. Report only if actionable.

Spreads load, reduces costs, and gives each check a reliable cadence
without firing them all at once. See
[[openclaw/pattern/rotating-heartbeat]].
