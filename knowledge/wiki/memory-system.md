---
title: Memory system
category: Decisions
status: active
date: 2026-04-22
tags: [memory, persistence, compaction, tiers, openclaw, concept]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# Memory system

OpenClaw's memory is what transforms it from a stateless chatbot into
a persistent assistant. The core commitment: **files are the source of
truth; the model only "remembers" what gets written to disk.**

## Two-layer architecture

### Layer 1: daily logs (`memory/YYYY-MM-DD.md`)

- Append-only.
- Auto-loaded: today + yesterday at session start.
- Running context, session notes, what happened today.
- Think of these as a journal — good for continuity across a few days.
- The agent creates these automatically during sessions.
- Older logs accessible via `memory_search`.

### Layer 2: curated long-term memory (`MEMORY.md`)

- Main/private session only — never loads in group contexts.
- Curated facts, preferences, project summaries, lessons learned.
- The stuff you want to persist across months.
- **Keep it short.** Anything that doesn't need to be in every session
  lives in daily logs; the agent finds it via `memory_search` on demand.

## Memory tools

Two tools the agent calls to reach memory:

| Tool | Purpose |
|---|---|
| `memory_search` | Semantic recall over indexed snippets (hybrid: 70% vector / 30% BM25 keyword) |
| `memory_get` | Targeted read by file and line range; returns empty gracefully if missing |

## Search internals

SQLite-based with the `sqlite-vec` extension. Chunks are ~400 tokens
with 80-token overlap. The index stores `embedding provider + model +
endpoint fingerprint + chunking params`. If any of these change,
OpenClaw automatically resets and reindexes.

Freshness is maintained via a file watcher on `MEMORY.md`, `memory/`,
and `memorySearch.extraPaths`, with a 1.5-second debounce.

Supported embedding providers: OpenAI, Gemini, Voyage (recommended),
Mistral, Ollama, local GGUF models. Provider auto-detected from
available API keys.

## Pruning vs. compaction

These are two different things that both happen to "shrink context":

- **Pruning** runs before each LLM call. Trims old tool results from
  the in-memory context. Does not touch session files on disk.
- **Compaction** rewrites conversation history. Invalidates the prompt
  cache — every unnecessary compaction is both a reliability and cost
  problem. A silent memory-flush turn runs before compaction,
  reminding the model to persist anything important.

## Lifecycle: hot / warm / cold

Without management, agent memory grows at ~120KB/day during active use
(360KB in 3 days observed). ClawHQ implements tiered lifecycle:

| Tier | Age | Size limit | State |
|---|---|---|---|
| Hot | ≤7 days | ≤50KB | Full fidelity, in every conversation |
| Warm | 7–90 days | Summarized | Indexed, searchable on demand |
| Cold | 90+ days | Summarized + compressed | Archived, retrievable on demand |

Implementation: `src/evolve/memory/lifecycle.ts`. Defaults: 50KB hot
max, 24h hot retention, 168h (7-day) warm retention, cold never
purged.

Transitions:

| Transition | What happens | When |
|---|---|---|
| Hot → Warm | Summarize, extract key facts, move full text to warm | Daily (configurable) |
| Warm → Cold | Further compress, PII-mask, archive | Weekly (configurable) |
| Cold → Deleted | Permanent removal | Per retention policy |

Summarization is LLM-powered (uses the agent's subagent model). PII
masking runs at each transition.

## Best practices

1. **Write it down immediately.** If something matters, tell the agent
   to write it to memory. Don't rely on conversation context surviving
   compaction.
2. **Weekly curation.** Review the last 7–14 days of daily logs.
   Extract patterns, update MEMORY.md, archive or clean up.
3. **Separate concerns.** Decisions and preferences → MEMORY.md.
   Running context → daily logs. No duplicating between them.
4. **Mind the truncation limits.** Per-file 20,000 chars, aggregate
   150,000. See
   [[identity-files-exceed-bootstrap-max-chars]].
5. **Use `/context list`.** Shows exactly what's loaded, truncated,
   or missing. First thing to run when memory seems off.
6. **Proactive compaction.** Run `/compact` before context overflow.
   The automatic memory flush is best-effort; build manual save points
   as backup.
7. **Git-back your workspace.** Set up auto-commit via cron. Keep
   credentials and `openclaw.json` out of the repo.

## Advanced options

For workspaces that outgrow basic memory search:

- **Cognee** — graph memory. Extracts entities and relationships into
  a knowledge graph. Good for relational queries ("who manages auth?").
- **Mem0** — auto-capture. Watches conversations, extracts structured
  facts, deduplicates. For conversational agents where manual curation
  is too much work.
- **QMD sidecar** — advanced retrieval backend with MMR diversity
  re-ranking and temporal decay.

## See also

- [[memory-md]]
- [[system-prompt-assembly]]
- [[files-are-the-agent]]
- [[memory-search]]
