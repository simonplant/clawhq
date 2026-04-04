# ClawHQ

> Your AI agent runs on your hardware, talks to your services, and never sends a byte to anyone you didn't choose. ClawHQ makes that possible without a PhD in DevOps.

**Owner:** Simon Plant · **Status:** Active Development · **Updated:** 2026-04-03

---

## The Problem

The big 4 AI companies are building personal agents that know everything about you — emails, calendar, tasks, health, finances, relationships. They store it on their servers. They train on it. They lose it in breaches. You have zero sovereignty.

OpenClaw is the escape hatch — the most powerful open-source agent framework, running in a Docker container you control. But it's nearly impossible to operate. ~200+ configurable fields across 8 auto-loaded workspace files and a central JSON config. 14 silent landmines. Memory bloats to 360KB in 3 days. Credentials expire silently. Security is opt-in — the upstream sandbox has been bypassed twice (Snyk Labs, Feb 2026). The built-in tooling (`openclaw onboard`, `openclaw configure`, the Control UI) covers basic setup but not composition, hardening, or lifecycle. Most deployments are abandoned within a month.

Today you choose between **surveillance AI** (polished, easy, you own nothing) or **raw framework** (sovereign, powerful, months of expertise required). ClawHQ bridges that gap — not by replacing OpenClaw, but by bringing the operational knowledge, tested configurations, and lifecycle tooling that make sovereignty practical.

---

## The Approach

ClawHQ is a **community-first project** — tools, blueprints, and knowledge for the OpenClaw ecosystem, built from months of production operation. It contributes to the community and the upstream project rather than creating an alternative platform.

The work has three layers:

**Layer 1: Knowledge (free, open, builds reputation)**
Published blueprints, the configuration surface reference, security findings, production postmortems, upstream issue reports and PRs. This is what establishes authority in the ecosystem regardless of what happens with revenue. Content emerges from development and operation — not a separate calendar.

**Layer 2: Tools (open-source, useful, moderate maintenance)**
Blueprint compiler, config generation with landmine prevention, container hardening, diagnostics, deployment pipeline. 67K lines of TypeScript, 78 commands, 7 working blueprints. These exist and work. They help people. Maintenance stays sustainable by not wrapping upstream commands — generating configs and checking health, not reimplementing what OpenClaw already does.

**Layer 3: Services (gated behind demand, not speculative)**
Monitoring (upstream intelligence, config breakage prediction), premium blueprints, consulting. These only get built when Layer 1 and 2 have generated enough traction to validate demand. Not before.

---

## What ClawHQ Does

**Blueprints** — Opinionated, production-tested agent configurations. "I want an email manager" compiles into a coherent set of all 8 workspace files + runtime config + cron schedule + tool policy + security posture. Nobody else publishes complete, tested configurations for specific use cases. The community has dozens of generic setup guides. Zero that say "here's exactly how a production email agent should be configured, with every landmine pre-handled."

- "Email Manager" — inbox triage, morning digest, auto-reply with approval gates
- "Hardened PA" — security-first personal assistant, the Clawdius configuration generalized
- "Replace ChatGPT Plus" — sovereign alternative, honest about local-vs-cloud tradeoffs
- "Founder's Ops" — inbox zero, investor updates, hiring pipeline
- "Family Hub" — shared calendar, chores, meals, coordination
- "Research Co-pilot" — research, analysis, writing
- "Replace my PA" — full tool access personal assistant

**Config generation** — Every generated config prevents all 14 known landmines. Guided and AI-powered setup. Integration auto-detection.

**Container hardening** — `cap_drop: ALL`, read-only rootfs, non-root user, egress firewall with per-integration domain allowlists. Hardened by default, not opt-in.

**Diagnostics** — `clawhq doctor` with 14+ checks, auto-fix, predictive health alerts. Extends OpenClaw's built-in `openclaw doctor` with landmine detection, firewall verification, credential probes, identity size enforcement, context pruning verification.

**Deployment** — Two-stage Docker build, pre-flight checks, firewall, health verification, smoke tests.

**Operations** — Encrypted backup/restore, safe updates with rollback, status dashboard, audit trail, memory lifecycle management.

**Security** — PII/secret scanning, skill vetting with sandboxed evaluation, credential health with expiry tracking, prompt injection defense.

---

## Design Principles

**Community-first.** Contribute upstream. Publish openly. Build reputation through demonstrated expertise, not through lock-in. If OpenClaw absorbs a ClawHQ idea, that's success — not failure.

**Local-first, cloud-honest.** Ollama models are the default for privacy. Cloud APIs are opt-in per task. But OpenClaw's tool system requires function calling — small local models are less capable and less robust against prompt injection than frontier models. Blueprints are honest about this tradeoff.

**Sovereign.** Self-operated is the primary path. `clawhq export` gives you everything portable. Zero lock-in. No data leaves your machine unless you configure it to.

**Sustainable.** Don't wrap upstream — generate configs and check health. Don't compete with built-in tooling — extend it. Don't build services for hypothetical demand — validate first. Every design decision answers: "Can one person maintain this without it becoming a full-time SRE job?"

---

## What's Durable

Not everything ClawHQ does survives OpenClaw maturation equally. Being honest about this shapes where to invest.

**Durable — framework structurally can't do these:**
- **Opinionated composition.** "Here's what a good email agent looks like" is outside framework scope. Frameworks serve everyone and can't have opinions about specific use cases.
- **Cross-surface coherence.** Validating that SOUL.md, TOOLS.md, `openclaw.json`, tool policy, and skill selection all agree with each other and with the user's intent. OpenClaw validates each surface against its own schema, not against each other.
- **Intent preservation.** A blueprint records what you were trying to build. Drift detection is "does the current state still match?" OpenClaw records configuration, not intent.
- **Longitudinal lifecycle.** How agents drift over time, what memory management looks like at 120 days, when credentials expire, where identity degrades. Operational knowledge that doesn't exist in framework docs.

**Bridge value — important now, may get absorbed over 12-24 months:**
- The 14 landmines. OpenClaw will fix these over time.
- Basic security hardening. Community guides are proliferating. `openclaw security audit` exists.
- Guided configuration. `openclaw onboard` and `openclaw configure` already exist and will improve.
- Individual feature patches (context pruning defaults, skill permission restriction).

Bridge value earns credibility and buys time for the durable layers. But it's not the long-term bet.

---

## Revenue

**Phase 1 (now): Build at $0, earn reputation.**
Open-source tools + published blueprints + upstream contributions + content from production experience. No revenue expected. The work builds the profile that creates opportunities.

**Phase 2 (with traction): Test willingness to pay.**
- **Sentinel monitoring** — upstream intelligence: config breakage prediction against incoming commits, CVE mapping against your blueprint, skill reputation tracking. ~$19/month. Must do something a local cron job can't. Only built if community asks for it.
- **Premium blueprints** — deeply customized, domain-specific configurations. Only if free blueprints prove valued.
- **Consulting/advisory** — for teams deploying at scale. Only if inbound inquiries materialize.

**Hard constraint:** Don't build paid services before demand is validated. Publish knowledge first. If the knowledge creates demand for tooling, build the tooling.

---

## What We're Not Building

- **A fork of OpenClaw** — We contribute to it, not compete with it.
- **A replacement for OpenClaw's built-in UI** — The Control UI handles config editing. ClawHQ's value is composition, lifecycle, and security — not forms.
- **A model routing engine** — OpenClaw handles model calls. We set policy via config.
- **Managed hosting as primary business** — 10+ funded competitors own this. Sovereignty is the position.
- **A community blueprint marketplace** — 10 curated masterclass blueprints beat 1,000 crowdsourced ones. ClawHub already has a malware problem.

---

## Links

- Configuration Reference: `docs/OPENCLAW-REFERENCE.md`
- Architecture: `docs/ARCHITECTURE.md`
- Strategy: `docs/STRATEGY.md`
- Roadmap: `docs/ROADMAP.md`
