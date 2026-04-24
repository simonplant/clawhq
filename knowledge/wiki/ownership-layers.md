---
title: Ownership layers
category: Decisions
status: active
date: 2026-04-23
tags: [clawhq, architecture, boundaries, multi-tenancy, concept]
---

# Ownership layers

Every path, process, and piece of state in a ClawHQ installation belongs to
exactly one of five ownership layers. Boundary clarity depends on this — when
work blurs two layers, ops metadata ends up inside agent workspaces, fleet
registries go unused, and commands default to a singleton that silently shadows
other instances. Before editing code or filing a backlog item, name the layer.

> This complements the three-layer feature stack in `docs/ARCHITECTURE.md`
> (Platform · Blueprints · Cloud). Those describe **what ClawHQ does for
> you**. The layers below describe **what lives where and who owns it**.

## The five layers

| # | Layer | What it is | Lives at | Owned by |
|---|-------|------------|----------|----------|
| 1 | **ClawHQ code** | The `clawhq` CLI itself — source, tests, build artifacts, published npm package | `src/`, `dist/`, repo root | ClawHQ maintainers; shipped as one binary |
| 2 | **ClawHQ runtime state** | Metadata *about* the instances ClawHQ manages — registries, logs, audit trails, operational snapshots | `~/.clawhq/cloud/*.json` today; target `~/.clawhq/instances/<id>/ops/` | ClawHQ; never part of the agent |
| 3 | **OpenClaw upstream engine** | The agent runtime software ClawHQ deploys and configures | Docker image (`openclaw/*`); not in this repo | Upstream project; unmodified per AD-03 |
| 4 | **A managed agent (one instance)** | A specific running agent — its blueprint, identity, credentials, content, container(s) | `${deployDir}/engine/`, `${deployDir}/workspace/`, `${deployDir}/security/`, `${deployDir}/cron/` | That specific agent; belongs to the user, read-only to ClawHQ code |
| 5 | **Fleet (N agents on a host)** | ClawHQ managing multiple Layer-4 instances | `~/.clawhq/cloud/fleet.json` (registry); iteration in CLI commands | ClawHQ; target: every lifecycle command is fleet-aware |

## Rules

1. **ClawHQ code (Layer 1) never writes to agent runtime files (Layer 4) at
   runtime.** The compiler writes at `apply` time. Lifecycle commands read
   state and invoke Docker; they do not touch identity files, workspace
   content, or credentials outside their defined operations.

2. **Agent runtime (Layer 4) never holds ClawHQ operational metadata (Layer
   2).** Doctor snapshots, monitor logs, backup snapshots, audit trails,
   updater rollback state — all Layer 2. The agent's `${deployDir}/` should
   contain only what the agent needs to run: config, identity, content,
   credentials, container definitions, cron jobs. Today this is blurred (see
   [[phantom-multi-tenancy]]).

3. **There is no singleton "the agent".** Every lifecycle command must
   resolve an instance id before acting. Today most commands default to a
   single deployment via directory walk-up; that default must become an
   error when ambiguous, and every command must accept `--agent <name>` or
   iterate the fleet registry with `--fleet`.

4. **"Clawdius" is a Layer 4 choice, not a Layer 1 concept.** The word names
   a specific agent instance the user (Simon) happens to run. It must never
   appear in ClawHQ source code. Comments referencing past Clawdius
   incidents are fine; structural dependencies on the name are not.

5. **Identity templates are Layer 2; identity files are Layer 4.** Today the
   compiler generates `workspace/SOUL.md`, `workspace/AGENTS.md`, etc. with
   no separate template storage — templates and compiled outputs share a
   directory. Target: templates live in `~/.clawhq/templates/identity/`
   (Layer 2), compiled read-only files live in `workspace/*.md` (Layer 4).

## How to apply this

**When starting work on a backlog item or a fix, state the layer
explicitly.** Example:

> "FEAT-187 touches Layer 1 (CLI command signatures) and Layer 5 (fleet
> resolution). It does not touch Layer 4 — no change to how a single agent
> is stored."

If a change crosses layers, call out the boundary and justify it. Most
cross-layer work should be rare and deliberate; if you find yourself reaching
across layers often, that is a signal the abstraction is wrong.

**When reviewing code, ask "which layer does this touch?"** If the answer
is "several," ask whether the code can be split so each piece owns one
layer.

## Current boundary violations

See [[phantom-multi-tenancy]] for the concrete list of places the code
today does not respect these layers — container name fallback, ops state
under `${deployDir}/`, singleton CLI resolution, unwired fleet registry.

## Related

- [[phantom-multi-tenancy]] — the current gap between this model and the code
- [[blueprint-system]] — blueprints are the Layer 2 → Layer 4 compilation step
- [[workspace-as-agent]] — why Layer 4 is the agent
- [[files-are-the-agent]] — files are the interface, not a detail

## See also

- `docs/ARCHITECTURE.md` — the three-layer feature stack (Platform ·
  Blueprints · Cloud), which is orthogonal to this page
- `src/config/ownership.ts` — per-path ownership classifier (today operates
  within Layer 4; should be extended to route Layer-2 concerns out of
  `${deployDir}/`)
