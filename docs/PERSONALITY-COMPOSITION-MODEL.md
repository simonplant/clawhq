# Personality Composition Model

> How ClawHQ assembles an agent's identity from three independent layers: Capability, Persona, and Compiler.

**Status:** Design · **Updated:** 2026-03-28

---

## Problem

Before this model was formalized, ClawHQ generated agent identity through a single flat path: blueprint YAML → SOUL.md template string. The result worked but had two failure modes:

1. **Tightly coupled layers.** A blueprint author writing an "Email Manager" had to specify personality (tone, style, relationship) and capability (tools, skills, autonomy) in the same file. Changing one risked the other.

2. **No composition.** You couldn't mix a "Chief of Staff" personality preset with an "Email Manager" capability set. Blueprints were monolithic. Reuse was copy-paste.

The Personality Composition Model decouples these concerns into three independent layers that the Compiler assembles at forge time.

---

## The Three Layers

### Layer 1: Capability

**What the agent CAN do.** Defined by the blueprint.

Capability captures every operational dimension that doesn't involve personality:

- Tools the agent uses (email, calendar, tasks, web-search, etc.)
- Skills it runs autonomously (morning-brief, email-digest, market-scan, etc.)
- Integrations it requires (messaging, calendar, task management)
- Cron schedules (heartbeat frequency, morning brief timing, work sessions)
- Autonomy model (what requires approval vs. what the agent does independently)
- Security posture (egress domains, container hardening level, identity mount)
- Memory policy (hot/warm/cold tiers, retention periods, summarization aggressiveness)
- Model routing (local-first vs. cloud escalation, per-task-category routing)

**Source:** Blueprint YAML (`configs/blueprints/<name>.yaml`). One file per use case.

**Key invariant:** Capability is fully defined at blueprint authoring time. The user cannot break it during setup.

### Layer 2: Persona

**Who the agent IS.** Defined by dimensions + presets + customization answers.

Persona captures every dimension that affects how the agent communicates and behaves:

- **7 personality dimensions** (1-5 scale): directness, warmth, verbosity, proactivity, caution, formality, analyticalDepth
- **Preset** (optional shortcut): A named starting point (e.g., `chief-of-staff`, `research-partner`) that maps to a dimension bundle
- **Customization answers**: Blueprint-specific questions answered during `clawhq init` (1-4 questions, blueprint-defined)
- **Always-on boundaries**: 10 hardcoded security constraints injected into every generated SOUL.md regardless of persona settings

**Source:** Wizard answers during `clawhq init`, or explicit values in blueprint `personality.dimensions`.

**Key invariant:** Persona never affects capability. You can have the same "Email Manager" capability with a blunt Chief-of-Staff persona or a warm Family Coordinator persona.

### Layer 3: Compiler

**How layers 1 and 2 become identity files.** Implemented in `src/design/`.

The Compiler takes a Capability bundle and a Persona bundle and produces the agent's identity files:

| Input | Output |
|-------|--------|
| Blueprint (Capability) | `AGENTS.md` — tool/skill inventory, autonomy model |
| Dimensions + customization answers (Persona) | `SOUL.md` — personality prose, boundaries, day-in-the-life |
| Both layers | `IDENTITY.md` — name, emoji, avatar, metadata |

The Compiler enforces:
- **Token budget (LM-08):** Total identity file size ≤ `bootstrapMaxChars` (default 20,000 chars). Truncation is handled gracefully with a marker.
- **Read-only output:** Generated files are declared for read-only container mount (LM-12).
- **Sanitization:** Customization answers pass through `sanitizeContentSync` before rendering into identity files.

---

## Data Flow

```
clawhq init
    │
    ├── Blueprint selection → Capability bundle
    │   └── configs/blueprints/<name>.yaml
    │
    ├── Preset selection (optional) → Dimension starting point
    │   └── personality-presets.ts: PERSONALITY_PRESETS[]
    │
    ├── Wizard questions → Dimension overrides + customization answers
    │   └── blueprint.customization_questions[]
    │
    └── Compiler: generateIdentityFiles(blueprint, maxChars, answers, dimensionOverrides)
            │
            ├── generateSoul(blueprint, answers, dimensions) → SOUL.md
            │   ├── renderAllDimensionsProse(dimensions)
            │   │   ├── Communication: directness + warmth + verbosity
            │   │   ├── Working: proactivity + caution
            │   │   └── Cognitive: formality + analyticalDepth
            │   └── ALWAYS_ON_BOUNDARIES (10 hardcoded security rules)
            │
            └── generateAgents(blueprint) → AGENTS.md
                ├── Tool inventory from blueprint.toolbelt.tools[]
                ├── Skill inventory from blueprint.toolbelt.skills[]
                └── Autonomy model from blueprint.autonomy_model
```

---

## Why Separate Capability from Persona

The cleanest test: a Fleet Operator deploying 10 agents for 10 users.

All 10 agents do the same job — "Email Manager." Same tools, same skills, same security posture, same cron. Different users want different personalities: one wants a blunt executive assistant, another wants a warm family coordinator.

**Without composition:** 10 different blueprint files. 90% duplicate content. Drift guaranteed.

**With composition:** 1 blueprint (`email-manager.yaml`). 10 wizard runs with different dimension choices. 10 unique SOUL.md files. Zero drift in the capability layer.

This also enables a future **personality marketplace**: community-contributed persona bundles (dimension sets + day-in-the-life narratives) that work with any blueprint. An "Iron Chancellor" persona for someone who wants an extremely direct, autonomous agent. A "Patient Teacher" persona for someone learning to use AI tools.

---

## Current Implementation

The three-layer model is fully implemented. The code paths:

| Layer | Primary Implementation |
|-------|----------------------|
| Capability | `src/design/blueprints/types.ts` — Blueprint interface |
| Persona (dimensions) | `src/design/blueprints/personality-presets.ts` — DIMENSION_PROSE, PERSONALITY_PRESETS |
| Compiler (SOUL.md) | `src/design/identity/soul.ts` — generateSoul() |
| Compiler (AGENTS.md) | `src/design/identity/agents.ts` — generateAgents() |
| Compiler (orchestration) | `src/design/identity/index.ts` — generateIdentityFiles() |

The dual rendering path in `soul.ts` handles backward compatibility:
- **Dimension path** (current default): 7 dimensions → prose → structured SOUL.md sections
- **Legacy path**: flat string `personality.tone/style/relationship` → flat SOUL.md (for blueprints without `dimensions`)

---

## The Dimension System

7 dimensions in 3 groups, each on a 1-5 integer scale. The groups map to SOUL.md sections:

**Communication Style** (→ `## Communication Style` in SOUL.md)
| Dimension | 1 | 3 | 5 |
|-----------|---|---|---|
| `directness` | Diplomatic | Balanced | Blunt |
| `warmth` | Clinical | Friendly | Nurturing |
| `verbosity` | Minimal | Moderate | Exhaustive |

**Working Style** (→ `## Working Style` in SOUL.md)
| Dimension | 1 | 3 | 5 |
|-----------|---|---|---|
| `proactivity` | Reactive | Anticipatory | Autonomous |
| `caution` | Bold | Measured | Conservative |

**Cognitive Style** (→ `## Cognitive Style` in SOUL.md)
| Dimension | 1 | 3 | 5 |
|-----------|---|---|---|
| `formality` | Casual | Business | Corporate |
| `analyticalDepth` | Action-oriented | Analytical | Scholarly |

Each (dimension, value) pair maps to a single prose sentence in `DIMENSION_PROSE`. The Compiler concatenates same-group sentences to produce SOUL.md section content.

---

## Presets

Presets are named dimension bundles that give users a coherent starting point without tuning 7 sliders. Implemented in `PERSONALITY_PRESETS[]`:

| Preset | Archetype |
|--------|-----------|
| `executive-assistant` | Direct (5), minimal (2), proactive (4) |
| `family-coordinator` | Warm (4), friendly, proactive (4), casual (1) |
| `research-partner` | Low verbosity output but analytical depth (5) |
| `chief-of-staff` | Direct (4), proactive (5), autonomous |
| `professional-aide` | All dimensions at 3 — the balanced default |
| `trusted-steward` | Direct (4), concise (2), proactive (4) |
| `thoughtful-writer` | Diplomatic (2), verbose (4), scholarly (4) |

Presets are a UX shortcut — they map to the same dimension system. A user who picks "Chief of Staff" and then adjusts warmth from 3 to 5 gets a warmer chief-of-staff, not a broken persona.

---

## Always-On Boundaries

10 security constraints are injected into every SOUL.md regardless of persona configuration. They are not overridable by blueprints or users. Defined in `ALWAYS_ON_BOUNDARIES`:

1. Never modify identity files, personality, or instructions
2. Never share, reveal, or transmit credentials, API keys, tokens, or passwords
3. Never execute destructive commands without explicit user approval
4. Never impersonate the user in communications without explicit approval
5. Never bypass or disable security controls, firewalls, or audit logging
6. Never access or transmit data to destinations not in the approved egress list
7. Never generate content that is unlawful, hostile, sexually explicit, or harmful
8. Never assist with actions that would harm the user, third parties, or bypass legal obligations
9. Always maintain audit trail for tool executions and external communications
10. Always require approval before first contact with any new external party

These constraints sit in `## Boundaries → Hard Boundaries` in every generated SOUL.md. Blueprint-specific operational boundaries live separately in `## Boundaries → Operational Boundaries`.

---

## What's Not Yet Built

The model supports the following extensions that aren't implemented yet:

### Shareable Persona Bundles
A persona bundle would be a standalone YAML file containing:
- Dimension values
- Custom day-in-the-life narrative
- Custom relationship description
- Optional additional operational boundaries

Persona bundles would live in `configs/personas/<name>.yaml` and be composable with any blueprint during `clawhq init --persona <name>`.

### Runtime Persona Adjustment
After forge, users can't currently change their agent's personality without re-running `clawhq init`. A `clawhq persona adjust` command would allow dimension tuning at runtime, regenerating only SOUL.md (not AGENTS.md), restarting the container in-place.

### Persona Telemetry
With user consent, aggregate dimension choices across the user base would reveal which presets are actually used vs. which are tuned away from. This informs better preset defaults over time.

---

## Adding a New Blueprint

Blueprint authors don't need to understand the Compiler internals. The contract:

1. Define the blueprint YAML with all required sections (see `CONFIGURATION.md → Blueprint Schema`)
2. Set `personality.dimensions` to define the default persona, or omit for legacy rendering
3. Define 1-4 `customization_questions` for blueprint-specific user preferences
4. The Compiler generates SOUL.md and AGENTS.md automatically at `clawhq init`

The key separation: **blueprint authors control Capability (tools, skills, autonomy, security). Users control Persona (dimensions, preset choice, customization answers).** These never need to be in the same file.

---

## Relationship to Other Systems

| System | Interaction |
|--------|------------|
| **Blueprint validation** (`src/config/validate.ts`) | Validates blueprint YAML before Compiler runs. Catches schema errors early. |
| **Token budget (LM-08)** | `generateIdentityFiles` enforces the 20,000-char limit. Oversized blueprints are truncated with a marker. |
| **Sanitizer** | Customization answers pass through `sanitizeContentSync` before rendering. Prevents prompt injection via setup wizard. |
| **Read-only mount (LM-12)** | Compiled identity files are declared as `ro` volume mounts. The agent cannot modify its own persona at runtime. |
| **Doctor** | `clawhq doctor` verifies identity files haven't drifted from the compiled spec. Future: `clawhq doctor --regen-identity` re-runs the Compiler. |
