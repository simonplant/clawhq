---
title: Production discoveries
subject: openclaw
type: finding
status: active
openclaw_version: ">=v2026.4.12"
last_verified: 2026-04-22
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
source_types: [compiled-reference]
see_also:
  - openclaw/finding/key-principles.md
  - clawhq/concept/lifecycle-management-gap.md
  - openclaw/finding/heartbeat-token-sink.md
tags: [production, lessons-learned, clawhq-thesis]
---

# Production discoveries

Eight findings from running OpenClaw as a production agent. Each one
is a rule ClawHQ's tooling enforces because of what happened when it
wasn't enforced.

## The eight discoveries

| Discovery | Implication |
|---|---|
| 40% of config is universal, 60% is personalized | Config generator separates the two |
| 14 config landmines silently break agents | Every landmine becomes a rule — impossible to ship a broken config |
| Identity files corrupt, bloat, and go stale | Identity governance: structured YAML, token budgets, staleness detection |
| Memory accumulates at ~120KB/day | Memory lifecycle: hot/warm/cold tiers, auto-summarization, size caps |
| Credentials expire silently | Credential health: probes, expiry tracking, renewal notifications |
| Security is opt-in, defaults are dangerous | Security hardened by default — every blueprint starts secure |
| Native heartbeat is a token sink | Isolated cron sessions instead of main-session heartbeat |
| Production agents need ongoing SRE | The entire platform exists because this is true |

## Why this matters

Each of these was a surprise — none were predicted from reading the
OpenClaw docs. Each cost time to diagnose, and each recurred in
subsequent deployments until a tool-level fix stopped it at the
source.

The compounding pattern: **an agent that worked perfectly on day one
failed in subtle ways by day 30, and in operational ways by day 90.**
Day-one failures are easy to catch (the thing doesn't start).
Day-30 failures are what the 14 landmines and the memory lifecycle
address. Day-90 failures are the credential, security-drift, and
token-cost problems.

## The ClawHQ thesis

These discoveries are the thesis behind ClawHQ. OpenClaw is a
powerful engine; each of these findings is a place where the engine
alone leaves the operator holding a problem. The control plane exists
to convert every finding in this list into something the tooling
handles by default.

See [[clawhq/concept/lifecycle-management-gap]] for the market
positioning. See [[clawhq/concept/cpanel-analogy]] for the closest
precedent.

## How new findings get added

A finding earns a line in this table when:

1. It was observed in production (not speculation).
2. It recurred across ≥ 2 deployments (not a one-off).
3. It can be prevented or detected by tooling (otherwise it's a
   principle, not a finding).

New findings get their own page under `openclaw/finding/` or
`clawhq/finding/` with the specific evidence, and get summarized in
this table.
