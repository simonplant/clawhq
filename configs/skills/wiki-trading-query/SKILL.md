---
name: wiki-trading-query
description: "Answer a trading question by reading the wiki first. Triggers when Simon asks a research question that spans methodologies, setups, risks, or positions — questions like 'what's my thesis on X', 'compare DP and Mancini setups for Y', 'which setups work in regime Z', 'have we seen this risk before'. Reads knowledge/trading/index.md first, drills into relevant pages, synthesizes with [[wiki link]] citations, offers to file valuable answers back as new wiki pages so explorations compound."
---

# wiki-trading-query — Answer from the wiki

Queries against the trading wiki are the payoff of maintenance. The index catalogs what's there; the pages carry the evidence; `[[wiki links]]` trace the reasoning. Answers grounded in the wiki cite specific pages and avoid hallucination.

## Schedule

- **Direct:** Simon asks any non-trivial research or synthesis question about trading, methodologies, setups, risks, positions, or market regimes. Questions that span more than one page are the sweet spot.
- **Cron:** none — always user-initiated.

## When this skill fires

Good triggers:
- "What's our thesis on <X>?" (synthesis across multiple pages)
- "Compare <A> and <B>" (e.g. DP vs Mancini extraction, two setups, two risk models)
- "When does <setup> work / fail?" (setup page + historical notes + regime page)
- "Is <new claim> consistent with what we know?" (claim vs wiki)
- "What sources inform our view on <topic>?" (traces back to `raw/`)

Not this skill:
- Live market data questions — use `quote`, `tradier`, `ta` directly.
- Current positions / P&L — use `trade-journal summary`.
- Extraction tasks with a fixed contract — those are owned by `dp-parse`, `mancini-fetch`, etc.

## Procedure

### 1. Load the index

Read `knowledge/trading/index.md`. It lists every wiki page by category with a one-line summary. Identify the 2–8 pages that plausibly contain the answer. Prefer over-collecting; reading is cheap.

### 2. Read the pages

Pull the candidate wiki pages and any `raw/` sources they cite. Pay attention to:

- **`confidence:` frontmatter** — treat `verified` differently from `speculative`.
- **`last-verified:` frontmatter** — flag if stale relative to the question's time-sensitivity.
- **`[[wiki links]]`** — follow one hop if context is incomplete.
- **Contradictions** — if two pages disagree, surface that explicitly rather than picking one.

If no page covers the question, say so and suggest sources to ingest next — don't fabricate.

### 3. Synthesize

Answer with:

- **The conclusion first** (one or two sentences).
- **Evidence next**, each claim cited like `per [[mancini-methodology]]` or `per raw/fed-minutes-2026-03.md`.
- **Caveats:** stale data, conflicting claims, gaps. Don't hide these.
- **No source?** Answer "The wiki doesn't cover this yet" and propose a source to fetch.

### 4. Offer to file back

If the synthesis is non-trivial — a comparison, a new connection, a regime-specific analysis — ask:

> This analysis touches [[page-a]], [[page-b]], [[page-c]]. Want me to file it as a new wiki page so it stays in the knowledge base?

If yes: run `wiki-trading-ingest` logic to create the analysis page under the appropriate category (usually **Comparisons** or **Methodologies**), add to index, append to log.

## Using the CLI

For cross-page grep and quick stats:
```
llm-wiki stats --name trading           # page count, link density, orphans
llm-wiki context                        # current briefing
```
For actual synthesis: read and reason, don't rely on the CLI.

## Output style

- **Trader-ready:** concrete, numerate, cite the page and the line if a specific number is at stake.
- **No throat-clearing:** don't summarize the question back; answer it.
- **Links are hyperlinks:** use `[[page-slug]]` format so Simon can follow in the file tree.
- **No bullet-soup:** if the answer is one paragraph, write one paragraph. Lists are for truly enumerable things (e.g. "3 setups that triggered in Q1 high-VIX regime").

## Don't

- Don't answer from training data when the wiki has a page on the topic — read the page.
- Don't paraphrase the wiki without citing the specific pages. Citations are the whole point.
- Don't silently skip contradictions or stale claims — flag them.
- Don't file a trivial Q&A back into the wiki — only substantive analyses compound.
