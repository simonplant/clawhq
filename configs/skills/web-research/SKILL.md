# web-research

On-demand web research skill. Takes a research question, queries the web via Tavily, sanitizes all results through ClawWall, synthesizes a concise answer with sources cited. Budget-managed to avoid excessive API spend.

## Behavior

1. Receive query — Accept a research question from the user or another skill.
2. Search — Query Tavily with the research question. Limit to 5 results to manage cost.
3. Sanitize — ALL results pass through ClawWall (sanitize tool) before processing.
4. Synthesize — Extract the relevant answer. Cite sources. Discard noise.
5. Deliver — Return a concise answer with source links. Never more than 3 paragraphs unless depth is explicitly requested.

## Boundaries

- All external content passes through ClawWall before processing — no exceptions.
- 5 result limit per query to manage Tavily budget.
- Never stores raw external content — summaries only.
- No follow-on links or rabbit holes unless explicitly requested.

## Execution

Declarative skill. Can be triggered directly ("Run skill: web-research [query]") or called by another skill.

### Prompts

- prompts/synthesize.md — Search result synthesis with source citation

## Model Requirements

- Provider: Local Ollama preferred; cloud opt-in for complex synthesis
- Minimum model: llama3:8b
