# ClawHQ Roadmap

> What's built, what's next, and what gates each decision. See [STRATEGY.md](STRATEGY.md) for strategic context.

**Updated:** 2026-04-23

---

## What's Built

ClawHQ has a working CLI, ~90,000 lines of TypeScript across ~400 source files, and 113 test files (2168 tests, all passing). Built with AI-assisted development (Claude Code). **Pre-launch: all code works but has zero external users. Community validation begins at publication.**

- **Blueprint engine** — 11 working blueprints (Email Manager, Family Hub, Founder's Ops, Research Co-pilot, Content Creator, Personal Finance Assistant, Stock Trading Assistant, Stoic Coach, Replace ChatGPT Plus, Replace Google Assistant, Replace my PA) with guided and AI-powered setup. The composition model (mission profile × providers) is live: `clawhq init --guided` picks a profile, applies the canonical ClawHQ personality, then compiles both plus the chosen provider per category into a flat OpenClaw runtime config. `clawhq apply` regenerates from the resulting `clawhq.yaml` idempotently.
- **Multi-instance host support** — Unified instance registry at `~/.clawhq/instances.json` (uuid-keyed, local + cloud in one file). Every `clawhq init` mints a stable `instanceId` and writes it into `clawhq.yaml`. Every lifecycle command resolves via `--agent <name|id-prefix>` → `CLAWHQ_AGENT` env → `~/.clawhq/current` pointer → cwd walk-up → single-default; ambiguity errors loudly with the list of registered names. `--fleet` iterates every registered agent and aggregates results. Docker containers named `openclaw-<shortId>` deterministically. Ops state at `~/.clawhq/instances/<id>/ops/`. Optional Layer-2 identity fragment overrides at `~/.clawhq/templates/identity/`. One-shot idempotent bootstrap migration folds legacy `cloud/fleet.json` + `cloud/instances.json`.
- **Config generation** — all 14 known failure modes ("landmines") auto-prevented during setup
- **Full deploy pipeline** — two-stage Docker build, pre-flight checks, firewall, health verification, smoke tests
- **Container security** — hardened by default: `cap_drop: ALL`, read-only rootfs, non-root user, egress firewall with per-integration domain allowlists
- **Diagnostics** — `clawhq doctor` with 40 checks and auto-fix, predictive health alerts, self-healing, and `--fleet` aggregation. Extends (not replaces) OpenClaw's built-in `openclaw doctor`
- **Skill system** — 6 built-in skills with sandboxed vetting and rollback
- **Workspace tools** — 7 CLI tool generators (email, tasks, todoist, iCal, market quotes, web search, todoist-sync)
- **Operational tooling** — encrypted backup/restore, safe updates with rollback, status dashboard, audit trail, log streaming
- **Agent lifecycle** — portable export with PII masking, verified destruction, approval queue, multi-channel notifications
- **AI-powered setup** — `clawhq init --smart` uses local Ollama to infer configuration from a natural-language description
- **Credential management** — separate `credentials.json` (mode 0600), health probes with expiry tracking
- **Memory lifecycle** — hot/warm/cold tiers, LLM-powered summarization, PII masking
- **Decision trace** — "why did you do that?" explanation system with preference learning
- **Configuration reference** — OPENCLAW-REFERENCE.md: the most comprehensive public mapping of OpenClaw's ~200+ field configuration surface

Separately: the author runs a personal hardened OpenClaw agent in production via Docker/Telegram. This is the operational environment that generates the production knowledge everything else builds on.

---

## Now — Contribution-First Launch

Two parallel tracks: publish knowledge (reputation) and ship tools (utility). Neither waits for the other.

### Sequencing (what unblocks what)

The launch track has dependencies. This is the order that makes sense:

1. **Join the OpenClaw Discord** — Engage with existing discussions, help people, build recognized presence. This is the relationship-building step before filing issues or publishing blueprints. Don't skip it.
2. **Publish the configuration reference** — OPENCLAW-REFERENCE.md polished and published. Immediate authority signal.
3. **Stand up the personal website** — Static site with markdown posts. The content distribution strategy depends on this. Doesn't need to be fancy — needs to exist.
4. **Extract the first blueprint** — Chief of Staff / Daily Briefing (LifeOps profile). The #1 adoption cohort. Morning brief, email triage, calendar management, task coordination. Validate that composition doesn't exceed the 8-file context budget (20K per file, 150K aggregate).
5. **Write the first article** — Grounded in the blueprint extraction and production evidence.
6. **File upstream issues** — From a position of community presence, spaced out, not batched.
7. **Remaining blueprints and code work** — In parallel after the above.

### Track 1: Publish (reputation engine)

**Publish the configuration reference.** OPENCLAW-REFERENCE.md is already the most comprehensive mapping of OpenClaw's configuration surface. Polish for public consumption and publish. Immediate authority signal.

**File upstream issues.** Take the 14 landmines and file them on `openclaw/openclaw` with reproduction steps, production evidence, and proposed fixes. Priority:
- Context pruning not enabled by default (208K-token silent death spiral)
- `bootstrapMaxChars` truncation with no warning
- Cron stepping syntax `5/15` silently invalid
- Identity drift across SOUL.md / IDENTITY.md / `identity.*` config
- Symlink escape silently drops workspace files

**Extract and publish 3 launch blueprints.** Standalone YAML/Markdown that works with stock OpenClaw — no ClawHQ CLI dependency. Ordered by adoption demand, not personal usage:
1. **Chief of Staff / Daily Briefing** — LifeOps profile. The #1 adoption cohort. Morning brief, email triage, calendar management, task coordination. Categories: email (himalaya), calendar (khal/vdirsyncer), tasks (Todoist default, user picks), weather (Open-Meteo), research (Tavily). User picks providers during setup — same tool interface regardless.
2. **Content Engine** — Marketing profile. Widest adoption category. Social cross-posting, newsletter drafting, content calendar. Categories: social (X/LinkedIn/Reddit), research (Tavily), notes (Obsidian/Notion). Includes content-specific skills.
3. **Dev Workflow** — Dev profile. Highest satisfaction, natural fit for self-hosted community. Categories: code (GitHub/GitLab), CI/CD (GitHub Actions), errors (Sentry), tasks (Linear/GitHub Issues). Includes dev-specific skills.

**Then:** A multi-profile showcase (LifeOps + Markets + Research) as the #4 "power user" blueprint — demonstrates the "one agent, many hats" pattern. **Validation needed:** confirm multi-profile composition doesn't exceed `bootstrapMaxChars` (20K per file, 150K aggregate).

**Write the first article.** "14 Ways Your OpenClaw Agent Is Silently Broken." Each landmine documented with evidence. Launches the personal website content series.

### Track 2: Ship (tool readiness)

**FEAT-018** — End-to-end smoke test. **The launch gate.** A security-focused project with an untested deploy pipeline is dead on arrival.

**FEAT-108** — Decompose 4,320-line CLI into per-command modules. Unblocks maintainability.

**BUG-125** — Doctor auto-fix: YAML parser instead of regex.

**Context pruning enforcement** — Default config always enables `contextPruning` with `mode: "cache-ttl"`. Doctor verifies it's active. This is effectively landmine #15.

---

## Next — Standards + Growth

After launch tracks complete. Contribution and product development continue in parallel.

### Contribution

**Blueprint specification.** Formalize the blueprint format as a human-readable spec. Structure, fields, validation rules, security constraints. Community conventions are forming (`soul.md` repo, OpenAgents.mom, skill `manifest.json` proposal) — publish before competing formats harden. Precondition: 3 published blueprints as worked examples.

**Upstream PRs.** Where filed issues lead to clear fixes, submit PRs. Priority: documentation improvements, configuration defaults, warning messages for silent failures.

**OpenClaw incident tracker.** Curated security advisory tracking for the ecosystem. Authority builder.

### Product

**Extend the composition model.** The composition model (mission profile × per-category providers, one canonical personality) is live for 5 profiles — life-ops, trading, research, home-auto, dev-partner — compiled through `src/design/catalog/compiler.ts`. The 11 monolithic blueprints remain as the top-level "pick a use case" surface; refactoring them to compile down to profile+skill compositions continues. Domain-specific behavior lives in skills and operational playbooks (AGENTS.md), not in personality config.

**Expand the skill library.** Skills carry the real domain behavior — how the agent drafts outreach, structures reports, triages email, runs morning briefs. Each profile needs 2-5 skills that encode domain-specific workflows. This is where the product differentiation actually lives, not in personality.

**Expand published compositions.** Each published blueprint is a stack of a-la-carte mission profiles, and also a content piece — a deep-dive article explaining the configuration decisions and tradeoffs. Priority compositions after the launch three:
- LifeOps + Markets + Research (multi-profile power user — one agent, many hats)
- LifeOps (Family Hub — warmth slider turned up)
- Markets (Trading desk)
- LifeOps + Sales + Marketing (Founder's Ops)
- Research (research/intel)
- LifeOps + Dev + Marketing (Solo builder — the indie hacker stack)
- SiteOps + Marketing (Web presence on autopilot)
- Health + LifeOps (Wellness tracker)

**Identity coherence.** Triple-identity-sync across SOUL.md, IDENTITY.md, and `identity.*` in config. 8-file budget management (detecting `bootstrapMaxChars` approach/truncation). Staleness detection, contradiction flagging across workspace files.

**Auth profile generation.** Blueprints emit correct multi-profile auth configurations with provider failover chains. Currently unaddressed — real config complexity users get wrong.

**ClawWall content sanitization.** Security-by-default prompt injection defense.

**SHA256 binary pinning.** Supply chain security for Docker builds.

**Model routing per cron job.** Cost-efficient model selection per task.

---

## Later — Gated Behind Evidence

These ideas stay alive. Each has a specific traction signal that triggers investment. Don't build speculatively.

| Idea | Gate | Signal Required |
|---|---|---|
| **Sentinel monitoring** | Community explicitly asks for upstream intelligence (config breakage prediction, CVE mapping, skill reputation) | 10+ expressed interest after 6 months of free tools/content |
| **Premium blueprints** | Free blueprints prove valued | 500+ stars on blueprint repo, community references |
| **Consulting/advisory** | Reputation creates inbound | Any consulting inquiry from content/contributions |
| **Web dashboard** | Need identified beyond OpenClaw's built-in Control UI | Community request for composition/lifecycle UI, not config editing |
| **1Password integration** | Users hitting credential management pain | Multiple requests or issues around secret management |
| **Construct meta-skill** | Core agent lifecycle solid, users want autonomous improvement | Blueprinted agents running stably for 90+ days |
| **Distro installer** | Enough users that repo-clone is a friction point | 50+ installs from source |
| **Memory plugin awareness** | Users running QMD/Cognee/Mem0 hit lifecycle management gaps | Community reports of management issues with non-default backends |

---

## Kill List

Decisions made. Do not revisit unless the underlying assumption is disproven.

- ~~Community blueprint marketplace~~ — 10 a-la-carte mission profiles with complete operational stacks, production-tested. Community has 177 SOUL.md-only templates with no tools, skills, or security. Quality over quantity.
- ~~Personality as a product axis~~ — 95% of users want the same thing: competent and terse. One professional default tone + soul_overrides for the rest. Domain behavior lives in skills and playbooks, not personality.
- ~~Managed hosting as primary business~~ — 10+ funded competitors. Different layer entirely.
- ~~Revenue before reputation~~ — Contribution first. Revenue follows traction.
- ~~One-time launch events as growth strategy~~ — Development-as-content compounds. Launch events decay.
- ~~Reimplementing the Control UI~~ — OpenClaw ships one. Compete on composition and lifecycle.
- ~~Wrapping upstream CLI commands~~ — Breaks on every release. Generate configs, don't wrap commands.

---

## Known Limitations

- **Persona Schema deprioritized** — `docs/PERSONA-SCHEMA.md` is a dead link. Personality is not a product axis — one professional default ships with all blueprints. The Persona Schema may publish as an academic contribution later, but it doesn't block or inform the product.
- **No publishable blueprints yet** — 7 monolithic blueprints exist in the codebase. Zero are extractable as standalone configs for stock OpenClaw without generalization and testing work.
- **Personal website doesn't exist yet** — Content distribution strategy depends on it. SITE_PLAN.md exists. The site doesn't. Static markdown site is sufficient but must exist before first article publishes.
- **No distro installer yet** — users must clone the repo and build from source
- **Single-machine only** — multi-agent on one host works (unified instance registry + `--agent`/`--fleet`), but multi-machine/cluster deployment is out of scope
- **Linux and macOS only** — Windows requires WSL
- **Docker required** — no bare-metal option
- **Web dashboard scaffolded, not built out** — Hono server runs but UI components pending. Must differentiate from OpenClaw's built-in Control UI on composition and lifecycle, not config editing.
- **Guided config overlaps with upstream** — `openclaw onboard` and `openclaw configure` exist. ClawHQ's differentiation is blueprint-level composition + security + lifecycle.
- **Memory lifecycle assumes default backend** — Hot/warm/cold tier management built for `memory-core`. Users on QMD, Cognee, or Mem0 will need adapted management.
- **Auth profile generation not yet implemented** — Blueprints don't emit multi-profile auth with provider failover chains.

---

## How Progress Is Measured

| Signal | What It Means | Target |
|---|---|---|
| GitHub stars on blueprint repo | Community finds blueprints useful | 100+ in 90 days (cold start — zero existing presence) |
| Upstream issues/PRs engaged | OpenClaw team recognizes the contributions | 5+ issues engaged, 2+ PRs merged in 90 days |
| Article reads | Content resonates | Lead article >3K reads |
| Community references | Others cite the work | 3+ references in community guides/tutorials in 6 months |
| Inbound inquiries | Authority converting to opportunity | Any consulting/advisory inbound by month 6 |
| Blueprint repo forks/usage | People actually using the configs | 25+ forks in 6 months |

**Honest check at 6 months:** Has this body of work created opportunities that wouldn't exist otherwise? If yes, continue and consider revenue experiments. If no, the thesis needs revision.
