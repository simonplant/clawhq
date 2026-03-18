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

**Local-first.** Ollama models are the default. Cloud APIs are opt-in per-task-category, not globally. The agent works fully air-gapped. If no cloud key is configured, it still works.

**Transparent.** The user knows what their agent did, what data it touched, and what left their machine — without asking. Every outbound API call logged. Every tool execution audited.

**Sovereign.** Self-operated is the primary product. `clawhq export` gives you everything portable. `clawhq destroy` proves it's gone. Zero lock-in.

**Grows, doesn't stale.** Install new skills, connect new services, add providers — through a validated, sandboxed, rollback-capable pipeline. The agent at 6 months does more than at day 1.

---

## What Your Day Looks Like

**Without ClawHQ:** You wake up and check Gmail — Google reads every email. You ask ChatGPT to draft a response — OpenAI stores it. You check Google Calendar — Google knows your schedule. By 9 AM, four companies know more about your day than your spouse does.

**With ClawHQ:** You wake up to a Telegram message: "Morning. 3 meetings today. I triaged 40 emails — 6 need you. John moved Thursday's standup, conflicts with your client call — I've drafted a reschedule for your approval. Focus block 10-12 is protected. Investor update due Friday — I've drafted an outline." You reply "yes" and get on with your morning. Zero data left your machine.

**After 6 months:** The agent auto-sends routine replies in your voice. It knows your top clients are always priority. It preps investor updates unprompted. It built itself a tool for parsing your weekly analytics. You approved everything along the way, but you barely think about it anymore.

---

## Personas

**Privacy Migrant** — Using ChatGPT/Google Assistant, increasingly uncomfortable. Not necessarily technical. Runs a small business, manages a household, or works in confidentiality-sensitive fields. Biggest headache: no alternative that doesn't require becoming a sysadmin.

**Tinkerer** — Technical user comfortable with Docker and CLI. Doesn't want weeks of config and ongoing SRE. Biggest headache: the gap between "I got it running" and "it actually works well."

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

Six modules. One binary. Parallel development tracks. Items marked ✅ are already implemented — see `backlog/GAP-ANALYSIS.md` for the full AS-IS assessment.

<!--
Stories are atomic. Priorities: must (ship-blocking), should (launch quality),
could (fast follow), future (later phase). Each story maps to one module.
Impl notes reference OPENCLAW-REFERENCE.md.
-->

### ClawSmith — The Blueprint Engine (THE PRODUCT)

This is the product. Everything else is infrastructure. Blueprints are complete agent designs that programmatically configure every dimension of OpenClaw for a specific job.

- [ ] **Use-case blueprints** `must`
  Blueprints organized by what you're replacing, not abstract archetypes. Each blueprint configures: identity, personality, tools, skills, cron, integrations, security posture, autonomy model, memory policy, model routing, egress rules.
  - "Email Manager" — inbox zero, triage, auto-reply, morning digest
  - "Stock Trading Assistant" — market monitoring, research, alerts, risk guardrails
  - "Meal Planner" — nutrition, shopping lists, weekly plans, dietary preferences
  - "AI Blog Maintainer" — research, writing, editorial workflow, publish approval
  - "Replace Google Assistant" — email + calendar + tasks + full-day orchestration
  - "Founder's Ops" — inbox zero, investor updates, hiring pipeline
  - "Family Hub" — shared calendar, chores, meals, coordination
  - _Impl note: YAML files in configs/blueprints/. Use-case framing is presentation; operational dimensions are implementation. See OPENCLAW-REFERENCE.md → Blueprint System Design._

- [ ] **Blueprint customization** `must`
  Ask blueprint-specific questions during setup: dietary restrictions (meal planner), risk tolerance (trading), communication style (email), priority contacts (founder). 1-3 questions per blueprint. Apply to customize the design before forging the agent.

- [x] **AI-powered config inference** `should` ✅
  `clawhq init --smart` — describe what you need in plain language, system selects blueprint + configures integrations + sets boundaries. Uses local Ollama. Falls back to guided setup.

- [x] **Guided setup** `must` ✅
  `clawhq init --guided` — structured flow: basics (name, timezone, waking hours) → blueprint selection → integration setup with live credential validation → model routing.

- [x] **Config generation with landmine prevention** `must` ✅
  Every forged config passes all 14 landmine rules. Generation cannot produce a broken config. Output: `openclaw.json`, `.env`, `docker-compose.yml`, `Dockerfile`, identity files, tools, skills, cron jobs.
  - _Impl note: See OPENCLAW-REFERENCE.md → The 14 Configuration Landmines._

- [x] **Integration auto-detection** `should` ✅
  Detect available services from what user connects. iCloud email → suggest iCloud calendar. Ollama running → discover models, recommend routing.

- [ ] **Community blueprints** `future`
  Contribute and install community blueprints. Safety checks enforce Layer 1 security baselines can't be loosened.

### ClawForge — Install and Deploy

One command: working agent. Acquire engine, build container, deploy with pre-flight checks.

- [ ] **Installer** `must`
  `clawhq install` — pre-req detection (Docker, Node.js, Ollama), engine acquisition (from source or trusted cache), deployment directory scaffold (`~/.clawhq/`), `clawhq.yaml` meta-config.

- [x] **Two-stage Docker build** `must` ✅
  Stage 1 (base OpenClaw) builds only if upstream changed. Stage 2 (custom tools + skills) completes in seconds. Build manifest for drift detection. Always from source, always auditable.

- [x] **Full deploy sequence** `must` ✅
  `clawhq up` → preflight checks → compose up → firewall apply → health poll → smoke test → channel verify. One command.

- [x] **Pre-flight checks** `must` ✅
  Docker running, images exist, config valid, secrets present, ports available, Ollama reachable (if configured). Each failure includes the exact fix.

- [x] **Graceful shutdown and restart** `must` ✅
  `clawhq down` preserves state. `clawhq restart` reapplies firewall, re-verifies health.

- [x] **Channel connection** `should` ✅
  `clawhq connect` — guided messaging channel setup (Telegram, WhatsApp, Signal, Discord) with inline validation.

- [x] **Post-deploy smoke test** `should` ✅
  Send test message, verify coherent response, confirm identity files loaded, probe each integration.

### ClawAdmin — Security and Compliance

Hardened by default. Every action auditable. Every byte that leaves the machine accounted for.

- [x] **Container hardening** `must` ✅
  Applied automatically based on blueprint security posture. `cap_drop: ALL`, read-only rootfs, `no-new-privileges`, non-root UID 1000, tmpfs, ICC disabled, resource limits. Blueprints can tighten but never loosen.

- [x] **Egress firewall** `must` ✅
  iptables chain `CLAWHQ_FWD` — DNS + HTTPS to allowlisted domains only (per-integration). Reapplied after every network recreate.

- [ ] **Credentials management** `must`
  `credentials.json` (mode 0600) for integration credentials. `.env` (mode 0600) for secrets. Live health probes per integration. `clawhq creds` reports status. Never in config files, never logged.
  - _Note: `.env` + `clawhq creds` implemented. `credentials.json` separate store is new work._

- [x] **PII and secret scanning** `should` ✅
  `clawhq scan` — detect PII patterns, secret patterns (`ghp_*`, `sk-ant-*`, `AKIA*`), dangerous filenames. Filter false positives. Include git history with `--history`.

- [x] **Audit trail** `should` ✅
  Three audit systems: tool execution (what the agent did), secret lifecycle (HMAC-chained, tamper-evident), egress (what data left the machine). All append-only JSONL.

- [x] **Data egress audit** `should` ✅
  `clawhq audit --egress` — every outbound API call: timestamp, provider, model, tokens, data category, cost. Zero-egress attestation when no cloud calls made.

### ClawOps — Keep It Alive

Day-2 through day-365. The reason agents survive past month one.

- [x] **Doctor** `must` ✅
  `clawhq doctor` — checks every known failure mode: 14 config landmines, file permissions, credential health, container resources, firewall state, identity file sizes, cron syntax, memory health. `--fix` auto-corrects safe issues.

- [x] **Predictive health alerts** `should` ✅
  Memory growth trending → alert before degradation. Credential expiry → 7-day advance warning. Quality degradation → diagnose likely causes. Projected timeline, not just "something is wrong."

- [x] **Status dashboard** `should` ✅
  `clawhq status` — agent state, integration health, cost breakdown (local vs. cloud), cron status, workspace metrics, egress summary, active alerts. `--watch` for live updates.

- [x] **Encrypted backup and restore** `must` ✅
  `clawhq backup` — GPG-encrypted snapshots of workspace, config, credentials, cron, identity. `clawhq backup restore` validates integrity, applies, runs doctor.

- [x] **Safe upstream updates** `should` ✅
  `clawhq update` — changelog with breaking changes highlighted, pre-update snapshot, rebuild, healthcheck, reapply firewall. Failure → instant rollback to previous image.

- [ ] **Monitor daemon** `should`
  Background health check loop. Configurable thresholds and alert routing (terminal, webhook, cloud). Wraps existing predictive health into a persistent service.

- [x] **Activity digest** `should` ✅
  Daily summary: tasks completed, tasks queued for approval, problems found with proposed solutions, emails triaged, integrations used, egress summary. Proactive — the agent surfaces what matters.

- [x] **Health self-repair** `could` ✅
  Auto-reconnect on network drop. Auto-restart on Gateway crash. Auto-reapply firewall on bridge change.

### ClawConstruct — Grow the Agent

The retention mechanism. The agent at month 6 does more than at day 1.

- [x] **Skill management** `must` ✅
  `clawhq skill install/update/remove/list` — sandboxed vetting, AI-powered scanning, approval before install, rollback snapshots. TOOLS.md auto-updated.

- [x] **Approval queue** `should` ✅
  High-stakes actions queued for user approval via messaging channel. Approve, reject (with reason → preference learning), or let expire.

- [x] **Portable export** `must` ✅
  `clawhq export` — identity files, memory archive, config (secrets redacted), integration manifest, history. Works with raw OpenClaw if user leaves. `--mask-pii` option.

- [x] **Verified destruction** `must` ✅
  `clawhq destroy` — stop, remove volumes, wipe workspace, wipe secrets, remove images, remove firewall, generate signed destruction manifest. Dry-run first.

- [ ] **Identity governance** `could`
  Token budget tracking per identity file. Staleness detection. Review prompts. Customization preservation on regenerate.

- [ ] **Memory lifecycle** `could`
  Three tiers: hot (7 days, full fidelity), warm (7-90 days, summarized), cold (90+ days, compressed). LLM-powered summarization at each transition. PII masking.

- [ ] **Decision trace** `could`
  "Why did you do that?" — agent cites rules, preferences, context that drove a decision. User corrections feed into preference learning.

### ClawHQ Cloud — The Business

Optional. The product works without it. Zero-trust by design.

- [ ] **Trust mode management** `should`
  Three modes: Paranoid (no cloud, default), Zero-Trust (outbound only, signed commands, user-approved), Managed (auto-approved ops, content architecturally blocked). Kill switch: `clawhq cloud disconnect`.

- [ ] **Health heartbeat** `should`
  Agent-initiated HTTPS to cloud. Reports: state, uptime, container health, integration status, memory sizes, version, error codes. Never reports content. Every payload logged locally for user inspection.

- [ ] **Command queue** `should`
  Agent polls for signed commands. Verifies signature. Checks allowed list for trust mode. Executes or rejects. Content-access commands have NO handler — architecturally blocked.

- [ ] **agentd daemon** `could`
  Managed mode wrapper. Starts heartbeat + command poller. Installable as systemd/launchd service. Foundation for managed hosting.

- [ ] **Managed hosting** `future`
  Same platform on DigitalOcean/Hetzner. Cloud-init provisioning, DNS + SSL, reverse proxy. We manage the host, never the contents.

- [ ] **Remote dashboard** `future`
  Web console at clawhq.com. Account management, fleet view, update notifications, security advisories. Never shows agent content.

- [ ] **Blueprint library** `future`
  Community blueprints. Submission, validation, safety checks.

- [ ] **Migration tools** `future`
  ChatGPT conversation import. Google Assistant routine import. Contact/calendar bootstrapping. "Replace my X" wizard.

---

## How the Agent Grows Over Time

**Week 1:** Baseline works. Email triage, calendar management, morning briefs. Everything on local models.

**Month 1:** You install a Slack skill (sandboxed, vetted, approved). Add an OpenAI provider for research only. Your email triage stays 100% local.

**Month 3:** Three new integrations (Notion, Linear, custom API). Egress dashboard shows exactly which providers get which data. Every change in the audit log with rollback.

**Month 6:** 12 skills, 6 integrations, 3 providers, 8 tools — all through the safe pipeline. Nothing runs that you can't trace. Rollback any change with one command.

This pipeline — discover → vet → sandbox → approve → install → monitor → rollback — is what makes expansion safe instead of scary.

---

## Build Order

Parallel tracks, not sequential phases. See `backlog/GAP-ANALYSIS.md` for AS-IS/TO-BE analysis. See `backlog/backlog.json` for sprint-ready items.

**Track A (Blueprints)** — The product. Use-case blueprints, customization, AI inference. Ship value immediately with existing code.

**Track B (Installer)** — One-command install. Pre-reqs, directory scaffold, engine acquisition, path migration.

**Track C (Skills)** — Agent capabilities that blueprints need. Email-digest, auto-reply, market-scan, meal-plan.

**Track D (Cloud)** — Trust modes, heartbeat, command queue, agentd. Starts after installer foundation.

**Track E (Source Reorg)** — Module barrel exports, then physical file moves. Can run anytime.

**Track F (Polish)** — credentials.json store, monitor daemon, web dashboard.

---

## What We're NOT Building

- **A fork of OpenClaw** — We configure it. We don't modify it.
- **A competing agent framework** — We're the platform layer, not the engine.
- **A model routing engine** — OpenClaw handles model calls. We set policy via config.
- **Multiple CLI tools** — One binary, flat commands. Modules are internal architecture. (AD-01)
- **A skill marketplace** — ClawHQ's construct skill reads marketplace skills as inspiration, rebuilds from scratch inside the agent's security boundary. The marketplace is a curriculum, not a supply chain.
- **A cloud AI service** — We don't host models, don't train on data, don't see content. Self-operated is the product.

---

## Why Not the Alternatives

10+ OpenClaw hosting providers exist — they all stop at deploy. Default config on shared infrastructure. Nobody goes past deploy. Nobody forges purpose-built agents from blueprints.

ClawHQ's moat: it's the complete platform — install through decommission — with blueprints that turn a generic agent into a purpose-built one, opinionated security that works out of the box, and a growth loop that makes the agent more capable over time.

```
Raw framework ←────────────────────────────────→ Platform lock-in
OpenClaw         Basic hosting      ClawHQ          Big-tech agents
(powerful,       (default config,   (blueprints +   (polished,
 expert-only)    no lifecycle)      full lifecycle)  captive)
```

---

## Risks & Open Questions

**Risks:**
- Local model quality isn't good enough → mitigation: intelligent routing escalates to cloud; local models improving rapidly
- OpenClaw breaking changes → mitigation: pin to known-good versions, compatibility shims
- Blueprint ecosystem doesn't attract contributors → mitigation: ship excellent built-in blueprints covering 80% of use cases
- Skill supply chain compromise → mitigation: sandboxed vetting, AI scanning, allowlists, rollback
- Privacy Migrants don't care enough to self-host → mitigation: managed mode exists, but we lead with self-operated

**Open questions:**
- [ ] Phase 0 candidates — Who are the 3-5 Privacy Migrants? What are they replacing?
- [ ] Local model minimum bar — Which Ollama models are good enough for which task categories?
- [ ] OpenClaw relationship — Inform? Partner?
- [ ] Pricing — Cost to run one managed agent?
- [ ] Encryption model — User-held keys for at-rest workspace encryption?

---

## Links

- OpenClaw Implementation Reference: `docs/OPENCLAW-REFERENCE.md`
- Solution Architecture: `docs/ARCHITECTURE.md`
- Gap Analysis: `backlog/GAP-ANALYSIS.md`
- Backlog: `backlog/backlog.json`
