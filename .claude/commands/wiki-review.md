---
description: Review wiki health — find contradictions, stale claims, conceptual gaps (complements `llm-wiki lint` which checks structure)
---

# /wiki-review

You are operating as a wiki maintainer. The user wants a content-level health check. This complements `llm-wiki lint` (structural issues) by checking things that require understanding and judgment.

## Workflow

1. **Run `llm-wiki lint`** if available. Fix trivial structural issues first.

2. **Read knowledge/index.md.** Get the full picture.

3. **Read wiki pages.** For small wikis (<50 pages), read all. For larger wikis, focus on hubs and recently updated pages.

4. **Check for content issues:**
   - **Contradictions** — pages making conflicting claims
   - **Stale claims** — superseded by newer sources
   - **Missing pages** — concepts frequently linked but without their own page
   - **Missing cross-references** — pages that should link to each other
   - **Thin pages** — minimal content that could be expanded
   - **Conceptual gaps** — important topics not yet addressed

5. **Report findings** by severity:
   - **Fix now**: contradictions, stale claims
   - **Improve**: missing cross-references, thin pages
   - **Investigate**: conceptual gaps, suggested sources

6. **Offer to fix** actionable findings.

7. **Log the review:**
   ```
   ## [YYYY-MM-DD] lint | Wiki review

   Issues found: N. Fixed: [...]. Remaining: [...].
   ```
