# ClawHQ

> Your AI agent runs on your hardware, talks to your services, and never sends a byte to anyone you didn't choose. ClawHQ makes that possible without a PhD in DevOps.

**Owner:** [Name] · **Status:** Active Development · **Updated:** 2026-03-17

---

## The Problem

The big 4 AI companies are building personal agents that know everything about you — emails, calendar, tasks, health, finances, relationships. They store it on their servers. They train on it. They lose it in breaches. You have zero sovereignty.

OpenClaw is the escape hatch — the most powerful open-source agent framework, running in a Docker container you control. But it's nearly impossible to operate. ~13,500 tokens of config across 11+ files. 14 silent landmines. Memory bloats to 360KB in 3 days. Credentials expire silently. Security is entirely opt-in. Most deployments are abandoned within a month.

Today you choose between **surveillance AI** (polished, easy, you own nothing) or **raw framework** (sovereign, powerful, months of expertise required). Nobody makes the sovereign option usable. That's the gap.

---

## The Solution

ClawHQ is an agent platform for OpenClaw. It forges purpose-built agents from blueprints — complete operational designs that configure every dimension of the agent for a specific job. Choose a blueprint, customize it, and ClawHQ forges a hardened, running agent. One command.

- "Run my emails" → email tools, triage skills, inbox-check cron, morning digest, auto-reply with approval gates
- "Help with stock trading" → market data tools, research skills, pre-market alerts, portfolio monitoring, risk guardrails
- "Plan meals for my family" → nutrition tools, shopping skills, weekly meal plan, dietary preferences
- "Maintain a blog about AI" → research tools, writing skills, editorial cron, publish with approval

Everything in OpenClaw is either a file or an API call. ClawHQ controls all of it programmatically. You get a Signal, Telegram, or Discord UI. We do the rest.

**Core bet:** People will choose a sovereign AI agent over a big-tech one — if the sovereign option isn't dramatically harder to use.

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

- [ ] **Use-case blueprints** `must`
  Blueprints organized by what you're replacing. Each configures: identity, tools, skills, cron, integrations, security, autonomy, memory, model routing, egress.
  - "Email Manager" — inbox zero, triage, auto-reply, morning digest
  - "Stock Trading Assistant" — market monitoring, research, alerts, risk guardrails
  - "Meal Planner" — nutrition, shopping lists, weekly plans, dietary preferences
  - "AI Blog Maintainer" — research, writing, editorial workflow, publish approval
  - "Replace Google Assistant" — email + calendar + tasks + full-day orchestration
  - "Founder's Ops" — inbox zero, investor updates, hiring pipeline
  - "Family Hub" — shared calendar, chores, meals, coordination

- [ ] **Blueprint customization** `must`
  Blueprint-specific questions during setup: dietary restrictions, risk tolerance, communication style, priority contacts. 1-3 questions per blueprint.

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
- [ ] **Credentials management** `must` — `credentials.json` (mode 0600) separate from `.env`. _(`.env` + `clawhq creds` implemented; separate credential store is new work.)_
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
- [ ] **Memory lifecycle** `could` — three tiers, LLM-powered summarization, PII masking.
- [ ] **Decision trace** `could` — "why did you do that?" with preference learning.

### cloud — The Business

Optional. Zero-trust by design.

- [ ] **Trust mode management** `should` — Paranoid / Zero-Trust / Managed. Kill switch.
- [ ] **Health heartbeat** `should` — agent-initiated, never reports content.
- [ ] **Command queue** `should` — pull, verify signature, execute or reject. Content access architecturally blocked.
- [ ] **agentd daemon** `could`
- [ ] **Managed hosting** `future`
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

## Risks & Open Questions

**Risks:**
- Local model quality → mitigation: intelligent routing escalates to cloud
- OpenClaw breaking changes → mitigation: pin versions, compatibility shims
- Blueprint ecosystem → mitigation: ship excellent built-in blueprints covering 80% of use cases
- Skill supply chain → mitigation: sandboxed vetting, AI scanning, allowlists, rollback

**Open questions:**
- [ ] Phase 0 candidates — Who are the 3-5 Privacy Migrants?
- [ ] Local model minimum bar — Which Ollama models for which tasks?
- [ ] OpenClaw relationship — Inform? Partner?
- [ ] Pricing — Cost to run one managed agent?

---

## Links

- Solution Architecture: `docs/ARCHITECTURE.md`
- OpenClaw Reference: `docs/OPENCLAW-REFERENCE.md`
- Gap Analysis: `backlog/GAP-ANALYSIS.md`
- Backlog: `backlog/backlog.json`
