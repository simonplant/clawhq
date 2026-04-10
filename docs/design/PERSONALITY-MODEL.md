# Personality Model — Deprioritized

> **Status: Deprioritized.** Personality is not a product axis. One professional default tone ships with all blueprints. Domain-specific behavior lives in skills and operational playbooks (AGENTS.md), not personality config.

---

## What Shipped

- One professional default tone baked into SOUL.md generation: competent, terse, anticipatory. Reports findings, not process. Acts without narrating.
- 7 dimension sliders exist in the compiler (directness, warmth, verbosity, proactivity, caution, formality, analyticalDepth) for power users who want fine-tuning.
- `soul_overrides` field in config for free-text personal preferences ("Humor is welcome. Swear when it fits. Be brutally honest.").
- Warmth slider exposed as the one axis that matters for differentiation (family vs trading desk).

## What Was Explored and Rejected

- **Personality archetypes** — domain stereotypes (Analyst, Executive Assistant, Senior Engineer) as a product axis. Research showed 95% of users want the same professional default. The archetypes were interesting design heuristics — the default tone blends the best from each — but they don't justify a user-facing selection menu.
- **Persona Schema** — 17-dimension framework across Big Five, HEXACO, Interpersonal Circumplex, Schwartz values, Haidt's Moral Foundations, SDT. Academic contribution, not product. May publish separately.
- **Personality-per-profile default pairings** — each profile shipping a different archetype. Rejected: the operational stack (tools, skills, cron, security) is the product. Personality is three paragraphs in SOUL.md.

## Where Domain Behavior Actually Lives

- **Skills** — structured behavior templates for recurring tasks (morning brief, outreach drafting, research synthesis). This is where domain language and workflow patterns belong.
- **AGENTS.md** — operational playbook per profile. "When triaging email, flag don't summarize. Urgent = needs action today."
- **SOUL.md** — three paragraphs of professional tone + user's soul_overrides. Not a product surface.
