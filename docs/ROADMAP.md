# ClawHQ Roadmap

> Where the project is, where it's going, and what's honest aspiration vs shipped reality.

**Updated:** 2026-03-24

---

## What's Built

ClawHQ has a working CLI with 33 commands, 90,000+ lines of TypeScript, and 132 test files across all major subsystems:

- **Blueprint engine** — 6 built-in blueprints (Guardian, Assistant, Coach, Analyst, Companion, Custom) with guided and AI-powered setup
- **Config generation** — all 14 known failure modes ("landmines") auto-prevented during setup
- **Full deploy pipeline** — two-stage Docker build, pre-flight checks, firewall, health verification, smoke tests
- **Container security** — hardened by default: `cap_drop: ALL`, read-only rootfs, non-root user, egress firewall with per-integration domain allowlists
- **Diagnostics** — `clawhq doctor` with 11 checks and auto-fix, predictive health alerts, self-healing
- **Skill system** — 6 built-in skills (email digest, morning brief, market scan, meal plan, schedule guard, investor update) with sandboxed vetting and rollback
- **Workspace tools** — 7 CLI tool generators (email, tasks, todoist, iCal, market quotes, web search, todoist-sync)
- **Operational tooling** — encrypted backup/restore, safe updates with rollback, status dashboard, audit trail (tool execution + egress + secrets), log streaming
- **Agent lifecycle** — portable export with PII masking, verified destruction, approval queue, multi-channel notifications
- **AI-powered setup** — `clawhq init --smart` uses local Ollama to infer configuration from a natural-language description

---

## Now

Active development focus:

- **Cloud deployment updates** — push config changes, version upgrades, and new skills to cloud-deployed agents without reprovisioning
- **Documentation suite** — contributing guide and changelog to support contributors and evaluators
- **README overhaul** — slim the README to storefront format, with detailed content moved to dedicated docs

---

## Next

Committed direction — these are the immediate priorities after current work:

- **Use-case blueprints** — purpose-built blueprints for specific jobs: Email Manager, Stock Trading Assistant, Meal Planner, AI Blog Maintainer, Founder's Ops, Family Hub, Replace Google Assistant
- **Blueprint customization** — blueprint-specific questions during setup (dietary restrictions, risk tolerance, communication style)
- **One-command installer** — `clawhq install` handles prerequisites, engine acquisition (signed or from-source), and deployment directory scaffolding
- **Deployment directory** — dedicated `~/.clawhq/` structure separating engine, workspace, ops, security, cron, and cloud
- **Separate credential store** — `credentials.json` (mode 0600) for integration credentials, distinct from `.env` environment secrets
- **Additional workspace tools** — blueprint-driven tool generators for new use cases

---

## Later

Vision — directionally committed but not yet scheduled:

- **Cloud trust modes** — Paranoid (no cloud), Zero-Trust (agent-initiated, signed commands, user-approved), Managed (auto-approved ops, content architecturally blocked)
- **Health heartbeat** — agent-initiated cloud reporting that never sends content, only operational status
- **Remote command queue** — pull-based, cryptographically signed commands with reject capability
- **Managed hosting** — provision and manage agents on DigitalOcean, Hetzner, or any VPS from a web console
- **Monitor daemon** — background health loop with configurable alerts
- **Web dashboard** — local browser UI for visual agent management (server scaffolded, UI in progress)
- **Memory lifecycle** — three-tier memory management with LLM-powered summarization and PII masking
- **Decision trace** — "why did you do that?" explanations with preference learning
- **Community blueprint library** — submit, review, and share blueprints

**How the agent grows over time:**

- **Week 1** — Baseline works: email triage, calendar management, morning briefs, local models
- **Month 1** — Add a Slack skill, connect OpenAI for research only, email stays 100% local
- **Month 3** — Three new integrations, egress dashboard shows exactly which providers get which data
- **Month 6** — 12 skills, 6 integrations, 3 providers, 8 tools — nothing runs that you can't trace

---

## Known Limitations

Honest constraints in the current state:

- **No installer yet** — users must manually install Docker, Node.js, and OpenClaw before using ClawHQ
- **Limited blueprint library** — 6 generic blueprints exist; use-case-specific blueprints (email manager, stock trading) are not yet available
- **Single machine only** — no multi-machine or cluster deployment support
- **Linux and macOS only** — Windows requires WSL; native Windows is not supported
- **Docker required** — ClawHQ runs agents in Docker containers; there is no bare-metal option
- **Cloud is a stub** — the cloud module exists as a placeholder; remote monitoring and managed hosting are not functional
- **Web dashboard is scaffolded** — the Hono server runs but UI components are not yet built out
- **Agent runtime integration pending** — memory, learning, autonomy, and trace subsystems work standalone but are not yet wired to the running agent

---

## Risks

What might not work — and how we're thinking about it:

- **Local model quality** — small local models may not be good enough for complex tasks. Mitigation: intelligent routing escalates specific task types to cloud APIs while keeping sensitive data local.
- **OpenClaw breaking changes** — upstream updates could break ClawHQ's integration. Mitigation: pinned versions, compatibility shims, and rollback on every update.
- **Blueprint ecosystem** — if built-in blueprints don't cover enough use cases, adoption stalls. Mitigation: ship excellent built-in blueprints covering the 80% case, then open contributions.
- **Skill supply chain** — third-party skills could introduce security risks. Mitigation: sandboxed vetting, AI-powered scanning, domain allowlists, and one-click rollback.
