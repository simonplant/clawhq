---
title: Blueprint system
subject: clawhq
type: architecture
status: active
last_verified: 2026-04-22
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
source_types: [compiled-reference]
see_also:
  - clawhq/concept/lifecycle-management-gap.md
  - openclaw/operation/two-stage-docker-build.md
  - openclaw/operation/integration-layer.md
tags: [clawhq, blueprint, deployment, starters]
---

# Blueprint system

## Purpose

A blueprint is a complete, opinionated deployment recipe for an
OpenClaw agent. The init wizard combines a blueprint with
user-specific customization answers to produce a deployment bundle
ready for `docker compose up`.

Blueprints are ClawHQ's answer to "how do you give a non-expert
operator a hardened, coherent, working agent on day one?" Rather than
presenting every configuration knob, the operator picks a blueprint
(Guardian, Assistant, Coach, Analyst, Companion) and answers a small
number of customization questions.

## Built-in blueprints

| Blueprint | Relationship | Operational profile |
|---|---|---|
| **Guardian** | Steward, protector | High autonomy, aggressive monitoring, hardened security, pushes back |
| **Assistant** | Professional aide | Medium autonomy, balanced monitoring, handles routine, flags exceptions |
| **Coach** | Accountability partner | Frequent check-ins, goal tracking, encouraging but firm |
| **Analyst** | Research partner | Low proactivity, deep on demand, minimal interruption |
| **Companion** | Conversational partner | Long memory retention, emotional context, warm check-ins |
| **Custom** | User-defined | Guided builder or raw YAML |

Each built-in blueprint is a coherent package: SOUL.md tone,
AGENTS.md rules, HEARTBEAT.md phases, integration defaults, heartbeat
cadence, autonomy level, and security posture all agree with each
other.

## Blueprint anatomy

A blueprint is a YAML document plus a directory of templates:

```yaml
id: guardian
name: Guardian
relationship: steward
autonomy: high
posture: hardened

personality:
  tone: direct
  values: [reliability, sovereignty, transparency]
  boundaries: [no-autonomous-bulk-ops, always-explain-reasoning]

integrations:
  - name: email
    category: email
    required: true
    description: "Email triage and response"
  - name: ical
    category: calendar
    required: true
    description: "Calendar awareness via CalDAV"
  - name: todoist
    category: tasks
    required: false
    description: "Task extraction and tracking via Todoist API"

skillsIncluded:
  - morning-brief
  - construct

heartbeat:
  cadence: 30m
  phases: [inbox, calendar, git, markets]
  lightContext: true
  isolatedSession: true

cron:
  - name: Morning Brief
    at: "0 8 * * *"
    sessionTarget: isolated

toolbelt:
  always: [read, write, memory_search, memory_get]
  integrations: [email, ical, todoist, gh]
  restricted: [exec, browser, web_fetch]   # require elevated session
```

## Config generator output

The `clawhq init` wizard produces a complete deployment bundle from
a blueprint:

| Generated file | Contents | Landmines auto-handled |
|---|---|---|
| `openclaw.json` | Runtime config | 1–5, 14 |
| `.env` | Secrets (mode 0600) | 11 (format validation) |
| `docker-compose.yml` | Container orchestration | 6, 7, 10, 12 |
| `Dockerfile` | Custom layer | Composed from integrations |
| `workspace/SOUL.md` | Agent mission, principles | 8 (token budget) |
| `workspace/USER.md` | User context placeholder | 8 |
| `workspace/IDENTITY.md` | Name, personality summary | — |
| `workspace/AGENTS.md` | Tool inventory, autonomy model | — |
| `workspace/HEARTBEAT.md` | Recon phases from integrations | 9 (cron syntax) |
| `workspace/TOOLS.md` | Tool inventory | Cross-referenced vs. installed |
| `workspace/MEMORY.md` | Long-term memory skeleton | Pre-structured |
| `workspace/<tool>` | CLI tools (email, ical, todoist, tavily, quote) | Per integration, chmod +x |
| `workspace/skills/` | Skill templates | From blueprint's `skillsIncluded` |
| `cron/jobs.json` | Scheduled job definitions | 9 (stepping syntax, timezone) |

Each generated file is the enforcement point for one or more
landmines — the generator makes it impossible to emit a broken
configuration, and the validator continuously rejects drift.

## Evolution engine

Starters are the entry point; the evolution engine is what happens
after. As the operator uses the agent, the evolution engine:

- Learns which integrations the agent actually uses (via audit logs).
- Suggests adjustments to the heartbeat cadence based on observed
  awareness patterns.
- Surfaces memory growth patterns and recommends curation.
- Flags drift from the blueprint's declared posture.

This is the "Starters + Evolution Engine" model — opinionated starting
points, then guided evolution, rather than composable templates the
operator has to assemble themselves.

## Custom blueprints

The Custom blueprint path exists for operators who need something the
built-ins don't cover. Two modes:

1. **Guided builder** — wizard walks through the same questions the
   built-ins answer, producing a bespoke blueprint.
2. **Raw YAML** — the operator writes the blueprint YAML directly.

Guided is the default; raw is the escape hatch for power users who
already know exactly what they want.

## Relationship to OpenClaw

Blueprints compose OpenClaw's configuration surface — they do not
replace or fork it. The output of a blueprint is a standard
`openclaw.json` plus standard workspace files. An operator can
migrate off ClawHQ at any time by taking the generated bundle and
running OpenClaw directly.

This is the cPanel property from [[clawhq/concept/cpanel-analogy]]: the
control panel must not trap you. Blueprints generate; they do not
encapsulate.
