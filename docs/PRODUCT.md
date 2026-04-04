# ClawHQ

> Your AI agent runs on your hardware, talks to your services, and never sends a byte to anyone you didn't choose. ClawHQ makes that possible without a PhD in DevOps.

**Owner:** Simon Plant · **Status:** Pre-launch (all code works, zero external users — community validation begins at publication) · **Updated:** 2026-04-03

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

**Blueprints** — Opinionated, production-tested agent configurations. A blueprint compiles into a coherent set of all 8 workspace files + runtime config + cron schedule + tool policy + security posture. The community has 177 SOUL.md templates across three repos — all personality files only. None include tool configuration, cron schedules, security posture, credential management, or egress policy. A personality without an operational stack is a character sheet for a game nobody set up.

Blueprints separate two orthogonal axes:

**Mission profiles** define what the agent can do — tools, integrations, cron jobs, autonomy rules, security posture, memory policy:
- **Life Operations** — email, calendar, tasks, morning briefs, grocery/meal support
- **Development Partner** — code, git, CI/CD, architecture, repo monitoring
- **Research & Knowledge** — web research, synthesis, writing, analysis
- **Trading & Finance** — market data, alerts, portfolio tracking, risk guardrails
- **Home & Devices** — smart home, cameras, device control, automation
- **Business Ops** — CRM, leads, metrics, competitor analysis, content pipeline

**Personality presets** define how the agent delivers — tone, values, communication style, philosophical orientation. Built on the **Persona Schema** (v0.1): 17 dimensions across five research-grounded layers — Big Five, HEXACO, Interpersonal Circumplex, Schwartz values, Haidt's Moral Foundations, and Self-Determination Theory. This is the structured framework that makes personality presets rigorous instead of vibes-based. The community has 177 SOUL.md files that say "You are warm and helpful." The Persona Schema says exactly what "warm" means across measurable dimensions and how it interacts with directness, autonomy, analytical depth, and moral reasoning. Composable with any mission profile:
- **Direct Operator** — Terse, competent, no filler. The Clawdius baseline.
- **Thoughtful Advisor** — Analytical, explains reasoning, asks before acting.
- **Warm Companion** — Conversational, remembers personal context, checks in proactively.
- **Philosophical Guide** — Stoic/Buddhist filter, frames decisions through values. Claudius Maximus.

A published blueprint is a specific composition: "Life Ops + Direct Operator" is the Hardened PA. "Life Ops + Warm Companion" is the Family Hub. "Trading + Philosophical Guide" is how Clawdius handles markets. Users can also combine multiple mission profiles under one personality — Simon's Clawdius runs Life Ops + Trading + Research + Coaching under a single Stoic/Buddhist character. The compiler resolves the composition into flat runtime config.

This is grounded in how people actually use OpenClaw. The research shows most users run ONE agent with multiple capabilities under a unified personality — not separate agents per role. The multi-agent pattern exists but is the minority. The community's 177 role-personality fusions ("warm data analyst," "sassy marketing agent") are the wrong abstraction. Mission profiles and personalities are independent axes.

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
- **Opinionated composition.** "Here's what a good email agent looks like" is outside framework scope. Frameworks serve everyone and can't have opinions about specific use cases. The two-axis model (mission profiles × personality presets) is a design insight the framework doesn't encode.
- **Cross-surface coherence.** Validating that SOUL.md, TOOLS.md, `openclaw.json`, tool policy, and skill selection all agree with each other and with the user's intent. OpenClaw validates each surface against its own schema, not against each other.
- **Intent preservation.** A blueprint records what you were trying to build. Drift detection is "does the current state still match?" OpenClaw records configuration, not intent.
- **Longitudinal lifecycle.** How agents drift over time, what memory management looks like at 120 days, when credentials expire, where identity degrades. Operational knowledge that doesn't exist in framework docs.

**Bridge value — important now, uncertain shelf life:**
- The 14 landmines. OpenClaw will fix some over time — but open-source projects are notoriously slow at configuration UX even at scale. Kubernetes still has footguns a decade in. These may persist for years.
- Basic security hardening. Community guides are proliferating. `openclaw security audit` exists. But opt-in hardening and default-on hardening are different products.
- Guided configuration. `openclaw onboard` and `openclaw configure` already exist and will improve. The gap narrows but may never close to blueprint-level composition.
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

**Honest fallback:** If all revenue signals are negative at month 9, the body of work — blueprints, Persona Schema, configuration reference, security pattern catalog, 74 production hardening patterns — is a portfolio of deep technical work in AI agent infrastructure. Valuable for job applications, advisory roles, speaking, and credibility in the space even if ClawHQ never generates direct revenue. The work is not wasted; it's repositioned.

---

## What We're Not Building

- **A fork of OpenClaw** — We contribute to it, not compete with it.
- **A replacement for OpenClaw's built-in UI** — The Control UI handles config editing. ClawHQ's value is composition, lifecycle, and security — not forms.
- **A model routing engine** — OpenClaw handles model calls. We set policy via config.
- **Managed hosting as primary business** — 10+ funded competitors own this. Sovereignty is the position.
- **A community blueprint marketplace** — 6 mission profiles and 4 personality presets, production-tested and composable, beat 177 untested SOUL.md-only templates. Quality over quantity.

---

## Links

- Persona Schema: `docs/PERSONA-SCHEMA.md`
- Configuration Reference: `docs/OPENCLAW-REFERENCE.md`
- Blueprint Specification: `docs/BLUEPRINT-SPEC.md`
- Architecture: `docs/ARCHITECTURE.md`
- Strategy: `docs/STRATEGY.md`
- Roadmap: `docs/ROADMAP.md`
