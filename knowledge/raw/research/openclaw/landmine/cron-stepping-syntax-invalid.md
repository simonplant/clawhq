---
title: Invalid cron stepping syntax causes jobs to silently never run
subject: openclaw
type: landmine
status: active
severity: medium
affects: "All cron jobs using stepping syntax"
openclaw_version: ">=v2026.4.12"
last_verified: 2026-04-22
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
source_types: [compiled-reference]
see_also:
  - openclaw/configuration/openclaw-json-schema.md
  - openclaw/component/cron-system.md
tags: [cron, scheduling, silent-failure, syntax]
landmine_number: 9
---

# Invalid cron stepping syntax causes jobs to silently never run

## What breaks

Cron expressions using stepping syntax like `5/15` are invalid and are
silently not executed by the scheduler. No error is surfaced at job
creation time or at the expected execution time — the job sits in
`~/.openclaw/cron/jobs.json` and never fires.

## How to detect

Inspect job definitions:

```bash
jq '.[] | {name, expr: .schedule.expr}' ~/.openclaw/cron/jobs.json \
  | grep -E '^\s*"expr":.*[0-9]+/[0-9]+'
```

Any expression matching `N/M` (number-slash-number) without a preceding
range specifier is invalid. Check execution history to confirm:

```bash
ls ~/.openclaw/cron/runs/ | while read f; do
  echo "=== $f ==="; tail -n 5 ~/.openclaw/cron/runs/$f
done
```

Jobs with no runs despite being defined for a while are suspect.

## Root cause

OpenClaw uses the [`croner`](https://github.com/Hexagon/croner) library
for cron parsing, which requires a range specifier before the stepping
operator. `5/15` means "nothing" to croner — it needs `3-58/15` or `*/15`
instead.

Correct examples:

| Intent | Wrong | Right |
|---|---|---|
| Every 15 minutes | `5/15 * * * *` | `*/15 * * * *` |
| Every 15 min starting at :03 | `3/15 * * * *` | `3-58/15 * * * *` |
| Every 6 hours | `0 4/6 * * *` | `0 4-22/6 * * *` |

## Fix or workaround

Validate every cron expression before writing it to `jobs.json`:

```bash
# Quick validator (requires node + croner)
node -e "const c = require('croner'); new c.Cron('5/15 * * * *')"
# Throws for invalid; succeeds silently for valid
```

Also confirm timezone handling — if a cron expression omits a timezone,
the Gateway host's local timezone is used, which can surprise deployments
running in containers with different `TZ` settings than the operator's
workstation.

## Fix or workaround (ClawHQ)

ClawHQ's config generator validates every cron expression at generation
time using a regex that enforces the correct stepping grammar, and
`clawhq doctor` runs the same validation continuously.

## Provenance

Documented in the 14-landmine table of the v2026.4.14 compiled reference.
Listed as LM-09.
