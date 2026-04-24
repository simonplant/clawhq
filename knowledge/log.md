# Log

## [2026-04-22] migrate | Import 48 pages from prior subject/type wiki into native llm-wiki flat layout

**Source:** `raw/research/` (pre-migration wiki, preserved for reference)
**Primary source:** `raw/openclaw-reference-v2026-4-14.md`
**Pages created:** 48

Imported 48 pages from a prior custom-schema wiki (subject × type hierarchy:
openclaw / clawhq / cross × concept / component / architecture / configuration /
operation / security / landmine / pattern / finding / comparison) into the flat
llm-wiki `product` schema. Category mapping:

- concept, security, landmine, pattern → **Decisions** (26)
- component, architecture, configuration, operation → **Features** (18)
- finding → **Metrics** (3)
- comparison → **Competitors** (1)
- (no Personas yet)

Path-style cross-references (`[[subject/type/slug]]`) rewritten to slug-based
(`[[slug]]`). Frontmatter rewritten to product template shape: title, category,
status, date, tags (subject + type folded into tags for recovery).

Prior wiki tree retained under `raw/research/` for provenance — do not treat
as authoritative; `wiki/` is the source of truth going forward.

Known lint: 5 orphans (pages no one cross-links), 1 false-positive on the
Sources entry in index.md (lint only checks wiki/, but ingest writes Sources
entries that reference raw/).

## [2026-04-23] init | Wiki created

Initialized LLM Wiki instance.

## [2026-04-23] query | Email audit → stress-tested proposal → filed [[provider-profile-layer]] as deferred

Ran an end-to-end email audit across ClawHQ source + Clawdius runtime state.
Found:

- Dual compile surfaces: legacy `src/design/configure/generate.ts::generateBundle`
  (now seeds-only) vs canonical `src/design/catalog/compiler.ts::compile`
  (invoked by `clawhq apply` via `src/evolve/apply/index.ts:23`).
- Himalaya config generator IS wired (contradicting the 2026-04-16 memory
  note). File present on Clawdius at `workspace/config/himalaya/config.toml`
  but with empty `email = ""` / `backend.login = ""` because wizard didn't
  collect slot-2 credentials.
- Five gaps: wizard slot iteration (bug), no `probeEmail`, wizard ignores
  provider catalog, no cadence customization, approval name drift.

Initial proposal: promote `providers.ts` to a first-class provider-profile
layer. Stress-tested with thinking-toolkit (attack/defence/verdict + hidden
assumptions). Verdict: over-architecting. The five gaps don't share a root
cause; the most concrete gap is a loop bug, not a structural problem.
Four IMAP providers of identical shape don't justify a type abstraction.

**Filed [[provider-profile-layer]] as a deferred Decision** — captures the
proposal, the reasoning against, and the three conditions under which it
becomes right (OAuth/JMAP/Bridge provider, wizard branching > 100 lines,
diverging probes). Prevents the proposal being re-surfaced without the
preconditions being met.

**Corrected [[email-integration]]** — the "Known gap (2026-04-16)" section
claimed the himalaya config generator was missing. That was stale. Replaced
with the five real gaps plus a link to [[provider-profile-layer]] so the
next reader sees why the obvious layering response isn't the right call.

**Updated memory** `project_clawdius_toolfix_20260416` to mark the
himalaya-config-generator gap resolved and record the slot-iteration bug
and missing probe as the current state.

## [2026-04-23] query | Email default behaviour + permissions → filed as [[email-integration]]

Synthesized answer from [[integration-layer]], the Email Manager blueprint in
`docs/OPENCLAW-REFERENCE.md`, [[credential-health-probes]], and
[[egress-firewall]]. No single page covered email end-to-end despite it being
a first-class integration category.

Filed a new Features page `[[email-integration]]` covering tool surface
(himalaya + `workspace/email` wrapper, commands, providers), permissions
(autonomy gates on `sending_messages`, first-contact rule, approve-action
routing, read-only identity mount), network posture (allowlist egress, port-
aware rules), health & lifecycle (probe + 15-min triage + `email-digest`
skill), and adjacent landmines.

Page records the known gap: `himalaya` config generator is not yet produced
by `clawhq apply` on Clawdius (from 2026-04-16 toolfix triage). Tool,
permissions, and egress layers are wired — compile step is not.
