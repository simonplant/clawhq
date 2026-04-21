---
name: wiki-trading-ingest
description: "Ingest a new source into the trading wiki at knowledge/trading/. Triggers when Simon drops a market report, methodology doc, research paper, newsletter, earnings note, or any trading-relevant source and says 'ingest this' / 'add this to the wiki' / 'file this'. Reads the source, discusses key takeaways, creates or updates wiki pages, cross-references across existing pages, updates index.md, appends to log.md. A single ingest can touch 10-15 pages."
---

# wiki-trading-ingest — Ingest a source into the trading wiki

The trading wiki at `knowledge/trading/` is the agent's compounding knowledge base. New sources (research, methodologies, trade lessons, market regime notes) go through this workflow so knowledge integrates rather than accumulates in chat history.

## Schedule

- **Direct:** Simon says "ingest this", "add this to the wiki", "file this source"
- **Cron:** none — event-driven only

## The trading wiki (refresher)

- **`knowledge/trading/raw/`** — immutable source documents. Never modify.
- **`knowledge/trading/wiki/`** — LLM-maintained pages with `[[wiki links]]`. Categories per the `due-diligence` domain: Companies, Markets, Risks, Comparisons, Sources, Methodologies, Setups.
- **`knowledge/trading/index.md`** — catalog of every wiki page by category, one-line summary each.
- **`knowledge/trading/log.md`** — chronological record, parseable format: `## [YYYY-MM-DD] operation | Title`.

## Procedure

### 1. Stage the source

If the source is a file Simon pasted or a URL he linked:

- Save markdown sources to `knowledge/trading/raw/<slug>.md`
- For URLs, fetch with `search extract <url>` and save the sanitized content
- Name files with a kebab-case slug: `fed-minutes-2026-03.md`, not `FedMinutesMarch.md`
- Never write into `raw/` with content you generated — `raw/` is for your source of truth

If `llm-wiki` is available, prefer:
```
llm-wiki ingest <path-to-source>.md --path knowledge/trading
```
It copies the file, slugifies the name, extracts frontmatter title, and stubs the index. Run from the workspace root (`/home/node/.openclaw/workspace`).

### 2. Read and discuss

Read the source fully. Then surface to Simon the 3–5 key takeaways in plain language before writing anything. Ask:

- Is there a methodology implication? (Update `dp-methodology.md` / `mancini-methodology.md` or create a new methodology page.)
- Does this update an existing position or thesis? (Touch the relevant Company/Market page.)
- Is this a new concept that deserves its own page? (Create it.)
- Does it contradict any existing claim? (Flag it — ask Simon how to resolve.)

Wait for Simon's steer before the write phase. One ingest can touch many pages; over-writing creates churn.

### 3. Write the wiki updates

For each page you touch:

- **Lead with the claim**, then evidence, then source citation in the form `(see [[source-slug]])` or `(see raw/<file>.md)`.
- **Use `[[wiki links]]` liberally.** Every named entity, methodology, risk, or setup should link to its page if one exists. If not, create a stub.
- **Note confidence:** add a `confidence:` frontmatter field — `verified`, `reported`, `estimated`, or `speculative`.
- **Flag staleness:** add `last-verified: YYYY-MM-DD` in frontmatter.
- **When sources disagree,** document both positions and the evidence for each. Do not silently override.

Prefer **updating existing pages** over creating new ones when the topic overlaps.

### 4. Update navigation

- **`index.md`** — add new pages under their category heading. Format: `- [[page-slug]] — one-line summary`.
- **`log.md`** — append a single entry: `## [YYYY-MM-DD] ingest | <Source Title>` followed by a 2–4 line summary of what changed.

### 5. Verify

```
llm-wiki lint --fix --path knowledge/trading
```
Catches broken `[[links]]`, orphan pages, missing frontmatter, index drift. Auto-fixes what it can.

### 6. Report back

Summarize to Simon, tersely:
```
Created: wiki/<new-page>.md
Updated: wiki/<existing-1>.md, wiki/<existing-2>.md, index.md
Appended: log.md
Lint: clean / N issues (M fixed, K open)
```

## Conventions (trading-specific)

- **Methodology pages** (`dp-methodology.md`, `mancini-methodology.md`) are canonical contracts. Skills like `dp-parse` and `mancini-fetch` cite them. Edits here propagate — review carefully.
- **Extraction rule pages** (`dp-extraction-rules.md`, `mancini-extraction-rules.md`) define structured-output contracts. Changing these changes what the daily brief produces. Version-bump and note in log.
- **Setup pages** (one per named setup: `failed-breakdown.md`, `opening-range-breakout.md`) should cross-link to the methodology that defines them and to any company/market pages where the setup played out.
- **Risk pages** (one per identified risk: `overnight-gap-risk.md`, `fed-meeting-blackout.md`) cross-link to setups affected and to risk-governor rules in `references/RISK_GOVERNOR.md`.
- **Trade journal entries are NOT wiki pages.** They live in `trade-journal.json` / `MARKETS/STATE.json`. The wiki records *lessons* extracted from those trades, not the trades themselves.

## Don't

- Don't modify files under `knowledge/trading/raw/` — those are sources of truth.
- Don't paraphrase raw content into raw/ — only real sources go there.
- Don't silently overwrite a claim when a new source contradicts it — flag and let Simon resolve.
- Don't skip the discussion step. Wiki growth without editorial judgment is entropy.
- Don't create a new page when an existing one covers the topic — extend the existing one.
