# reading-list

Capture, organize, and surface reading material. User adds articles, papers, books,
and newsletters to a queue. Agent surfaces what's most relevant, most urgent, and
drops items that have aged past their usefulness.

## Behavior

1. Capture — User shares a URL or title; agent adds to queue with timestamp and source type.
2. Enrich — Fetch title, author, and estimated read time (for URLs). Store locally.
3. Prioritize — Score items by recency, topic match to user's interests, and read-time budget.
4. Surface — Daily 08:15: deliver top 3 items from queue with one-line preview each.
5. Archive — Items not read within 30 days are archived (not deleted). User can review later.
6. ClawWall — All URLs run through sanitize before fetch/enrichment.

## Boundaries

- Sanitize all external URLs before fetching any content.
- Never auto-open, auto-read, or auto-share items.
- Archive, don't delete — user controls permanent removal.
- No subscription or account creation for paywalled content.

## Schedule

Daily surface at 08:15 (post morning brief). On-demand for add/search.

## Prompts

- prompts/capture.md — Item capture confirmation
- prompts/surface.md — Daily reading digest composition

## Model Requirements

Local Ollama only. Minimum: llama3:8b. No cloud escalation.
