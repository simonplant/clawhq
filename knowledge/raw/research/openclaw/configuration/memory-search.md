---
title: Memory search configuration
subject: openclaw
type: configuration
status: active
openclaw_version: ">=v2026.4.12"
last_verified: 2026-04-22
location: "src/memory/ (runtime); openclaw.json memorySearch.*"
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
source_types: [compiled-reference]
see_also:
  - openclaw/concept/memory-system.md
  - openclaw/component/memory-md.md
  - openclaw/configuration/openclaw-json-schema.md
tags: [memory, embedding, sqlite-vec, config]
---

# Memory search configuration

## Reference

```json5
{
  agents: {
    defaults: {
      memorySearch: {
        enabled: true,
        provider: "voyage",             // auto-detected from API keys
        model: "voyage-3-large",        // provider-specific embedding model
        sources: ["memory", "sessions"],
        indexMode: "hot",
        minScore: 0.3,
        maxResults: 20,
        candidateMultiplier: 3,         // retrieve maxResults * multiplier
        extraPaths: ["../team-docs", "/srv/shared-notes/overview.md"],
        fallback: "local",              // openai | gemini | local | none
        remote: {
          baseUrl: "https://api.example.com/v1/",
          apiKey: "YOUR_API_KEY",
          headers: { "X-Custom-Header": "value" },
        },
      },
      compaction: {
        reserveTokensFloor: 20000,
        mode: "archive",                // archive | summary
        memoryFlush: {
          enabled: true,                // pre-compaction memory save
          softThresholdTokens: 4000,
          systemPrompt: "Session nearing compaction. Store durable memories now.",
          prompt: "Write any lasting notes to memory/YYYY-MM-DD.md; reply with NO_REPLY if nothing to store.",
        },
      },
      contextPruning: {
        mode: "cache-ttl",              // smart defaults for Anthropic profiles
        ttl: "24h",
        keepLastAssistants: 100,
      },
    },
  },
}
```

## Supported providers

- **OpenAI** — `text-embedding-3-*`.
- **Gemini** — Google's embedding models.
- **Voyage** (recommended) — `voyage-3-large`, `voyage-3-code`.
- **Mistral** — Mistral's embedding endpoints.
- **Ollama** — local embeddings via Ollama runtime.
- **Local GGUF** — fully local, no API dependency.

Provider auto-detected from available API keys. Fallback provider
kicks in if the primary fails.

## Internals

- SQLite-based with `sqlite-vec` extension.
- Chunks: ~400 tokens with 80-token overlap.
- Hybrid search: 70% vector / 30% BM25 keyword.
- The index stores `embedding provider + model + endpoint fingerprint +
  chunking params`. If any of these change, OpenClaw automatically
  resets and reindexes.
- File watcher maintains freshness on `MEMORY.md`, `memory/`, and
  `memorySearch.extraPaths` with 1.5-second debounce.

## Session transcript indexing

OpenClaw can automatically save and index past conversations, making
them searchable in future sessions. Session transcripts use delta
thresholds to trigger background sync. This enables the agent to
recall decisions made weeks ago through `memory_search`.

## Pruning vs. compaction

Two mechanisms, often confused:

- **Pruning** runs before each LLM call. Trims old tool results from
  the in-memory context. Does not touch session files on disk. Mode
  `cache-ttl` is the Anthropic-profile default.
- **Compaction** rewrites conversation history. Invalidates the prompt
  cache. A silent memory-flush turn runs before compaction (per
  `memoryFlush` config) reminding the model to persist anything
  important.

## Memory flush

When the session approaches the compaction threshold, OpenClaw runs a
silent agentic turn using the `memoryFlush.prompt`. The model writes
anything durable to the appropriate memory file, then responds
`NO_REPLY` if nothing more to store. This preserves context that would
otherwise be lost when compaction rewrites history.

Best-effort, not guaranteed. Build manual save points as backup — use
`/compact` proactively before the window fills.

## extraPaths

`memorySearch.extraPaths` lets the agent search directories outside
the workspace. Use cases:

- Shared team notes mounted read-only at `/srv/shared-notes/`.
- A sibling repo's documentation referenced from multiple agents.
- Reference material that's too large for workspace/docs/.

extraPaths are **read-only** from the memory search perspective —
they're indexed and retrievable but the agent cannot write to them
through `memory_get`/`memory_search`. Actual write access still
depends on `tools.fs.workspaceOnly` and the container's mount
permissions.

## Advanced alternatives

For workspaces that outgrow basic memory search:

- **Cognee** — graph memory, extracts entities and relationships into
  a knowledge graph, enables relational queries ("who manages auth?").
- **Mem0** — auto-extraction, vector DB, deduplication; automatic fact
  capture without manual curation.
- **QMD sidecar** — MMR diversity re-ranking and temporal decay; better
  recall accuracy, indexes directories outside the workspace.

Each of these is a pluggable alternative, not a replacement for the
base memory system. The base is always available as a fallback.
