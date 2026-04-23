---
title: Native heartbeat is a token sink
category: Metrics
status: active
date: 2026-04-22
tags: [heartbeat, cost, tokens, cron, openclaw, finding]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# Native heartbeat is a token sink

## The finding

OpenClaw's native heartbeat — the periodic "is anything worth doing?"
tick run directly on the main session — sends 170,000 to 210,000 input
tokens per run in typical production deployments. Default cadence is
30 minutes. This compounds into a serious cost problem over days of
continuous operation.

## Why the cost is that high

The native heartbeat runs on the main session, which means:

- Full system prompt assembly: SOUL, AGENTS, USER, TOOLS, HEARTBEAT,
  IDENTITY files plus skills plus tools definitions.
- Full conversation history from the main session.
- MEMORY.md plus today and yesterday's daily logs.
- Any bootstrap-extra-files content injected by hooks.

The heartbeat is conceptually small — "check these things, alert me
if any are actionable" — but it runs in a context configured for
conversational depth, because it shares the main session.

Additionally, heartbeat turns can fire more frequently than the
configured interval. System events and exec completions trigger extra
runs. A "30-minute" heartbeat can run 60+ times a day.

## The recommended pattern

Disable native heartbeat. Use isolated cron jobs for the equivalent
work. Isolated cron runs in a dedicated lightweight session:

- No main-session history.
- Optional `lightContext: true` to skip most bootstrap files.
- Typical cost: a few thousand input tokens, not hundreds of thousands.

```json5
{
  agents: {
    defaults: {
      heartbeat: {
        every: "30m",
        lightContext: true,
        isolatedSession: true,
      },
    },
  },
}
```

`lightContext: true` limits bootstrap files to just `HEARTBEAT.md`
(~2–5K tokens vs. full context). `isolatedSession: true` removes prior
conversation history (avoids ~100K tokens per run). Combining both is
what makes heartbeat affordable at frequent cadences.

Even better: **replace native heartbeat with cron-scheduled isolated
sessions entirely.** Define one or more cron jobs with
`sessionTarget: "isolated"`. You get per-job context control, per-job
model selection, and per-job scheduling — all the flexibility, with
none of the main-session bleed.

See [[rotating-heartbeat]] for a further refinement:
a single heartbeat that rotates through checks based on staleness
rather than firing every check every tick.

## Observable symptoms

- Monthly API cost that scales with uptime rather than with actual
  conversation volume.
- Prompt cache hit rates lower than expected — the main session's
  conversation history changes across heartbeat turns, invalidating
  cache.
- Compaction running more frequently than you'd expect.

## ClawHQ behavior

ClawHQ's default deployment disables native heartbeat and wires up
isolated cron jobs for equivalent awareness. The operator sees no
functional difference, just a substantially smaller token bill.

## See also

- [[heartbeat-md]]
- [[rotating-heartbeat]]
- [[production-discoveries]]
