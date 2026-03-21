# news-scanner

Interest-based news aggregation — scan wide, filter hard, surface only signal.

## What It Does

- Scans configured sources (Tavily web search, X/Twitter, Substack) twice daily
- Filters by user's interest graph (`interests.json` if available)
- Deduplicates across sources
- **Sanitizes all external content through ClawWall** (mandatory)
- Delivers a curated digest with only high-signal items
- Saves digest to `memory/news-YYYY-MM-DD.md`

## Philosophy

> Scan wide, filter hard. 10 signal items > 50 noise items.

The scanner scores items against the user's interest graph and drops anything below the threshold. You should rarely see more than 10 items per digest.

## Security Note

All external content (headlines, summaries, links) passes through `sanitize` before the LLM processes it. Items that fail sanitization are quarantined — not silently included.

## Sources

| Source | Required | Tool |
|--------|----------|------|
| Web (Tavily) | Yes | `tavily` |
| X/Twitter | Optional | `x` |
| Substack | Optional | `substack` |

## Output Format

```
## News Digest — [Date]

### [Topic 1]
- [Headline] — [1-sentence summary] ([Source](url))

### [Topic 2]
- [Headline] — [1-sentence summary] ([Source](url))

---
Scanned: [N] items | Surfaced: [M] | Sanitized: [K] quarantined
```

## Tools Required

- `tavily` — web search (budget-managed)
- `sanitize` — ClawWall filter (mandatory)

## Customization

- `sources.x_twitter.enabled: true` — add X scanning (requires `x` tool)
- `sources.substack.enabled: true` — add Substack scanning (requires `substack` tool)
- `filtering.max_items_per_digest` — adjust digest length
- `filtering.signal_threshold` — `high` | `medium` | `low`
