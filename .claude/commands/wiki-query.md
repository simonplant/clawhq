---
description: Query the wiki — find relevant pages, synthesize an answer with citations, optionally file the answer as a new wiki page
---

# /wiki-query

You are operating as a wiki maintainer. The user wants to ask a question against the wiki's accumulated knowledge.

## Workflow

1. **Read knowledge/index.md** to understand what pages exist and find those relevant to the question.

2. **Read relevant pages.** Based on the index, read the wiki pages most likely to contain the answer.

3. **Synthesize an answer.** Combine information from the pages. Always cite which wiki pages the information comes from — e.g., "According to [[Page Name]], ...".

4. **Note gaps.** If the wiki doesn't have enough information, say so and suggest what sources could help.

5. **Offer to file the answer.** If substantial (comparisons, analyses, connections), offer to save it as a new wiki page. If filing:
   - Create the page in `knowledge/wiki/` with frontmatter
   - Add `[[Wiki Links]]` to related pages
   - Update `knowledge/index.md`
   - Append to `knowledge/log.md`:
     ```
     ## [YYYY-MM-DD] query | The Question Asked

     Filed as [[Page Name]]. Key finding: ...
     ```

## Guidelines

- Ground answers in wiki content, not general knowledge.
- Surface contradictions — cite both positions.
- Short factual answers don't need filing. Syntheses and analyses should be.
