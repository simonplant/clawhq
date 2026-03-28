# Personality Model — Capabilities and Personas

> **Status: Design only.** This document describes the planned compiler catalog for capability and persona composition. None of these fields exist in the current blueprint schema. The current schema uses `toolbelt.tools[]`, `skill_bundle.included[]`, and `personality.dimensions` directly. See `docs/ARCHITECTURE.md` for the full compile-time vs. runtime model.

---

Personality composition is a compile-time problem. OpenClaw never sees capabilities or personas — it gets flat, resolved config. These are ClawHQ compiler concepts.

## Capability — What the agent can do

A named tool+skill+integration bundle with operational doctrine:

```typescript
interface Capability {
  id: string                    // "inbox-manager"
  name: string                  // "Inbox Manager"
  description: string           // one-line description
  tools: string[]               // ["fm", "email", "contacts"]
  skills: string[]              // ["scanner-triage"]
  integrations: string[]        // ["fastmail", "icloud"]
  soul_fragments: string[]      // prose injected into SOUL.md — operational
                                // doctrine for this domain, NOT personality
  suggested_crons: CronDef[]    // defaults, user can override
}
```

Capability does NOT carry personality or autonomy. Those are agent-level concerns. `soul_fragments` is domain-specific behavioral guidance (e.g., a trader capability's fragment: "singles mentality, never execute trades directly"), not personality style.

## Persona — How the agent talks

A curated prose bundle, not an MBTI code:

```typescript
interface Persona {
  id: string                    // "stoic-operator"
  name: string                  // "Stoic Operator"
  description: string
  soul_template: string         // SOUL.md skeleton with {{slots}} for capability fragments
  voice_examples: string[]      // 3-5 concrete example responses showing tone
  dimensions: Dimensions        // the 7 slider defaults
  anti_patterns: string[]       // "never use exclamation marks"
}
```

ClawHQ ships 8-12 curated personas. Users can also start blank and write their own SOUL.md — the persona is a starting point, not a constraint. `voice_examples` are the key differentiator from abstract sliders: concrete samples of how this persona actually responds.

## Blueprint with catalog references

```yaml
# Planned schema — not yet implemented
persona: stoic-operator
capabilities:
  - inbox-manager
  - trader
  - meal-planner
extra_tools: [weather]          # escape hatch, outside any capability
dimension_overrides:
  warmth: 3                     # fine-tune persona defaults
soul_overrides: |               # free-text appended to SOUL.md
  Always greet with the user's name.
```

## Compile step

persona.soul_template + capability.soul_fragments -> assembled SOUL.md -> dimension overrides applied -> flat runtime config emitted. No intermediate concepts survive into `config.yaml` or `SOUL.md`.
