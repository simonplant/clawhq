# ClawHQ

> Your AI agent runs on your hardware, talks to your services, and never sends a byte to anyone you didn't choose. ClawHQ makes that possible without a PhD in DevOps.

**Owner:** Simon Plant · **Status:** Active Development · **Updated:** 2026-03-27

---

## The Problem

The big 4 AI companies are building personal agents that know everything about you — emails, calendar, tasks, health, finances, relationships. They store it on their servers. They train on it. They lose it in breaches. You have zero sovereignty.

OpenClaw is the escape hatch — the most powerful open-source agent framework, running in a Docker container you control. But it's nearly impossible to operate. ~13,500 tokens of config across 11+ files. 14 silent landmines. Memory bloats to 360KB in 3 days. Credentials expire silently. Security is entirely opt-in. Most deployments are abandoned within a month.

Today you choose between **surveillance AI** (polished, easy, you own nothing) or **raw framework** (sovereign, powerful, months of expertise required). Nobody makes the sovereign option usable. That's the gap.

---

## The Solution

ClawHQ deploys, configures, and personalizes OpenClaw agents. Three things, done well: get the engine running (deployment), make it correct (configuration), and make it yours (personalization). It compiles blueprints — complete operational designs — into hardened, running agents.

The window is closing — not because big-tech AI will absorb features, but because 10+ hosting providers are commoditizing OpenClaw deployment right now. Blink, xCloud, AWS Lightsail, DigitalOcean, Hostinger, and others sell managed OpenClaw at $22-45/mo. They solve convenience but not sovereignty: default configs, no landmine prevention, no architectural security, no lifecycle management. ClawHQ's job is to own the sovereignty layer before the ecosystem consolidates around convenience-first platforms.

- "Run my emails" → email tools, triage skills, inbox-check cron, morning digest, auto-reply with approval gates
- "Help with stock trading" → market data tools, research skills, pre-market alerts, portfolio monitoring, risk guardrails
- "Plan meals for my family" → nutrition tools, shopping skills, weekly meal plan, dietary preferences
- "Maintain a blog about AI" → research tools, writing skills, editorial cron, publish with approval

Everything in OpenClaw is either a file or an API call. ClawHQ controls all of it programmatically. You get a Signal, Telegram, or Discord UI. We do the rest.

**Market reality:** 2M+ people already chose sovereign AI — OpenClaw has 250K+ stars and 42,000+ exposed instances. The demand is proven. The question is whether ClawHQ captures the sovereignty segment before competitors consolidate around convenience-first hosting.

---

## Design Principles

**Local-first.** Ollama models are the default. Cloud APIs are opt-in per-task-category. The agent works fully air-gapped.

**Transparent.** The user knows what their agent did, what data it touched, and what left their machine. Every outbound API call logged. Every tool execution audited.

**Sovereign.** Self-operated is the primary product. `clawhq export` gives you everything portable. `clawhq destroy` proves it's gone. Zero lock-in.

**Grows, doesn't stale.** Install new skills, connect new services, add providers — through a validated, sandboxed, rollback-capable pipeline. The agent at 6 months does more than at day 1.

---

## What Your Day Looks Like

**Without ClawHQ:** You wake up and check Gmail — Google reads every email. You ask ChatGPT to draft a response — OpenAI stores it. You check Google Calendar — Google knows your schedule. By 9 AM, four companies know more about your day than your spouse does.

**With ClawHQ:** You wake up to a Telegram message: "Morning. 3 meetings today. I triaged 40 emails — 6 need you. John moved Thursday's standup, conflicts with your client call — I've drafted a reschedule for your approval. Focus block 10-12 is protected. Investor update due Friday — I've drafted an outline." You reply "yes" and get on with your morning. Zero data left your machine.

**After 6 months:** The agent auto-sends routine replies in your voice. It knows your top clients are always priority. It preps investor updates unprompted. It built itself a tool for parsing your weekly analytics. You approved everything along the way, but you barely think about it anymore.

---

## Personas

**Privacy Migrant** — Using ChatGPT/Google Assistant, increasingly uncomfortable. Not necessarily technical. Biggest headache: no alternative that doesn't require becoming a sysadmin.

**Tinkerer** — Technical user comfortable with Docker and CLI. Biggest headache: the gap between "I got it running" and "it actually works well."

**Fleet Operator** — Manages agents for multiple people or use cases. Cares about fleet-wide visibility, consistent security, operational efficiency.

---

## What Success Looks Like

- **Time to working agent:** < 5 minutes (AI inference) or < 30 minutes (guided)
- **Config-related failures:** 0 silent landmines shipped
- **Data leaving machine:** 0 bytes by default
- **Agent capability growth:** Measurable increase in autonomous task completion at 30/60/90 days
- **Churn at 30 days:** < 20%

---

## What We're Building

Six modules. One binary. Parallel development tracks. Items marked ✅ are already implemented.

### design — The Blueprint Engine (THE PRODUCT)

This is the product. Everything else is infrastructure.

- [x] **Use-case blueprints** ✅
  Blueprints organized by what you're replacing. Each configures: identity, tools, skills, cron, integrations, security, autonomy, memory, model routing, egress.
  - "Email Manager" — inbox zero, triage, auto-reply, morning digest
  - "Family Hub" — shared calendar, chores, meals, coordination
  - "Founder's Ops" — inbox zero, investor updates, hiring pipeline
  - "Replace Google Assistant" — email + calendar + tasks + full-day orchestration
  - "Replace ChatGPT Plus" — sovereign alternative with local models
  - "Replace my PA" — personal assistant with full tool access
  - "Research Co-pilot" — research, analysis, writing

- [x] **Blueprint customization** ✅
  Blueprint-specific questions during setup: dietary restrictions, risk tolerance, communication style, priority contacts. 1-3 questions per blueprint.

- [ ] **Capability and persona catalog** `must`
  Composition is a compile-time problem. **Capabilities** are named tool+skill+integration bundles with `soul_fragments` (operational doctrine per domain — NOT personality). **Personas** are curated prose presets with `soul_template`, `voice_examples`, dimension defaults, and `anti_patterns`. The compiler resolves blueprint (persona + capabilities + overrides) into flat runtime config — no intermediate concepts survive into OpenClaw. Two escape hatches: `extra_tools[]` for tools outside any capability, `soul_overrides` for personality that doesn't fit a persona. See `docs/ARCHITECTURE.md` § "Compile-Time vs. Runtime" and `docs/CONFIGURATION.md` § "Planned: Capabilities and Personas".

- [x] **AI-powered config inference** ✅
  `clawhq init --smart` — describe what you need, system selects blueprint + configures integrations. Uses local Ollama.

- [x] **Guided setup** ✅
  `clawhq init --guided` — basics → blueprint selection → integrations with live validation → model routing.

- [x] **Config generation with landmine prevention** ✅
  Every forged config passes all 14 landmine rules. Generation cannot produce a broken config.

- [x] **Integration auto-detection** ✅
  iCloud email → suggest iCloud calendar. Ollama running → discover models, recommend routing.

- [ ] **Community blueprints** `future`

### build — Install and Deploy

One command: working agent.

- [ ] **Installer** `must`
  `clawhq install` — pre-req detection, engine acquisition (source or trusted cache), deployment directory scaffold.

- [x] **Two-stage Docker build** ✅
- [x] **Full deploy sequence** ✅ — `clawhq up` → preflight → compose → firewall → health → smoke test.
- [x] **Pre-flight checks** ✅
- [x] **Graceful shutdown and restart** ✅
- [x] **Channel connection** ✅
- [x] **Post-deploy smoke test** ✅

### secure — Security and Compliance

Hardened by default. Every action auditable.

- [x] **Container hardening** ✅ — `cap_drop: ALL`, read-only rootfs, non-root UID 1000, ICC disabled.
- [x] **Egress firewall** ✅ — iptables `CLAWHQ_FWD`, per-integration domain allowlist.
- [x] **Credentials management** ✅ — `credentials.json` (mode 0600) separate from `.env`, with `clawhq creds` health probes.
- [x] **PII and secret scanning** ✅
- [x] **Audit trail** ✅ — tool execution + secret lifecycle (HMAC-chained) + egress.
- [x] **Data egress audit** ✅

### operate — Keep It Alive

Day-2 through day-365.

- [x] **Doctor** ✅ — 14+ checks with auto-fix.
- [x] **Predictive health alerts** ✅
- [x] **Status dashboard** ✅
- [x] **Encrypted backup and restore** ✅
- [x] **Safe upstream updates** ✅
- [ ] **Monitor daemon** `should` — background health loop with configurable alerts.
- [x] **Activity digest** ✅
- [x] **Health self-repair** ✅

### evolve — Grow the Agent

The retention mechanism.

- [x] **Skill management** ✅ — sandboxed vetting, rollback snapshots.
- [x] **Approval queue** ✅
- [x] **Portable export** ✅
- [x] **Verified destruction** ✅
- [ ] **Identity governance** `could`
- [x] **Memory lifecycle** ✅ — three tiers, LLM-powered summarization, PII masking.
- [x] **Decision trace** ✅ — "why did you do that?" with preference learning.

### cloud — The Business

Optional. Zero-trust by design.

- [x] **Trust mode management** ✅ — Paranoid / Zero-Trust / Managed. Kill switch.
- [x] **Health heartbeat** ✅ — agent-initiated, never reports content.
- [x] **Command queue** ✅ — pull, verify signature, execute or reject. Content access architecturally blocked.
- [ ] **agentd daemon** `could`
- [ ] **Managed hosting** `deprioritized` — _10+ funded competitors (Blink, AWS Lightsail, xCloud, DigitalOcean, Hostinger, etc.) already sell managed OpenClaw at $22-45/mo. ClawHQ competes on architectural depth and sovereignty, not hosting convenience. Revisit only after 1,000+ self-hosted users and clear signal on what managed should include beyond what competitors offer._
- [ ] **Remote dashboard** `future`
- [ ] **Blueprint library** `future`
- [ ] **Migration tools** `future`

---

## How the Agent Grows

**Week 1:** Baseline works. Email triage, calendar management, morning briefs. Local models.

**Month 1:** Install a Slack skill. Add OpenAI for research only. Email stays 100% local.

**Month 3:** Three new integrations. Egress dashboard shows exactly which providers get which data.

**Month 6:** 12 skills, 6 integrations, 3 providers, 8 tools. Nothing runs that you can't trace. Rollback any change.

---

## Build Order

Parallel tracks. See `backlog/backlog.json` for sprint-ready items.

**Track A (Blueprints)** — Use-case blueprints, customization, AI inference.
**Track B (Installer)** — One-command install. Pre-reqs, scaffold, engine acquisition.
**Track C (Skills)** — Email-digest, auto-reply, market-scan, meal-plan.
**Track D (Cloud)** — Trust modes, heartbeat, command queue, agentd.
**Track E (Source Reorg)** — Module barrel exports, then physical moves.
**Track F (Polish)** — credentials.json, monitor daemon, web dashboard.

---

## What We're NOT Building

- **A fork of OpenClaw** — We configure it. We don't modify it.
- **A competing agent framework** — We're the platform, not the engine.
- **A model routing engine** — OpenClaw handles model calls. We set policy via config.
- **Multiple CLI tools** — One binary, flat commands. (AD-01)
- **A cloud AI service** — We don't host models, don't train on data, don't see content.

---

## Competitive Landscape

The OpenClaw ecosystem is large (250K+ GitHub stars, 2M+ MAU) and contested. 10+ hosting providers sell managed OpenClaw. None solve the problems ClawHQ addresses.

| Alternative | What It Offers | What It Doesn't |
|---|---|---|
| **Hosting providers** (Blink, xCloud, AWS Lightsail, DigitalOcean, Hostinger, RunMyClaw, LumaDock, OpenClaw Cloud) | Deploy OpenClaw on a VPS, $22-45/mo | Default config, no landmine prevention, no architectural security, no lifecycle management, no blueprints |
| **Raw OpenClaw** | Full power, full control | Months of setup, ongoing SRE, 14 silent landmines, no memory management |
| **Community dashboards** | Basic monitoring | No security, no lifecycle, no configuration management |
| **Security point tools** (ClawSec) | Hardening guides, scanning | Fragmented, no unified platform, manual execution |
| **Big-tech agents** (Google, Apple, Microsoft) | Polished, integrated, easy | Platform lock-in, no sovereignty, black box |

### Market Gap

| Domain | Current Coverage | Gap |
|---|---|---|
| Provisioning & Deploy | Well-served by 10+ hosting providers | Low |
| Security Hardening | Fragmented: guides + point tools; no unified self-serve platform | **Critical** |
| Configuration Management | Very weak: most config requires CLI/JSON editing | **Critical** |
| Operations & Maintenance | Fragmented: updates manual, backups DIY | **Critical** |
| Agent Lifecycle | Weak: most dashboards are read-only | High |
| Governance & Compliance | Nearly nonexistent for self-hosted | **Critical** |

### ClawHQ's Position

ClawHQ is not a hosting provider. It's the operations and sovereignty layer — the cPanel for OpenClaw. Same analogy that played out for every successful open-source infrastructure engine:

| Engine | Operational Burden | Control Panel |
|---|---|---|
| Linux | Server admin, security, mail, cron | cPanel, Plesk, Webmin |
| WordPress | Hosting, updates, security, backups | WordPress.com, managed WP hosting |
| Kubernetes | Container orchestration, networking | Rancher, OpenShift |
| **OpenClaw** | **Agent config, security, monitoring, evolution** | **ClawHQ** |

---

## Risks & Open Questions

**Risks:**
- Local model quality → mitigation: intelligent routing escalates to cloud
- OpenClaw breaking changes → mitigation: pin versions, compatibility shims
- Blueprint ecosystem → mitigation: ship excellent built-in blueprints covering 80% of use cases
- Skill supply chain → mitigation: sandboxed vetting, AI scanning, allowlists, rollback

**Open questions:**
- [ ] Local model minimum bar — Which Ollama models for which tasks?
- [ ] OpenClaw foundation relationship — Steinberger joined OpenAI Feb 2026, project at foundation. Governance unknown. Active contribution gives influence.

**Directional decisions (from market analysis):**
- **Early adopters:** OpenClaw community power users who self-host and care about security. Recruit through Discord, GitHub, Reddit, HackerNews — not through SEO competition with hosting providers.
- **Revenue sequencing:** Open-source adoption builds community and reputation → premium blueprints and enterprise fleet management → security-vetted skill marketplace. Managed hosting deprioritized against 10+ funded competitors.
- **Competitive positioning:** ClawHQ is the sovereignty platform. Hosting providers deploy default-config agents. ClawHQ does blueprint composition, architectural security, landmine prevention, and lifecycle management. Different layer entirely.

---

## Links

- Solution Architecture: `docs/ARCHITECTURE.md`
- OpenClaw Reference: `docs/OPENCLAW-REFERENCE.md`
- Gap Analysis: `backlog/GAP-ANALYSIS.md`
- Backlog: `backlog/backlog.json`
