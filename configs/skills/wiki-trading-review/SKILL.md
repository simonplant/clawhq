---
name: wiki-trading-review
description: "Content-level health check on the trading wiki at knowledge/trading/. Triggers weekly (cron) or when Simon says 'audit the wiki' / 'review the trading wiki' / 'what's stale in the wiki'. Flags contradictions between pages, stale claims superseded by newer sources, orphan pages with no inbound links, concepts mentioned but lacking a page, missing cross-references, and suggests new sources or questions to investigate. Complements llm-wiki lint (which handles structural issues); this is the content-quality pass."
---

# wiki-trading-review — Content health check

`llm-wiki lint` catches structural issues (broken links, orphans, missing frontmatter). This skill does the content-level review that requires judgment: stale claims, silent contradictions, concepts missing their own page, and suggestions for what to investigate next.

## Schedule

- **Cron:** weekly (Sunday 17:00 PT / `0 17 * * 0`) — writes the review to `journal/wiki-review-<ISO-date>.md` and DMs a 3-line summary to Simon
- **Direct:** Simon says "audit the wiki", "review the trading wiki", "what's stale", "what should we research next"

## Procedure

### 1. Structural lint first

```
llm-wiki lint --path knowledge/trading
```
Run from `/home/node/.openclaw/workspace`.

Surface any structural issues as a one-line summary. This skill is *not* about re-doing that — it's about what `lint` can't see.

### 2. Stats snapshot

```
llm-wiki stats --path knowledge/trading
```

Capture: page count, source count, link density, orphans, most-connected pages, recent activity. This gives proportion — if the wiki is small, be generous; if large, be selective.

### 3. Content checks

Walk the wiki deliberately. For each category in `index.md`:

**Contradictions.** Do two pages claim different things about the same entity, number, or rule? Example: `dp-methodology.md` says "core position sizing is 2-5%" and a newer `raw/` source notes "Simon has moved to 3-7%" — surface the divergence; don't silently pick one.

**Stale claims.** Pages with `last-verified:` older than some threshold (90 days for fast-moving market conditions, 1 year for methodology). Pages citing data points with specific dates (earnings numbers, Fed rates, specific levels) — check whether the referenced date is still relevant.

**Orphans vs hubs.** Pages with zero inbound `[[wiki links]]`. Decide: link from a hub page (e.g. `trading-system.md` is a hub), or delete if the page never became load-bearing.

**Missing pages.** Scan prose across the wiki for named entities, setups, risks, or methodologies that appear in 2+ places but don't have their own page. Candidates to create.

**Missing cross-references.** Two pages that clearly relate but don't link (e.g. a risk page and the setups it affects). Add `[[links]]`.

**Gaps.** Topics that Simon has asked about in `log.md` query entries but where the wiki still lacks coverage. These are the sources to prioritize ingesting.

### 4. Report

Structured output, three sections:

```
## Fix now
- <contradiction / stale claim / broken invariant>  — concrete, one-line each

## Improve
- <missing cross-ref / orphan / minor gap>  — cheap wins

## Investigate
- <source to ingest / question to research>  — direction for next week
```

Always end with one concrete recommendation — a single source to ingest or a single page to create — that Simon can approve with one message.

### 5. Log

Append to `knowledge/trading/log.md`:
```
## [YYYY-MM-DD] review | weekly (or ad-hoc)
<N> Fix-now items, <M> Improve items, <K> Investigate items.
Recommended next: <one-line>.
```

## Tone

- **Direct.** No "I noticed that perhaps..." Just say what's wrong.
- **Prioritized.** Fix-now before Improve before Investigate. Don't drown Simon in everything at once.
- **Actionable.** Every item names a page or a source. No vague "the methodology section could be improved."
- **Honest about scope.** If the wiki is small and young, the review is small too. Don't manufacture findings to look busy.

## Don't

- Don't re-run `llm-wiki lint` and call that the review — the lint is a prerequisite, not the deliverable.
- Don't rewrite wiki pages during the review — that's `wiki-trading-ingest`. The review only identifies.
- Don't flag every outdated date — only flag dates that matter to a current claim or decision.
- Don't recommend more than one next-step source. Triage.
