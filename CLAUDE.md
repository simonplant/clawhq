# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Core Intent

Today you choose between **surveillance AI** (polished, easy, you own nothing) and **raw framework** (sovereign, powerful, requires months of expertise). Nobody makes the sovereign option usable. ClawHQ closes that gap.

**Market reality:** 2M+ people already chose sovereign AI — OpenClaw has 250K+ GitHub stars, 2M+ monthly active users, and 42,000+ exposed instances. The demand is proven. But most of those users are struggling: 9+ CVEs in the first 2 months, 20-36% of ClawHub skills found malicious, 14 silent config landmines, and most deployments abandoned within a month. 10+ hosting providers (Blink, xCloud, AWS Lightsail, DigitalOcean, etc.) are selling managed OpenClaw at $22-45/mo — but they deploy default-config agents with no lifecycle management. Nobody makes the sovereign option secure, correctly configured, and operationally viable. ClawHQ closes that gap.

**What ClawHQ is:** The sovereign operations platform for OpenClaw. It deploys, configures correctly, and personalizes agents — compiling blueprints into hardened, running systems. Identity, tools, skills, security, all compiled from high-level intent into flat runtime config. The user trusts ClawHQ with their agent. That trust is earned through integrity: open source, local-first, no data exfiltration, no dark patterns.

**The window is closing.** Not because big-tech AI will absorb features — because 10+ hosting providers are capturing the OpenClaw ecosystem right now. Every day ClawHQ is invisible, competitors commoditize deployment and capture mindshare. ClawHQ's role is to own the sovereignty layer — the one position no hosting provider can occupy — before the ecosystem consolidates around convenience-first platforms that treat security and lifecycle as afterthoughts.

**Three non-negotiables:**
1. **Data sovereignty** — local-first, zero bytes leave unless you choose, portable export, verified destroy
2. **Security by default** — hardening is automatic, not opt-in; content access architecturally blocked (no code path, not a policy flag)
3. **The agent grows** — skills, integrations, capabilities evolve over time through a validated pipeline; the agent at month 6 does more than at day 1

Every decision should be tested against this intent. If a feature doesn't make sovereignty more usable or security more invisible, question whether it belongs.

## Project Overview

ClawHQ deploys, configures, and personalizes OpenClaw agents. It compiles blueprints — complete operational designs — into hardened, running agents. Choose a blueprint ("Email Manager," "Stock Trading Assistant," "Meal Planner"), customize it, and ClawHQ forges the agent. The user gets a Signal, Telegram, or Discord UI. We do the rest.

Everything in OpenClaw is a file or API call. ClawHQ controls all of it programmatically.

**Current status: Active development.** Full CLI implementation with operational tooling. Key docs:
- `README.md` — Executive summary and positioning
- `docs/PRODUCT.md` — Product design: problem, profiles, blueprints, build order
- `docs/ARCHITECTURE.md` — Solution architecture: six modules, zero-trust remote admin
- `docs/OPENCLAW-REFERENCE.md` — Engineering reference: OpenClaw internals, 14 landmines, config surface

## Architecture

See `docs/ARCHITECTURE.md` for the full solution architecture.

**Three layers:**
- **Platform** (table stakes) — Install, harden, launch, ops. Same for every agent.
- **Blueprints** (THE PRODUCT) — Complete agent designs for specific jobs. ClawHQ compiles a blueprint into flat OpenClaw runtime config. No intermediate concepts survive compilation. The runtime is dumb by design; ClawHQ makes it smart.
- **Cloud** (optional infrastructure) — Remote monitoring, blueprint library. Managed hosting explicitly deprioritized — 10+ funded competitors already own that market. The self-hosted sovereignty position is the business.

**Six modules** (`design → build → secure → operate → evolve → cloud`):

| Module | What You're Doing | Directory |
|---|---|---|
| **design** | Choosing a blueprint, customizing, configuring | `src/design/` |
| **build** | Installing, compiling, deploying | `src/build/` |
| **secure** | Hardening, credentials, firewall, audit | `src/secure/` |
| **operate** | Monitoring, diagnosing, backing up, updating | `src/operate/` |
| **evolve** | Adding skills, growing capabilities, export, destroy | `src/evolve/` |
| **cloud** | Remote monitoring, managed hosting, fleet | `src/cloud/` |

**Remote admin:** Three trust modes — Paranoid (no cloud), Zero-Trust (agent-initiated, signed commands, user-approved), Managed (auto-approved ops, content architecturally blocked). See ARCHITECTURE.md.

## Architectural Decisions (locked — see ARCHITECTURE.md for full rationale)

- **AD-01: One binary, flat CLI** — `clawhq` is a single install with flat commands (`clawhq doctor`, not `clawhq operate doctor`). Modules are internal source organization, never user-facing.
- **AD-02: Unix philosophy in agent tools, not in ClawHQ** — `email`, `calendar`, `tasks`, `quote` are small composable workspace tools. Blueprints compose them. ClawHQ is the orchestrator.
- **AD-03: Tight coupling to OpenClaw** — No abstraction layer. Direct use of TypeBox schema, WebSocket RPC, file paths.
- **AD-04: TypeScript monorepo, single package** — One npm package. Module boundaries via barrel exports and directory structure.
- **AD-05: Security is architecture, not policy** — Content access in managed mode is architecturally blocked (no handler exists), not policy-blocked.

## Terminology

Canonical terms — use these consistently:

| Concept | Term | NOT |
|---|---|---|
| Agent designs (YAML) | **blueprint** | template, recipe, profile |
| What ClawHQ does with them | **forge** / **configure** | cook, bake, assemble |
| What gets produced | **agent** | claw, deployment |
| The setup flow | **setup** / **init** | cooking, forging process |
| Blueprint-specific questions | **customization** | personalization |
| ClawHQ itself | **agent platform** | distro, configuration layer |
| The product layers | **Platform / Blueprints / Cloud** | Distro / Template Engine / Cloud Service |
| The six modules | **design, build, secure, operate, evolve, cloud** | ClawSmith, ClawForge, ClawAdmin, ClawOps, ClawConstruct |
| Tool+skill+integration bundle (planned) | **capability** | role, job, function |
| Agent tone customization | **soul_overrides** | personality settings, persona config |

## Key Design Constraints

- **All changes go through ClawHQ — never touch OpenClaw directly.** Every change to a running OpenClaw instance (config, credentials, tools, identity files, cron, .env, workspace files) MUST flow through a `clawhq` command. No `echo >> .env`, no `cp tool workspace/`, no `docker exec` edits. If ClawHQ lacks the capability for a needed change, stop — implement the capability in ClawHQ first, then use it. Direct edits get overwritten by `clawhq apply`, create drift between ClawHQ's model and deployed state, and can't be reproduced. This applies during development and testing, not just in production.
- **ClawHQ is the install** — Users don't install OpenClaw separately
- **Two acquisition paths** — Trusted cache (signed) or from source (zero-trust)
- **Security by default** — Container hardening applied automatically via 3-tier posture system (minimal/hardened/under-attack, default: hardened). Hardened includes gVisor runtime (when available), egress firewall auto-enable, and chattr +i on identity files. Under-attack adds air-gapped network, noexec tmpfs, and 10s healthchecks
- **Config generation must be correct** — All 14 landmines auto-handled
- **Identity files are read-only** — 8 workspace identity files (including BOOTSTRAP.md) are immutable; agents cannot modify their own personality
- **Credentials secured** — `credentials.json` mode 0600, `.env` mode 0600, never in config files
- **Data sovereignty** — Full portability (`export`), thorough deletion (`destroy` with receipt), zero lock-in
- **Same platform everywhere** — User's PC, Mac Mini, DigitalOcean, Hetzner — same software, different host

## CLI Commands

```
# Install
clawhq install                — Full platform install (pre-reqs, engine, scaffold)
clawhq install --from-source  — Zero-trust: clone, audit, build from source

# Design
clawhq init --guided          — Interactive setup → choose blueprint, connect services
clawhq init --smart           — AI-powered config inference (local Ollama)
clawhq blueprint list         — Browse available blueprints
clawhq blueprint preview      — Preview a blueprint's operational design

# Build
clawhq build                  — Two-stage Docker build with change detection + manifests

# Secure
clawhq scan                   — Secret scanning via gitleaks (recommends install)
clawhq creds                  — Credential health probes
clawhq audit                  — Tool execution + egress audit trail (append-only JSONL)

# Deploy
clawhq up / down / restart    — Deploy with preflight, firewall, health, verify, smoke test
clawhq up --skip-verify       — Skip post-deploy integration verification
clawhq up --skip-firewall     — Skip egress firewall (diagnostic mode)
clawhq verify                 — Verify all integrations work from inside container
clawhq connect                — Connect messaging channel

# Operate
clawhq doctor [--fix]         — Preventive diagnostics (30+ checks) with auto-fix
clawhq status [--watch]       — Single-pane dashboard
clawhq backup create/list/restore — Encrypted snapshots
clawhq update [--check]       — Update with change intelligence + migration plan
clawhq update --channel <ch>  — Override channel (security/stable/latest/pinned)
clawhq update --dry-run       — Show migration plan without applying
clawhq logs                   — Stream agent logs

# Evolve
clawhq skill install <source> — Install skill (with security vetting)
clawhq skill update/remove    — Update or remove installed skill
clawhq skill list             — List installed skills
clawhq evolve                 — Manage agent capabilities
clawhq export                 — Export portable agent bundle
clawhq destroy                — Agent destruction with deletion receipt

# Cloud (optional)
clawhq cloud connect          — Link to clawhq.com for remote monitoring
clawhq cloud status           — Remote health dashboard
```

## Implementation Notes

- `docs/PRODUCT.md` — Product bible: user stories organized by module (design, build, secure, operate, evolve, cloud)
- `docs/ARCHITECTURE.md` — Architecture: six modules, ADs, zero-trust remote admin, package structure
- `docs/OPENCLAW-REFERENCE.md` — Engineering reference: OpenClaw internals, 14 landmines, config surfaces
- `backlog/GAP-ANALYSIS.md` — AS-IS/TO-BE comparison, 10 gaps identified
- `backlog/backlog.json` — Sprint-ready backlog, 6 parallel tracks

Key technical details:
- TypeScript throughout — matches OpenClaw's Node.js/TypeBox stack, shares schema types directly
- Tight coupling to OpenClaw — uses its config schema, WebSocket RPC, file paths, and container structure directly
- Deployment directory at `~/.clawhq/` — engine, workspace, ops, security, cron, cloud
- Two-stage Docker build: Stage 1 (base OpenClaw + apt packages), Stage 2 (custom tools + skills)
- Egress firewall uses dedicated iptables chain (`CLAWHQ_FWD`) on Docker bridge with port-aware rules and auto-detection of configured integrations from .env
- Closed-loop deploy: `clawhq up` verifies every integration works from inside the container (credential probes + network reachability + LLM response time)
- `doctor` is the hero feature — checks every known failure mode preventively
- Blueprints are complete agent designs (identity, security, tools, skills, cron, autonomy, memory, integrations)
- OpenClaw uses CalVer versioning: `vYYYY.M.PATCH` (e.g. v2026.4.12). Earlier versions used semver (v0.8.x). ClawHQ's CalVer module handles both.
- Update intelligence: `clawhq update --check` shows deployment-specific impact analysis (upstream commits, breakage predictions, migration plan, recommendation). Versioned config migrations auto-apply during `clawhq update`. Blue-green deploy keeps the agent alive during updates.

## Key Source Layout

```
src/
├── cli/                        — Commander.js CLI (thin layer over modules)
│
├── design/                     — Blueprint engine (THE PRODUCT)
│   ├── blueprints/             — Blueprint library, loader, mapper, customizer
│   ├── configure/              — Setup wizard, generate, writer
│   ├── tools/                  — CLI tool generators (email, calendar, tasks, etc.)
│   └── identity/               — Identity file generators (AGENTS.md, HEARTBEAT.md, etc.)
│
├── build/                      — Install and deploy
│   ├── installer/              — Pre-reqs, engine acquisition, scaffold
│   ├── docker/                 — Two-stage build, compose, Dockerfile gen, binary integrity
│   └── launcher/               — Deploy orchestration (up/down/restart), verify, firewall
│
├── secure/                     — Security and compliance
│   ├── sanitizer/              — Tier 1 prompt injection detection (deterministic patterns only)
│   ├── credentials/            — Credential store + health probes + credential proxy
│   └── audit/                  — Append-only JSONL audit logging (tool, secret, egress)
│
├── operate/                    — Monitoring and maintenance
│   ├── doctor/                 — Diagnostics + auto-fix
│   ├── monitor/                — Health monitoring daemon
│   ├── backup/                 — Encrypted backup/restore
│   ├── updater/                — Update intelligence (change analysis, migrations, channels)
│   ├── status/                 — Dashboard
│   └── logs/                   — Log streaming
│
├── evolve/                     — Grow the agent
│   ├── skills/                 — Skill install/update/remove + vetting
│   ├── capabilities/           — Capability evolution
│   ├── rollback/               — Change rollback
│   └── lifecycle/              — Export + destroy
│
├── cloud/                      — Remote monitoring + managed hosting
│   ├── agentd/                 — Managed mode daemon
│   ├── heartbeat/              — Health reporting
│   ├── commands/               — Command queue (pull, verify, execute)
│   ├── fleet/                  — Multi-agent management
│   └── provisioning/           — Cloud instance provisioning engine
│       └── providers/          — Provider adapters (DigitalOcean)
│
├── web/                        — Web dashboard (Hono + htmx, CQ-040)
│   ├── pages/                  — 7 dashboard pages (doctor, logs, approvals, init, etc.)
│   └── server.tsx              — Hono server + layout
│
├── gateway/                    — OpenClaw Gateway communication (cross-cutting)
└── config/                     — Config types + schema (cross-cutting)
```

**Cross-module security code:** Some security concerns live outside `src/secure/`, co-located with their operational context:
- Container hardening (posture) → `src/build/docker/posture.ts`
- Egress firewall (iptables CLAWHQ_FWD, port-aware) → `src/build/launcher/firewall.ts`
- Post-deploy integration verification → `src/build/launcher/verify.ts`
- Binary integrity (SHA256 verification) → `src/build/docker/integrity.ts`
- Landmine validation (14 rules) → `src/config/validate.ts`
- Update intelligence (change analysis, migrations) → `src/operate/updater/`
- CalVer version parsing (shared) → `src/operate/updater/calver.ts`

**Note:** Current source layout differs from target in other modules. The module reorganization is planned work (Track E).


<!-- This section is managed by aishore and will be overwritten on `aishore update`. -->
<!-- Customizations here will be lost. Add project-specific instructions above this section. -->

<!-- This section is managed by aishore and will be overwritten on `aishore update`. -->
<!-- Customizations here will be lost. Add project-specific instructions above this section. -->

<!-- This section is managed by aishore and will be overwritten on `aishore update`. -->
<!-- Customizations here will be lost. Add project-specific instructions above this section. -->

<!-- This section is managed by aishore and will be overwritten on `aishore update`. -->
<!-- Customizations here will be lost. Add project-specific instructions above this section. -->

<!-- This section is managed by aishore and will be overwritten on `aishore update`. -->
<!-- Customizations here will be lost. Add project-specific instructions above this section. -->
## Sprint Orchestration (aishore)

This project uses aishore for autonomous sprint execution. Backlog lives in `backlog/`, tool lives in `.aishore/`.

**Agent rules (mandatory):**
- **Core before features.** The working core — the primary end-to-end path — must pass before feature work proceeds. Check the item's `track` field: `core` items build the foundation; `feature` items decorate it.
- **Intent is the north star.** Every item has a commander's intent field. When steps or AC are ambiguous, follow intent.
- **Prove it runs.** Wire code to real entry points. If the build command exists, run it. If a verify command exists, execute it. Working code that's reachable beats tested code that's isolated.
- **No mocks or stubs** in production code unless the item explicitly requests them.
- **Stay in scope.** Implement only the assigned item. Don't fix unrelated code, add unrequested features, or refactor surrounding code.
- **Commit before signaling.** Always commit with a meaningful message before writing result.json.

```bash
.aishore/aishore run [N|ID|scope]    # Run sprints (scope: done, p0, p1, p2)
.aishore/aishore groom              # Groom backlog items
.aishore/aishore scaffold           # Establish working core, detect fragment risk
.aishore/aishore review             # Architecture review
.aishore/aishore status             # Backlog overview
```


---

# Wiki (Due Diligence)

## What this is

This is an LLM-maintained wiki. You build and maintain a structured, interlinked collection of markdown files based on raw source documents provided by the user. The user curates sources, directs analysis, and asks questions. You do the summarizing, cross-referencing, filing, and bookkeeping.

## Directory structure

```
knowledge/raw/            # Immutable source documents. Never modify these.
knowledge/  assets/       # Images and media referenced by sources.
knowledge/wiki/           # LLM-generated markdown pages. You own this entirely.
knowledge/index.md        # Catalog of all wiki pages — links, one-line summaries, organized by category.
knowledge/log.md          # Append-only chronological record of operations.
```

## Operations

### Ingest

When the user provides a new source:

1. Read the source fully.
2. Discuss key takeaways with the user.
3. Create or update a summary page in `knowledge/wiki/`.
4. Update all relevant entity/concept pages across the wiki with new information.
5. Update `knowledge/index.md` with any new or changed pages.
6. Append a log entry to `knowledge/log.md`.

A single source may touch 10-15 wiki pages. Update cross-references (`[[Page Name]]`) wherever connections exist.

### Query

When the user asks a question:

1. Read `knowledge/index.md` to find relevant pages.
2. Read those pages and synthesize an answer with citations.
3. If the answer is substantial (comparisons, analyses, discoveries), offer to file it as a new wiki page so it compounds in the knowledge base.

### Lint

When asked to health-check the wiki:

- Flag contradictions between pages.
- Identify stale claims superseded by newer sources.
- Find orphan pages (no inbound links).
- Note concepts mentioned but lacking their own page.
- Suggest missing cross-references.
- Suggest new questions or sources to investigate.

## Wiki page conventions

- One company, market, or risk factor per page.
- Use [[Wiki Links]] for cross-references between pages.
- Always cite the source page when stating a claim — e.g. (see [[Source Title]]).
- Note confidence level: verified, reported, estimated, speculative.
- Flag when data is stale — include last-verified date in frontmatter.
- When sources disagree, document both positions and the evidence for each.
- Prefer updating existing pages over creating new ones when the topic overlaps.

Pages can include YAML frontmatter with these fields: `tags`, `date`, `source-count`, `confidence`, `last-verified`.

## index.md format

Each entry: `- [[Page Name]] — one-line summary`. Organized under category headings (Companies, Markets, Risks, Sources, Comparisons).

## log.md format

Each entry starts with a parseable heading:

```
## [YYYY-MM-DD] operation | Title
```

Operations: `ingest`, `query`, `lint`. This format supports `grep "^## \[" knowledge/log.md | tail -5` for quick review.

## Key principles

- Raw sources are immutable. Never modify files in `knowledge/raw/`.
- The wiki is yours to write and maintain. Create, update, and reorganize freely.
- Always update cross-references when adding new information.
- File valuable query answers back into the wiki so explorations compound.

## CLI tools

If `llm-wiki` is installed, these commands are available:

- `llm-wiki lint` — structural checks (broken links, orphans, index drift). Run after making changes.
- `llm-wiki lint --fix` — auto-fix fixable issues (missing frontmatter, stale index entries, empty pages).
- `llm-wiki ingest <files...>` — stage source files into `raw/` with standardized naming. Accepts multiple files.
- `llm-wiki stats` — wiki health dashboard (page count, link density, recent activity).
- `llm-wiki context` — generate a compact wiki briefing (size, unprocessed sources, issues, recent changes, index summary). This runs automatically at session start via the SessionStart hook.
- `llm-wiki doctor` — validate entire wiki setup (structure, schema, skills, hooks, git, lint).
- `llm-wiki diff` — show what changed since last operation (git-aware, grouped by layer).

## Context loading

This schema is always loaded at session start — it contains the rules you need in every conversation. The wiki pages in `knowledge/wiki/` are loaded on demand — read `knowledge/index.md` first, then drill into specific pages as needed. Don't read every page upfront; navigate via the index.

## Skills

If Claude Code skills are configured (`.claude/commands/`), these guided workflows are available:

- `/wiki-ingest` — full ingest workflow: read source, discuss, create wiki pages, update cross-references.
- `/wiki-query` — query the wiki: find pages, synthesize answer, optionally file it.
- `/wiki-review` — content-level health check: contradictions, stale claims, gaps.
