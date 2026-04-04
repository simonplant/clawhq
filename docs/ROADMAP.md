# ClawHQ Roadmap

> What's built, what's next, and what gates each decision. See [STRATEGY.md](STRATEGY.md) for strategic context.

**Updated:** 2026-04-03

---

## What's Built

ClawHQ has a working CLI with 78 commands, ~67,000 lines of TypeScript, and 77 test files across all major subsystems. Built with AI-assisted development (Claude Code).

- **Blueprint engine** — 7 use-case blueprints (Email Manager, Family Hub, Founder's Ops, Replace Google Assistant, Replace ChatGPT Plus, Replace my PA, Research Co-pilot) with guided and AI-powered setup, blueprint-specific customization questions
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

**Extract and publish 3 launch blueprints.** Standalone YAML/Markdown that works with stock OpenClaw — no ClawHQ CLI dependency. Start with the three most production-tested:
1. **Hardened Personal Assistant** — the Clawdius config, generalized
2. **Email Manager** — the most commonly requested use case
3. **Replace ChatGPT Plus** — honest about local-vs-cloud tradeoffs

**Write the first article.** "14 Ways Your OpenClaw Agent Is Silently Broken." Each landmine documented with evidence. Launches the personal website content series.

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

**Persona schema publication.** 17 dimensions across five research-grounded layers. Standalone spec with value beyond OpenClaw.

**OpenClaw incident tracker.** Curated security advisory tracking for the ecosystem. Authority builder.

### Product

**Expand to 10 blueprints.** Each is a masterclass and also a content piece. Candidates: DevOps Assistant, Content Creator, Trading/Finance, Health & Fitness, Family Hub (expanded), Founder's Ops (expanded), Research Co-pilot (expanded).

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

- ~~Community blueprint marketplace~~ — 10 curated, not 1,000 crowdsourced. ClawHub has a malware problem.
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
