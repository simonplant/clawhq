# ClawHQ Roadmap

> What's built, what's next, and what gates each decision. See [STRATEGY.md](STRATEGY.md) for strategic context.

**Updated:** 2026-04-03

---

## What's Built

ClawHQ has a working CLI with 78 commands, ~67,000 lines of TypeScript, and 77 test files across all major subsystems. Built with AI-assisted development (Claude Code).

- **Blueprint engine** — 6 mission profiles (Life Ops, Development, Research, Trading, Home, Business Ops) × 4 personality presets (Direct Operator, Thoughtful Advisor, Warm Companion, Philosophical Guide), with guided and AI-powered setup, blueprint-specific customization questions. Published compositions include Email Manager, Hardened PA, Replace ChatGPT Plus, Founder's Ops, Family Hub, Research Co-pilot, Replace my PA.
- **Config generation** — all 14 known failure modes ("landmines") auto-prevented during setup
- **Full deploy pipeline** — two-stage Docker build, pre-flight checks, firewall, health verification, smoke tests
- **Container security** — hardened by default: `cap_drop: ALL`, read-only rootfs, non-root user, egress firewall with per-integration domain allowlists
- **Diagnostics** — `clawhq doctor` with 14+ checks and auto-fix, predictive health alerts, self-healing. Extends (not replaces) OpenClaw's built-in `openclaw doctor`
- **Skill system** — 6 built-in skills with sandboxed vetting and rollback
- **Workspace tools** — 7 CLI tool generators (email, tasks, todoist, iCal, market quotes, web search, todoist-sync)
- **Operational tooling** — encrypted backup/restore, safe updates with rollback, status dashboard, audit trail, log streaming
- **Agent lifecycle** — portable export with PII masking, verified destruction, approval queue, multi-channel notifications
- **AI-powered setup** — `clawhq init --smart` uses local Ollama to infer configuration from a natural-language description
- **Credential management** — separate `credentials.json` (mode 0600), health probes with expiry tracking
- **Memory lifecycle** — hot/warm/cold tiers, LLM-powered summarization, PII masking
- **Decision trace** — "why did you do that?" explanation system with preference learning
- **Configuration reference** — OPENCLAW-REFERENCE.md: the most comprehensive public mapping of OpenClaw's ~200+ field configuration surface

Separately: **Clawdius** — Simon's personal hardened OpenClaw agent, running in production via Docker/Telegram. This is the operational environment that generates the production knowledge everything else builds on.

---

## Now — Contribution-First Launch

Two parallel tracks: publish knowledge (reputation) and ship tools (utility). Neither waits for the other.

### Track 1: Publish (reputation engine)

**Publish the configuration reference.** OPENCLAW-REFERENCE.md is already the most comprehensive mapping of OpenClaw's configuration surface. Polish for public consumption and publish. Immediate authority signal.

**File upstream issues.** Take the 14 landmines and file them on `openclaw/openclaw` with reproduction steps, production evidence, and proposed fixes. Priority:
- Context pruning not enabled by default (208K-token silent death spiral)
- `bootstrapMaxChars` truncation with no warning
- Cron stepping syntax `5/15` silently invalid
- Identity drift across SOUL.md / IDENTITY.md / `identity.*` config
- Symlink escape silently drops workspace files

**Extract and publish 3 launch blueprints.** Standalone YAML/Markdown that works with stock OpenClaw — no ClawHQ CLI dependency. Each is a mission profile + personality composition. Start with the three most production-tested:
1. **Hardened Personal Assistant** — Life Ops profile + Direct Operator personality. The Clawdius config, generalized.
2. **Email Manager** — Life Ops profile (email-focused subset) + Direct Operator personality. The most commonly requested use case.
3. **Sovereign ChatGPT Replacement** — Research & Knowledge profile + Thoughtful Advisor personality. Honest about local-vs-cloud tradeoffs.

**Write the first article.** "14 Ways Your OpenClaw Agent Is Silently Broken." Each landmine documented with evidence. Launches the personal website content series.

**Publish the Persona Schema.** The 17-dimension, five-layer personality framework as a standalone spec. This is the most original intellectual contribution in the project — applicable beyond OpenClaw to any agent framework. It's what makes the personality preset axis rigorous (research-grounded dimensions across Big Five, HEXACO, Interpersonal Circumplex, Schwartz values, Haidt's Moral Foundations, SDT) instead of the community's current approach of prose paragraphs. Zero maintenance — a published spec doesn't break when upstream ships a new release. Publish as: standalone document, an article ("A Research-Grounded Framework for Agent Personality Design"), or both.

### Track 2: Ship (tool readiness)

**FEAT-018** — End-to-end smoke test. **The launch gate.** A security-focused project with an untested deploy pipeline is dead on arrival.

**FEAT-108** — Decompose 4,320-line CLI into per-command modules. Unblocks maintainability.

**BUG-125** — Doctor auto-fix: YAML parser instead of regex.

**FEAT-110** — Multi-instance support.

**Context pruning enforcement** — Default config always enables `contextPruning` with `mode: "cache-ttl"`. Doctor verifies it's active. This is effectively landmine #15.

---

## Next — Standards + Growth

After launch tracks complete. Contribution and product development continue in parallel.

### Contribution

**Blueprint specification.** Formalize the blueprint format as a human-readable spec. Structure, fields, validation rules, security constraints. Community conventions are forming (`soul.md` repo, OpenAgents.mom, skill `manifest.json` proposal) — publish before competing formats harden. Precondition: 3 published blueprints as worked examples.

**Upstream PRs.** Where filed issues lead to clear fixes, submit PRs. Priority: documentation improvements, configuration defaults, warning messages for silent failures.

**OpenClaw incident tracker.** Curated security advisory tracking for the ecosystem. Authority builder.

### Product

**Expand published compositions.** Each published blueprint is a mission profile + personality composition, and also a content piece — a deep-dive article explaining the configuration decisions and tradeoffs. Priority compositions after the launch three:
- Life Ops + Warm Companion (Family Hub)
- Life Ops + Philosophical Guide (Stoic PA — the full Clawdius)
- Trading & Finance + Direct Operator
- Development Partner + Thoughtful Advisor (DevOps/SRE)
- Business Ops + Direct Operator (Founder's Ops)
- Research & Knowledge + Philosophical Guide (Research with values filter)
- Multi-profile composition example: Life Ops + Trading + Research under one personality (the "one agent, many hats" pattern most users actually run)

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

- ~~Community blueprint marketplace~~ — 6 mission profiles × 4 personality presets, production-tested and composable. Community has 177 SOUL.md-only templates with no operational stack. Quality over quantity.
- ~~Managed hosting as primary business~~ — 10+ funded competitors. Different layer entirely.
- ~~Revenue before reputation~~ — Contribution first. Revenue follows traction.
- ~~One-time launch events as growth strategy~~ — Development-as-content compounds. Launch events decay.
- ~~Reimplementing the Control UI~~ — OpenClaw ships one. Compete on composition and lifecycle.
- ~~Wrapping upstream CLI commands~~ — Breaks on every release. Generate configs, don't wrap commands.

---

## Known Limitations

- **No distro installer yet** — users must clone the repo and build from source
- **Single machine only** — no multi-machine or cluster deployment
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
| GitHub stars on blueprint repo | Community finds blueprints useful | 200+ in 90 days, 500+ in 6 months |
| Upstream issues/PRs engaged | OpenClaw team recognizes the contributions | 5+ issues engaged, 2+ PRs merged in 90 days |
| Article reads | Content resonates | Lead article >5K reads |
| Community references | Others cite the work | 3+ references in community guides/tutorials in 6 months |
| Inbound inquiries | Authority converting to opportunity | Any consulting/advisory inbound by month 6 |
| Blueprint repo forks/usage | People actually using the configs | 50+ forks in 6 months |

**Honest check at 6 months:** Has this body of work created opportunities that wouldn't exist otherwise? If yes, continue and consider revenue experiments. If no, the thesis needs revision.
