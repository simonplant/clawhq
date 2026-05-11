---
title: Sterling multi-agent profile
category: Features
status: active
date: 2026-05-11
tags: [clawhq, sterling, multi-agent, routing, openrouter, blueprint]
sources:
  - https://docs.openclaw.ai/concepts/multi-agent
  - https://docs.openclaw.ai/concepts/model-failover
---

# Sterling multi-agent profile

## Purpose

`sterling` is the first multi-agent mission profile in ClawHQ. It
hosts three role-specialised agents — `life-ops`, `markets`, `vision` —
under one OpenClaw engine, routing each agent's turns to a different
mix of local and remote models.

The motivation is "clone the PRO 6000 capability profile on a 5090
without buying the card." Heavy reasoning that doesn't fit in 32 GB
VRAM is rented from OpenRouter (Nemotron Super 120B on the free tier,
Claude Opus as escape hatch). Local hot-path tool calls stay on Ollama
where latency matters.

## Architecture (compile time)

A mission profile may now optionally carry `agents:` — an array of
[[per-agent overrides]]. When the profile compiles, the compiler emits:

```json
{
  "agents": {
    "list": [
      { "id": "life-ops", "default": true, "workspace": "life-ops",
        "model": { "primary": "ollama/gpt-oss:20b",
                   "fallbacks": [
                     "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
                     "openrouter/anthropic/claude-sonnet-4.6"
                   ] } },
      { "id": "markets", "workspace": "markets",
        "model": { "primary": "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
                   "fallbacks": [
                     "openrouter/nvidia/nemotron-3-super-120b-a12b",
                     "openrouter/anthropic/claude-opus-4.7"
                   ] } },
      { "id": "vision", "workspace": "vision",
        "model": "ollama/qwen2.5vl:32b-q4_K_M",
        "sandbox": { "mode": "all", "scope": "agent" } }
    ],
    "defaults": { ... }
  },
  "models": {
    "providers": {
      "ollama": { "baseUrl": "http://ollama:11434", ... },
      "openrouter": { "baseUrl": "https://openrouter.ai/api/v1",
                      "apiKey": "${OPENROUTER_API_KEY}" }
    }
  }
}
```

Identity files (SOUL.md, AGENTS.md, etc.) are emitted under
`workspace/<agent-id>/` instead of the single `workspace/` root. The
[[ownership-layers]] map matches them via the new single-segment
wildcard pattern form (`workspace/*/SOUL.md`).

Profile-level cron jobs carry `agentId: <default>` so they route to the
default agent (`life-ops` for Sterling). Per-agent cron schedules are a
future enhancement.

## Routing semantics

OpenClaw's upstream router treats `agents.list[].model` as STRICT
unless the entry includes its own `fallbacks`. See
[/concepts/model-failover](https://docs.openclaw.ai/concepts/model-failover).
Concretely:

- **Bare string** (`model: "ollama/qwen2.5vl:32b-q4_K_M"`) — no
  fallback. On failure the turn errors out. Used by `vision` so image
  content never leaves the machine.
- **Object with fallbacks** — chain advances on auth failure, rate
  limit, overloaded, timeout, or billing-disabled. Context-overflow
  errors do NOT advance.
- **Omitted model** — the agent inherits `agents.defaults.model`
  entirely, including any global fallback chain.

## OpenRouter as "virtual VRAM"

OpenRouter's free tier carries `nvidia/nemotron-3-super-120b-a12b:free`
(262 K context) and `nvidia/nemotron-3-nano-30b-a3b:free` (256 K). Paid
calls to the same models are $0.09 / $0.45 per M tokens — pennies at a
solo-trader workload. Claude Opus 4.7 sits at the top of the chain
($5 / $25 per M, 1 M context) for genuine frontier reasoning that the
open models can't handle.

The trade is privacy vs. capability: traffic to OpenRouter leaves the
machine. Sterling's `markets` and `life-ops` agents have OpenRouter in
their fallback chains; `vision` does not. The decision is per-agent
and authorised by the user explicitly.

## What ClawHQ does for you

- **Egress firewall** — `openrouter.ai` auto-allowlisted whenever an
  agent references an `openrouter/...` model. See
  [[egress-firewall]].
- **Credentials** — `OPENROUTER_API_KEY` is treated as a standard
  secret (`.env` mode 0600, env-var interpolation at runtime). Set
  via `clawhq creds set OPENROUTER_API_KEY <key>`.
- **Provider config** — `models.providers.openrouter` is emitted
  automatically when any agent references `openrouter/...`. The
  compiler reads `REMOTE_PROVIDER_CONFIG` in `src/design/catalog/compiler.ts`.
- **Validation** — [[LM-15]] catches per-agent model strings whose
  provider isn't configured (typos, missing API keys).
- **Audit** — egress logs (`ops/audit/egress.jsonl`) capture every
  call to `openrouter.ai`. Per-turn provider/model is also in OpenClaw's
  `executionTrace.winnerModel` field — see [[per-agent-routing-spike]].

## Hot-swap budget on the 5090

`OLLAMA_MAX_LOADED_MODELS=1` plus three local models means cold-loads
dominate latency. Mitigations baked into the design:

- Only `life-ops` heartbeats locally; `markets` heartbeats hit
  OpenRouter (no local model load); `vision` is on-demand.
- Steady-state local rotation is mostly one model (`gpt-oss:20b` for
  hot path) plus the shared `agents.defaults.subagents.model`.
- Raise `OLLAMA_MAX_LOADED_MODELS` to 2 if benching shows two models
  fit concurrently without paging — separate decision, separate PR.

## Adding agents 4-N

The blueprint surface for adding a fourth agent is one entry in
`agents:` plus any pulls for new local models. The compiler handles
the rest: provider entries, ownership, workspace partition, cron
routing.

## See also

- [[blueprint-system]] — how profiles compile in general
- [[ownership-layers]] — five-layer ownership model
- [[egress-firewall]] — how providers get allowlisted
- [[openclaw-json-schema]] — the compiled-config target
