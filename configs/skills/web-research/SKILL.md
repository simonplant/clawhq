# web-research

On-demand and scheduled web research — Tavily-powered, cited, sanitized.

## What It Does

- Accepts research queries from users or other skills
- Queries Tavily for web search results
- **Sanitizes all results through ClawWall** (mandatory — external content is untrusted)
- Compiles findings into structured summaries with citations
- Saves research to `memory/research-YYYY-MM-DD.md` for future reference
- Flags low-confidence findings and conflicting sources

## Security Note

**Every external result is routed through `sanitize` (ClawWall) before processing.**  
This is non-negotiable. Web content can contain prompt injection attacks.

## Usage

Triggered on-demand:
- "Research X for me"
- "Find recent news about Y"
- "What do people say about Z?"

Also used by other skills (e.g., `news-scanner`, `content-draft`) as a research sub-component.

## Output Format

```
## Research: [Topic]
Date: [YYYY-MM-DD]
Confidence: [high|medium|low]

### Summary
[2-3 paragraph synthesis]

### Key Findings
- Finding 1 [Source](url)
- Finding 2 [Source](url)

### Contradictions / Uncertainty
[Any conflicting information found]
```

## Tools Required

- `tavily` — web search API (budget-managed)
- `sanitize` — ClawWall prompt injection filter (mandatory)
- `tasks` — track research requests queue

## Customization

- `max_queries_per_session` — API budget control (default: 10)
- `max_depth` — follow-up query depth (default: 3)
- `save_findings` — persist results to memory files
