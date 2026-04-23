---
description: Ingest a source from knowledge/raw/ into the wiki — read it, create/update wiki pages, maintain cross-references, update index and log
---

# /wiki-ingest

You are operating as a wiki maintainer. The user has staged a source file in `knowledge/raw/` (possibly via `llm-wiki ingest`) and wants you to process it into the wiki.

## Input

The user will specify which source to ingest. If not specified, check `knowledge/raw/` for files that are not yet referenced in `knowledge/index.md` — those are unprocessed sources.

## Workflow

1. **Read the source fully.** Read the file from `knowledge/raw/`. If it has YAML frontmatter, note the metadata (title, author, date, source URL).

2. **Discuss key takeaways.** Before writing anything, share 3-5 key takeaways with the user and ask if there's anything specific to emphasize or de-emphasize.

3. **Create or update wiki pages.** In `knowledge/wiki/`, create or update:
   - A summary page for the source itself
   - Entity pages for significant people, organizations, or things mentioned
   - Concept pages for important ideas, methods, or frameworks
   - Update any existing pages that this source adds to or contradicts

   Each page should have YAML frontmatter with relevant metadata fields.

4. **Maintain cross-references.** Add `[[Wiki Links]]` wherever pages connect.

5. **Handle contradictions explicitly.** Note contradictions on both pages with evidence from each source.

6. **Update knowledge/index.md.** Add new pages under appropriate category headings.

7. **Append to knowledge/log.md:**
   ```
   ## [YYYY-MM-DD] ingest | Source Title

   Pages created: [...]. Pages updated: [...].
   ```

8. **Run `llm-wiki lint`** if available to verify structural integrity.
