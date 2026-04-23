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
