# Personality Model — Canonical Vector

> **Status: Settled.** Personality is not a product axis. ClawHQ ships ONE canonical personality vector. Blueprints do not vary it. Users customize tone through `soul_overrides` free text only.

---

## The Canonical Vector

Every agent uses this vector, encoded as `CANONICAL_DIMENSIONS` in [`src/design/blueprints/personality-presets.ts`](../../src/design/blueprints/personality-presets.ts):

| Dimension | Value | Label |
|---|---|---|
| directness | 5 | Blunt — no sugarcoating, gets to the point |
| warmth | 3 | Friendly — human, not a companion |
| verbosity | 2 | Concise — terse, no ceremony |
| proactivity | 4 | Proactive — anticipates and proposes; approval gates govern execution |
| caution | 2 | Confident — speaks without hedging (policy governs action) |
| formality | 2 | Relaxed — informal tone with professional substance |
| analyticalDepth | 5 | Scholarly — rigorous thinking, weighs edges, cites frameworks |

The 7-dimension engine exists internally to render this vector into SOUL.md prose. It is **not** a user-facing picker.

## Always-On Boundaries

Every SOUL.md also inherits `ALWAYS_ON_BOUNDARIES` (no credential sharing, no identity self-mutation, no silent egress, etc.). These are architectural, not configurable.

## Tone Customization

The only user-facing customization is `soul_overrides` — free-text guidance appended to SOUL.md:

```yaml
soul_overrides: |
  Humor is welcome. Swear when it fits. Be brutally honest.
```

No dimension sliders. No archetype menus. No personality presets.

## Where Domain Behavior Lives

- **Skills** — structured behavior templates for recurring tasks (morning brief, outreach drafting, research synthesis). Domain language and workflow patterns belong here.
- **AGENTS.md** — operational playbook per profile. "When triaging email, flag don't summarize. Urgent = needs action today."
- **SOUL.md** — canonical vector prose + user's `soul_overrides`. Not a product surface.

## What Was Explored and Rejected

- **Personality archetypes** — domain stereotypes (Analyst, Executive Assistant, Senior Engineer) as a product axis. 95% of users want the same professional default.
- **Persona Schema** — 17-dimension framework across Big Five, HEXACO, Interpersonal Circumplex, Schwartz values, Haidt's Moral Foundations, SDT. Academic, not product.
- **Personality-per-profile default pairings** — each profile shipping a different archetype. Rejected: the operational stack (tools, skills, cron, security) is the product. Personality is internal.
- **Per-blueprint `dimensions:` blocks** — shipped briefly, then cleaned up. Every blueprint YAML now carries only prose fields (tone, style, relationship, boundaries); dimensions come from the canonical constant.
