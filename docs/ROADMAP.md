# ClawHQ Roadmap

> Where the project is, where it's going, and what's honest aspiration vs shipped reality.

**Updated:** 2026-03-27

---

## What's Built

ClawHQ has a working CLI with 78 commands, ~67,000 lines of TypeScript, and 77 test files across all major subsystems. Built with AI-assisted development (Claude Code).

- **Blueprint engine** — 7 use-case blueprints (Email Manager, Family Hub, Founder's Ops, Replace Google Assistant, Replace ChatGPT Plus, Replace my PA, Research Co-pilot) with guided and AI-powered setup, blueprint-specific customization questions
- **Config generation** — all 14 known failure modes ("landmines") auto-prevented during setup
- **Full deploy pipeline** — two-stage Docker build, pre-flight checks, firewall, health verification, smoke tests
- **Container security** — hardened by default: `cap_drop: ALL`, read-only rootfs, non-root user, egress firewall with per-integration domain allowlists
- **Diagnostics** — `clawhq doctor` with 14+ checks and auto-fix, predictive health alerts, self-healing
- **Skill system** — 6 built-in skills (email digest, morning brief, market scan, meal plan, schedule guard, investor update) with sandboxed vetting and rollback
- **Workspace tools** — 7 CLI tool generators (email, tasks, todoist, iCal, market quotes, web search, todoist-sync)
- **Operational tooling** — encrypted backup/restore, safe updates with rollback, status dashboard, audit trail (tool execution + egress + secrets), log streaming
- **Agent lifecycle** — portable export with PII masking, verified destruction, approval queue, multi-channel notifications
- **AI-powered setup** — `clawhq init --smart` uses local Ollama to infer configuration from a natural-language description
- **Credential management** — separate `credentials.json` (mode 0600), health probes with expiry tracking
- **Memory lifecycle** — hot/warm/cold tiers, LLM-powered summarization, PII masking
- **Decision trace** — "why did you do that?" explanation system with preference learning
- **Cloud provisioning** — 4 provider adapters (DigitalOcean, AWS, GCP, Hetzner), trust modes (Paranoid/Zero-Trust/Managed), health heartbeat, signed command queue
- **Migration import** — ChatGPT and Google Assistant data export parsing with PII masking

---

## Now

Active development focus. The market is large (250K+ stars, 2M+ MAU) and contested — 10+ hosting providers are capturing the OpenClaw ecosystem. Urgency is around public visibility and proving the end-to-end pipeline.

- **Documentation alignment** — aligning all docs with corrected market data, competitive positioning, and sovereignty-first messaging
- **End-to-end testing** — FEAT-018: smoke test covering the full journey (install → init → up → verify)
- **Agent runtime integration** — wiring memory, learning, autonomy, and trace subsystems to the running agent
- **Public launch preparation** — GitHub repo public, community alpha to OpenClaw power users

---

## Next

Committed direction — immediate priorities after current work:

- **Distro installer** — `curl -fsSL https://clawhq.com/install | sh` one-command install (currently requires manual clone + build)
- **Web dashboard UI** — Hono server scaffolded, UI components not yet built out
- **Monitor daemon** — background health loop with configurable alerts
- **Additional workspace tools** — blueprint-driven tool generators for new use cases
- **Public launch** — GitHub repo public, community alpha to OpenClaw power users

---

## Later

Vision — directionally committed but not yet scheduled:

- **Community blueprint library** — submit, review, and share blueprints; security-vetted alternative to ClawHub
- **Managed hosting** — provision and manage agents from a web console. _Deprioritized — 10+ funded competitors (Blink, AWS Lightsail, xCloud, DigitalOcean, Hostinger, etc.) already sell managed OpenClaw at $22-45/mo. ClawHQ's strength is architectural depth and sovereignty, not hosting convenience. Revisit after 1,000+ self-hosted users and clear signal on differentiation._
- **Identity governance** — drift detection, contradiction checking, token budget enforcement
- **Capability and persona catalog** — compile-time composition of named tool+skill+integration bundles

**How the agent grows over time:**

- **Week 1** — Baseline works: email triage, calendar management, morning briefs, local models
- **Month 1** — Add a Slack skill, connect OpenAI for research only, email stays 100% local
- **Month 3** — Three new integrations, egress dashboard shows exactly which providers get which data
- **Month 6** — 12 skills, 6 integrations, 3 providers, 8 tools — nothing runs that you can't trace

---

## Known Limitations

Honest constraints in the current state:

- **No distro installer yet** — users must clone the repo and build from source; `clawhq install` handles engine acquisition but the one-command `curl | sh` installer does not exist yet
- **Single machine only** — no multi-machine or cluster deployment support
- **Linux and macOS only** — Windows requires WSL; native Windows is not supported
- **Docker required** — ClawHQ runs agents in Docker containers; there is no bare-metal option
- **Cloud provisioning exists, managed hosting deprioritized** — 4 provider adapters work; the managed hosting market has 10+ funded competitors at $22-45/mo, so ClawHQ focuses on sovereignty and architectural depth instead
- **Web dashboard is scaffolded** — the Hono server runs but UI components are not yet built out
- **Agent runtime integration pending** — memory, learning, autonomy, and trace subsystems work standalone but are not yet wired to the running agent

---

## Risks

What might not work — and how we're thinking about it:

- **Local model quality** — small local models may not be good enough for complex tasks. Mitigation: intelligent routing escalates specific task types to cloud APIs while keeping sensitive data local.
- **OpenClaw breaking changes** — upstream updates could break ClawHQ's integration. Mitigation: pinned versions, compatibility shims, and rollback on every update.
- **Blueprint ecosystem** — if built-in blueprints don't cover enough use cases, adoption stalls. Mitigation: ship excellent built-in blueprints covering the 80% case, then open contributions.
- **Skill supply chain** — third-party skills could introduce security risks. Mitigation: sandboxed vetting, AI-powered scanning, domain allowlists, and one-click rollback.
