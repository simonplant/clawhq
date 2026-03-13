# ClawHQ

> One-liner: Your AI agent runs on your hardware, talks to your services, and never sends a byte to anyone you didn't choose. ClawHQ makes that possible without a PhD in DevOps.

**Owner:** [Name] · **Status:** Draft · **Updated:** 2026-03-12

---

## The Problem

The big 4 AI companies (OpenAI, Google, Anthropic, Apple) are building personal AI agents that know everything about you — your emails, calendar, tasks, health, finances, relationships. They store it on their servers. They train on it. They lose it in breaches. They shut down features and your data goes with them. You have zero sovereignty over the most intimate dataset that has ever existed about you.

OpenClaw is the escape hatch — the most powerful open-source framework for persistent AI agents, running in a Docker container you control. But it's nearly impossible to operate. Setting up a production agent means wrangling ~13,500 tokens of configuration across 11+ files, dodging 14 silent landmines that produce no errors when misconfigured. Memory bloats to 360KB in 3 days. Credentials expire silently. Identity files corrupt and drift. Security is entirely opt-in. This is full-time SRE work. Most deployments are abandoned within a month.

So today you choose between **surveillance AI** (polished, easy, you own nothing) or **raw framework** (sovereign, powerful, months of expertise required). Nobody makes the sovereign option usable. That's the gap.

---

## Why Now

10+ hosting providers have appeared for OpenClaw, proving demand — but they all stop at deploy and most just run default config on shared infrastructure, which is barely better than the big 4 for privacy. Meanwhile, the big 4 are accelerating: ChatGPT's memory is persistent, Gemini is embedded in every Google service, Apple Intelligence is on-device but locked to their ecosystem. Every month that passes, more people hand over more data to platforms they don't control. The framework itself is maturing fast (sandbox isolation, Ollama integration, plugin channels), creating a real technical foundation for local-first agents — but also more configuration surface area that users can't manage. The window for a privacy-first control panel is now.

---

## The Solution

ClawHQ is the control panel that makes OpenClaw a real alternative to big-tech AI. It covers the complete agent lifecycle — Plan, Build, Secure, Deploy, Operate, Evolve, Decommission — as a single Go binary you install on your own hardware. Local models are the default. Cloud APIs are opt-in, per-task, with full visibility into what data leaves your machine. Templates map to the things you're actually replacing (Google Assistant, ChatGPT Plus, a human PA). Setup takes 30 minutes, not weeks. And the agent gets smarter over time because ClawHQ manages the feedback loop that makes it learn your preferences, not just execute commands.

**Core bet:** People will choose a sovereign AI agent over a big-tech one — if the sovereign option isn't dramatically harder to use.

---

## Design Principles

These aren't aspirations. They're constraints that flow through every design decision, every story, every line of code.

**Local-first.** Local models (Ollama) are the default for all agent tasks. Cloud APIs (Anthropic, OpenAI, Google) are opt-in escalation — enabled per-task-category, not globally. The agent works fully air-gapped. If a user never configures a cloud API key, their agent still functions for daily use. This is the architectural commitment that makes ClawHQ different from "a better way to send your data to OpenAI."

**Transparent.** The user knows exactly what their agent did, what data it touched, and what left their machine — without asking. Every agent session produces a human-readable activity summary. Every outbound API call is logged with the provider, token count, and data category. The agent doesn't operate in the dark.

**Sovereign.** Self-operated is the primary product, not an equal sibling to managed hosting. Your data stays on your hardware by default. `clawhq export` gives you everything portable. `clawhq destroy` proves it's gone. No lock-in to ClawHQ, no lock-in to any cloud provider, no lock-in to any model provider.

**Gets better, not worse.** The agent improves through use. User corrections become preference updates. Interaction patterns inform autonomy tuning. Memory is actively managed, not just accumulated. An agent at 6 months is dramatically more useful than at day 1 — this is the retention mechanism that keeps people from going back to ChatGPT.

---

## Who It's For

**The Privacy Migrant** — Currently using ChatGPT, Google Assistant, or Apple Intelligence and increasingly uncomfortable with the trade-off. Not necessarily technical — they might run a small business, manage a household, or work in a field where confidentiality matters (legal, medical, financial). Their biggest headache is that there's no alternative that doesn't require becoming a sysadmin. They'd switch to something that gives them the same daily utility without the surveillance.

**The Tinkerer** — Technical user running or wanting to run an OpenClaw agent on their own hardware. Comfortable with Docker and CLI but doesn't want to spend weeks on configuration and ongoing SRE. Their biggest headache is the gap between "I got it running" and "it actually works well." They'd pay for something that handles security, monitoring, and config management so they can focus on what the agent does.

**The Fleet Operator** — Manages agents for multiple people or use cases (family coordinator, team assistant, client-facing bots). Cares most about fleet-wide visibility, consistent security posture, and operational efficiency. Currently solving this with custom scripts and manual SSH sessions.

---

## What Success Looks Like

- **Time to working agent:** < 30 minutes from install to first useful interaction (currently weeks)
- **Config-related failures:** 0 silent landmines shipped (currently 14 possible)
- **Data leaving the machine:** 0 bytes by default; user explicitly opts in per-task-category for cloud APIs
- **Agent improvement rate:** Measurable increase in autonomous task completion at 30/60/90 days (baseline TBD from Phase 0)
- **Churn at 30 days:** < 20% (most raw OpenClaw deployments abandoned within a month)

---

## What We're Building

<!--
Each toolchain is a feature. Stories are atomic — one behavior each.
Personas: Privacy Migrant, Tinkerer, Fleet Operator.
Impl notes reference OPENCLAW-REFERENCE.md for implementation details.
-->

### 1. Plan — Agent Setup

From "I want to replace Google Assistant" to a running agent — in 30 minutes, without touching a config file. The system infers the right config from what you connect and what you tell it, not from a 50-question form.

- [ ] **Use-case templates** `P0` `L`
  As a Privacy Migrant, I want to pick what I'm replacing (not an abstract personality archetype) so that my agent is immediately useful for my actual daily workflow.
  - Given a user runs `clawhq init`, when templates are presented, then they're organized by what they replace: "Replace Google Assistant" (daily life management), "Replace ChatGPT Plus" (research + writing partner), "Replace my PA" (calendar, email triage, task management), "Family Hub" (shared calendar, chore tracking, meal planning), "Research Co-pilot" (deep research, citation management, writing), "Founder's Ops" (inbox zero, investor updates, hiring pipeline)
  - Given a user selects a template, when preview is shown, then it displays: what integrations are needed, what the agent will handle autonomously vs. with approval, what local model requirements are, estimated daily cost (local vs. cloud), and a "day in the life" narrative showing what a typical day looks like with this agent
  - Given each template, when config is generated, then it maps to full operational dimensions internally: personality, security posture, monitoring, memory policy, cron config, autonomy model, model routing strategy
  - _Impl note: Templates are YAML files. Use-case framing is the presentation layer; operational dimensions (Guardian/Assistant/Coach/etc.) are the implementation layer. See OPENCLAW-REFERENCE.md → Template System Design._

- [ ] **AI-powered config inference** `P0` `L`
  As a Privacy Migrant, I want to describe what I need in plain language and have the system figure out the config so that I don't need to understand operational dimensions I've never heard of.
  - Given a user runs `clawhq init --smart`, when they describe their needs ("I want an agent that manages my email, calendar, and tasks, checks in with me every morning, and never touches my health data"), then the system selects the best template, configures integrations, sets autonomy levels, and defines boundaries — presenting the result for approval before generating
  - Given the AI inference runs, when the user reviews the proposed config, then they see a plain-language summary ("Here's what I understood: ...") with the ability to adjust any aspect conversationally before generating
  - Given the inference is wrong on any dimension, when the user corrects it, then the correction is applied and the summary regenerates
  - _Impl note: Uses a local model call (Ollama) to map natural language → template selection + override parameters. Falls back to guided questionnaire if local model isn't available._

- [ ] **Guided questionnaire (fallback)** `P0` `M`
  As a Tinkerer, I want a structured setup flow as an alternative to AI inference so that I can make precise choices about every operational dimension.
  - Given a user runs `clawhq init --guided`, when the flow starts, then it walks through: basics (name, timezone, waking hours) → template selection → integration setup with credential validation → autonomy and boundary configuration
  - Given any credential is entered, when validation runs, then the credential is tested live before proceeding
  - _Impl note: See OPENCLAW-REFERENCE.md → Credential Health Probes for per-integration health check details._

- [ ] **Integration auto-detection** `P0` `M`
  As a Privacy Migrant, I want the setup to detect what I have and suggest accordingly so that I'm not asked about services I don't use.
  - Given a user connects their email, when auto-detection runs, then it discovers available calendar and task integrations from the same provider (e.g., iCloud email → suggest iCloud calendar) and pre-fills the integration config
  - Given a user has Ollama running locally, when detection runs, then it discovers available models and recommends the optimal routing strategy for the selected template

- [ ] **Config generation with landmine prevention** `P0` `L`
  As a Tinkerer, I want the generated config to be impossible to break so that I never hit a silent failure.
  - Given any setup path completes (AI inference, questionnaire, or template), when config is generated, then it produces: `openclaw.json`, `.env`, `docker-compose.yml`, all identity files, `cron/jobs.json`
  - Given config is generated, when validation runs, then every file passes all 14 landmine rules — generation cannot produce a broken config
  - Given a generated `openclaw.json`, when the Gateway loads it, then it passes TypeBox schema validation with zero unknown keys
  - _Impl note: See OPENCLAW-REFERENCE.md → The 14 Configuration Landmines for full rule set. See → Config Generator Output for file-to-landmine mapping._

- [ ] **Config validation engine** `P0` `M`
  As a Tinkerer, I want every config write validated against all known failure modes so that I never accidentally break my agent.
  - Given any config change (via any path), when the change is applied, then all 14 landmine rules are checked pre-write
  - Given a validation failure, when results are shown, then each failure includes the specific rule violated, what will break, and exact fix instructions
  - _Impl note: See OPENCLAW-REFERENCE.md → Four Integration Surfaces (Surface 1). Rate limit: 3 req/60s for config writes via WebSocket._

- [ ] **Community templates** `P1` `M`
  As a Tinkerer, I want to contribute and install community templates so that the platform covers use cases the core team didn't design for.
  - Given a community template is submitted, when it's reviewed, then it must pass safety checks and cannot loosen Layer 1 security baselines
  - Given a community template maps to a real use case (e.g., "Chronic Illness Tracker," "Real Estate Agent," "Academic Researcher"), when it's published, then it follows the same use-case-first presentation as built-in templates

### 2. Model Routing — Local-First Intelligence

The agent's brain should run on your hardware by default. Cloud APIs are the escalation path, not the default — and every escalation is visible, auditable, and user-approved.

- [ ] **Local-first model routing** `P0` `L`
  As a Privacy Migrant, I want my agent to use local models for everything it can and only call cloud APIs when I've explicitly allowed it so that my data stays on my machine by default.
  - Given a fresh install with Ollama running, when the agent processes a task, then it routes to the best available local model first
  - Given a task exceeds local model capability (determined by task complexity scoring), when escalation is needed, then the agent checks user-configured escalation policy before calling any cloud API
  - Given no cloud API keys are configured, when any task runs, then the agent operates fully on local models with graceful degradation — never errors out because cloud isn't available
  - _Impl note: Task complexity scoring based on token count, required capabilities (reasoning, code gen, long context), and template's quality threshold. Ollama model discovery via `ollama list`. See OPENCLAW-REFERENCE.md → Key Configuration Surfaces (AI Models)._

- [ ] **Per-category cloud opt-in** `P0` `M`
  As a Privacy Migrant, I want to choose which types of tasks can use cloud models so that I control exactly what data leaves my machine.
  - Given `clawhq init` runs, when model routing is configured, then the user sets escalation policy per task category: research (may need cloud for quality), email triage (local-only — contains private data), calendar management (local-only), creative writing (user choice), code generation (user choice)
  - Given a task in a local-only category, when cloud escalation would normally trigger, then the agent uses the best local model available and never calls cloud — even if quality is lower
  - Given a task in a cloud-allowed category, when escalation triggers, then the activity log records: provider, model, token count, data category sent

- [ ] **Intelligent task-level routing** `P0` `L`
  As a Tinkerer, I want the agent to automatically pick the cheapest/most-private model that can handle each specific task so that I'm not overpaying or over-sharing.
  - Given a simple task (morning brief summary, task list formatting), when the router evaluates it, then it routes to local small model (e.g., Llama 3 8B via Ollama)
  - Given a moderate task (email draft, meeting prep), when the router evaluates it, then it routes to local large model (e.g., Llama 3 70B) or cloud-small (Haiku) based on escalation policy
  - Given a complex task (deep research synthesis, long-form writing), when the router evaluates it and cloud is allowed for that category, then it routes to cloud-large (Sonnet/Opus) with the data sent logged
  - Given routing history accumulates, when the router learns, then it improves task-to-model matching based on actual outcomes (user accepted result vs. user asked to redo)

- [ ] **Data egress visibility** `P0` `M`
  As a Privacy Migrant, I want to see exactly what data left my machine, to which provider, and when so that I have proof of my privacy posture.
  - Given any cloud API call is made, when it completes, then the egress log records: timestamp, provider (Anthropic/OpenAI/Google), model, token count (input/output), data category (email, calendar, research, etc.), cost
  - Given `clawhq status --egress` runs, when the report renders, then it shows: total data sent per provider (today, week, month), breakdown by category, and a "zero egress" badge if no cloud calls were made
  - Given `clawhq audit --egress` runs, when the detailed log is shown, then every individual cloud call is listed with enough context to understand what was sent (without reproducing the actual content)

- [ ] **Air-gapped mode** `P1` `M`
  As a Tinkerer, I want to run my agent with zero network access to external APIs so that I can guarantee nothing leaves my machine.
  - Given `clawhq init --air-gapped` runs, when config is generated, then no cloud API keys are configured, egress firewall blocks all outbound except DNS and local network, and the agent uses only Ollama models
  - Given air-gapped mode is active, when any code path attempts a cloud API call, then it's blocked at the firewall level (defense in depth — not just config, but network enforcement)

### 3. Build — Container Images

From source code to auditable, reproducible container images — with every tool, skill, and integration baked in. Two-stage Docker build so most rebuilds take seconds, not minutes.

- [ ] **Two-stage Docker build** `P0` `L`
  As a Tinkerer, I want to build my agent image from source so that I can audit every line of code running in the container.
  - Given a user runs `clawhq build`, when the build starts, then Stage 1 (base image) builds only if upstream or apt packages changed; Stage 2 (custom layer) completes in seconds
  - Given the build completes, when verification runs, then both image layers exist, declared binaries are executable, and a build manifest is generated
  - _Impl note: ClawHQ wraps Docker CLI, builds on top of OpenClaw's Dockerfiles — does NOT modify them. See OPENCLAW-REFERENCE.md → Two-Stage Docker Build Architecture._

- [ ] **Build reproducibility verification** `P1` `S`
  As a Tinkerer, I want to verify my image hasn't drifted from a known state so that I can detect supply chain issues.
  - Given a previous build manifest exists, when `clawhq build --verify` runs, then it rebuilds and compares against the manifest, flagging any differences

- [ ] **Selective rebuild** `P1` `S`
  As a Tinkerer, I want to rebuild only the stage that changed so that iteration is fast.
  - Given `clawhq build --stage2-only` runs, then only the custom layer rebuilds using the existing base image

### 4. Secure — Hardening & Monitoring

Hardened by default, monitored continuously. Every secret managed, every credential health-checked, every skill vetted. Security is the baseline, not a feature flag.

- [ ] **Container hardening** `P0` `L`
  As a Tinkerer, I want my agent container hardened automatically based on my template's security posture so that I don't have to manually configure Docker security options.
  - Given a template with `security.posture: hardened`, when the deployment bundle is generated, then `docker-compose.yml` includes: `cap_drop: ALL`, read-only rootfs, `no-new-privileges`, non-root UID 1000, tmpfs with noexec/nosuid, ICC disabled, resource limits per posture level
  - Given the container is running, when Doctor checks security, then it verifies all hardening controls are active and alerts on any regression
  - _Impl note: See OPENCLAW-REFERENCE.md → Container Hardening Matrix for full posture comparison (Standard/Hardened/Paranoid)._

- [ ] **Egress firewall** `P0` `M`
  As a Tinkerer, I want outbound network traffic restricted so that my agent can't exfiltrate data to unexpected destinations.
  - Given `clawhq up` runs, when the container starts, then iptables chain `CLAWHQ_FWD` is applied: ESTABLISHED/RELATED → DNS (53) → HTTPS (443) to allowlisted domains only (configured per template + user cloud opt-in) → LOG+DROP everything else
  - Given a cloud API provider is opted-in for specific categories, when the firewall is generated, then only that provider's API domains are allowlisted — not the entire internet over HTTPS
  - Given `docker compose down` was run, when `clawhq up` or `clawhq restart` runs, then the firewall is automatically reapplied
  - _Impl note: See OPENCLAW-REFERENCE.md → Egress Firewall Implementation. The domain-allowlist approach is stronger than the original "allow all HTTPS" — it enforces the local-first principle at the network level._

- [ ] **Secrets management** `P0` `M`
  As a Tinkerer, I want secrets managed separately from config so that credentials never leak into config files or version control.
  - Given the config generator runs, when secrets are collected, then they're written to `.env` with 600 permissions, never to `openclaw.json` or workspace files
  - Given Doctor runs, when the secrets check executes, then it scans all config files for embedded secrets and alerts on any found
  - Given `clawhq creds` runs, when credential checks execute, then each integration's health probe reports valid/expired/failing

- [ ] **PII & secret scanning** `P0` `M`
  As a Tinkerer, I want agent-created repos and files scanned for leaked PII and secrets so that I catch exposures before they cause harm.
  - Given `clawhq scan` runs, then it checks for: PII patterns (names, SSN, credit cards), secret patterns (`ghp_*`, `sk-ant-*`, `AKIA*`, Bearer tokens, JWTs), and dangerous filenames (`.env`, `*.pem`, `*.key`)
  - Given `clawhq scan --history` runs, then git history is included
  - Given a pattern matches, then false positives are filtered (`CHANGE_ME` placeholders, env var references, comments)
  - _Impl note: See OPENCLAW-REFERENCE.md → PII & Secret Scanning Patterns._

- [ ] **Supply chain security for skills** `P1` `M`
  As a Tinkerer, I want community skills vetted before installation so that I don't introduce malicious code into my agent.
  - Given a community skill is being installed, when vetting runs, then AI-powered scanning checks for suspicious patterns and VirusTotal integration scans artifacts
  - Given an internal allowlist exists, when a non-allowlisted skill install is attempted, then it's blocked with an explanation

### 5. Deploy — Container Orchestration

One command: container up, firewall applied, networks verified, channels connected, health confirmed.

- [ ] **Pre-flight checks** `P0` `M`
  As a Tinkerer, I want deployment prerequisites validated before anything starts so that I get clear errors instead of mysterious failures.
  - Given `clawhq up` runs, when pre-flight checks execute, then it validates: Docker daemon, images exist, config valid, secrets present, external networks exist, ports available, permissions correct, Ollama reachable (if local models configured), no orphaned containers
  - Given any check fails, then the error includes the exact fix

- [ ] **Full deploy sequence** `P0` `L`
  As a Tinkerer, I want one command to go from built images to a running, verified agent.
  - Given `clawhq up` runs, then it sequences: compose up → firewall apply → health poll (60s timeout) → cron scheduler verify → channel connection verify → smoke test
  - Given health poll fails, then container logs, network state, and config issues are shown
  - _Impl note: See OPENCLAW-REFERENCE.md → Four Integration Surfaces (Surface 4). Gateway must be healthy at :18789/healthz before further operations._

- [ ] **Channel connection** `P0` `M`
  As a Privacy Migrant, I want guided messaging channel setup so that I can connect Telegram/WhatsApp/Signal without reading API docs.
  - Given `clawhq connect` runs for a channel, then it walks through provider-specific setup with inline validation
  - Given `clawhq connect --test` runs, then it verifies bidirectional message flow

- [ ] **Post-deploy smoke test** `P0` `S`
  As a Tinkerer, I want automatic verification that the agent is actually working — not just "container healthy but agent broken."
  - Given deployment and channel connection are complete, then the smoke test sends a test message, verifies coherent response, confirms identity files are loaded, and probes each connected integration

- [ ] **Graceful shutdown and restart** `P0` `S`
  As a Tinkerer, I want shutdown that preserves state and restart that reapplies firewall.
  - Given `clawhq down` runs, then containers stop gracefully preserving workspace state
  - Given `clawhq restart` runs, then containers restart, firewall is reapplied, health is re-verified

- [ ] **Infrastructure provisioning** `P2` `XL`
  As a Privacy Migrant (managed mode), I want one-click deployment to cloud infrastructure so that I never touch a terminal. This is the convenience tier for people who accept the trade-off of running on managed infrastructure.
  - Given a managed mode user selects deploy, then it handles VM creation, DNS, SSL, reverse proxy, and Docker setup
  - _Impl note: Managed mode is secondary to self-operated. See OPENCLAW-REFERENCE.md → Managed Mode Architecture. The operational boundary ensures we never see agent contents._

### 6. Operate — Predictive Operations

Not just diagnostics and dashboards — predictive intelligence that catches problems before they happen, fixes what it can automatically, and tells you what your agent actually did.

- [ ] **Doctor — preventive diagnostics** `P0` `XL`
  As a Tinkerer, I want a single command that checks every known failure mode so that I catch problems before they cause visible failures.
  - Given `clawhq doctor` runs, then it checks: all 14 configuration landmines, file permissions, credential health (live probes), cross-file consistency, memory health, cron health, container resources, network state, config drift, model availability (Ollama models still present and loadable)
  - Given checks complete, then each shows pass/warn/fail with specific fix instructions
  - Given `clawhq doctor --fix` runs, then safe issues (permissions, firewall) are auto-fixed
  - _Impl note: Reuses OpenClaw's `openclaw doctor --json` as subset, adds ClawHQ-specific checks. See OPENCLAW-REFERENCE.md → The 14 Configuration Landmines._

- [ ] **Predictive health alerts** `P0` `L`
  As a Tinkerer, I want the system to predict problems and act before I notice so that my agent runs like autopilot, not a dashboard I have to watch.
  - Given memory is growing, when trend analysis runs, then it predicts when hot tier will exceed budget and auto-triggers compaction before overflow ("Memory at 78KB, growing 12KB/day — auto-compacting in 2 days unless growth slows")
  - Given credential expiry is tracked, when an API key has a known expiry, then a renewal notification fires 7 days before expiry with a one-command renewal flow
  - Given agent response quality is measurable (user corrections per session, redo requests, escalation rate), when quality degrades, then the system diagnoses likely causes (identity bloat, memory overflow, model routing regression) and suggests fixes
  - Given any metric crosses a warning threshold, when the alert fires, then it includes the projected timeline and automated remediation if available — not just "something is wrong"

- [ ] **Status dashboard** `P0` `L`
  As a Tinkerer, I want a single-pane view of agent health, integrations, cost, cron, workspace, and data egress so that I know everything's fine at a glance.
  - Given `clawhq status` runs, then it shows: agent state, integration health, cost (by model, local vs. cloud breakdown), cron job status, workspace metrics (memory by tier, identity budget), data egress summary (bytes sent to cloud today/week/month, zero-egress badge if applicable), and any active predictive alerts
  - Given `clawhq status --watch` runs, then it live-updates
  - _Impl note: Data sources: Docker API, Gateway WebSocket, credential probes, filesystem, egress logs. See OPENCLAW-REFERENCE.md → Three Communication Channels._

- [ ] **Intelligent cost routing** `P0` `M`
  As a Tinkerer, I want the system to minimize cost automatically by routing tasks to the cheapest capable model — with local models as the cheapest option.
  - Given a budget is configured, when usage tracking runs, then it attributes cost per-task-category and per-model: "Morning brief: $0.00 (local). Research session: $0.47 (Sonnet). Email triage: $0.00 (local)."
  - Given budget hits 75%, when the router adjusts, then it shifts eligible tasks from cloud to local models before alerting
  - Given budget hits 100%, when the cap is enforced, then cloud-escalation stops entirely and the agent operates local-only until the budget resets — never pauses completely

- [ ] **Encrypted backup and restore** `P0` `L`
  As a Tinkerer, I want encrypted snapshots of my agent's state so that I can recover from any failure.
  - Given `clawhq backup` runs, then workspace, config, credentials, cron, and identity files are encrypted with GPG
  - Given `clawhq backup restore <id>` runs, then it validates integrity, applies restore, runs Doctor, and verifies the agent starts
  - Given `clawhq backup --secrets-only` runs, then only sensitive files are backed up

- [ ] **Safe upstream updates** `P0` `L`
  As a Tinkerer, I want upstream OpenClaw upgrades that don't break my agent.
  - Given `clawhq update` runs, then it shows changelog with breaking changes highlighted, takes pre-update snapshot, rebuilds, stops/starts, healthchecks, reapplies firewall, runs Doctor
  - Given any step fails, then previous image is restored instantly (no rebuild), restarted, and verified
  - Given `clawhq update --check` runs, then it shows what would change without updating

- [ ] **Health self-repair** `P1` `M`
  As a Tinkerer, I want my agent to auto-recover from common failures.
  - Given a network drop, then auto-reconnect
  - Given a Gateway crash, then auto-restart
  - Given a bridge interface change, then firewall auto-reapply

- [ ] **Fleet management** `P1` `L`
  As a Fleet Operator, I want to monitor and manage multiple agents from a single dashboard.
  - Given `clawhq fleet` runs, then it shows aggregated health, cost, security posture, and egress across all agents
  - Given `clawhq fleet doctor` runs, then Doctor runs across all agents with per-agent results

- [ ] **Log streaming** `P1` `S`
  As a Tinkerer, I want filtered access to agent activity logs for debugging.
  - Given `clawhq logs` runs, then live container logs stream with filtering by category
  - Given `clawhq logs --cron heartbeat` runs, then per-job execution history is shown

### 7. Transparency — Know What Your Agent Did

The big 4 operate as black boxes. ClawHQ's agent is accountable. The user knows what happened, what data was touched, what left the machine, and what the agent wants to do next.

- [ ] **Activity digest** `P0` `L`
  As a Privacy Migrant, I want a daily summary of everything my agent did so that I trust it and can course-correct quickly.
  - Given the agent ran overnight, when the user checks in (via messaging channel or `clawhq digest`), then they see: tasks completed autonomously, tasks queued for approval, emails read/triaged (count + categories, not content — unless user asks), calendar changes made, integrations used, errors encountered, and data egress summary
  - Given the digest is generated, when privacy mode is active, then it summarizes by category ("read 12 emails, triaged 3 as urgent") rather than showing content — the user drills into specifics only if they want to
  - _Impl note: Digest generated by the agent itself using a local model, from structured activity logs. This is a cron-triggered skill, not a ClawHQ CLI feature._

- [ ] **Approval queue** `P0` `M`
  As a Privacy Migrant, I want to approve high-stakes actions before the agent takes them so that I maintain control without micromanaging.
  - Given the agent wants to perform an action in a requires-approval category (sending an email, creating a calendar event, completing a purchase, posting publicly), when the action is proposed, then it's queued with a plain-language description and sent to the user's messaging channel for approval
  - Given the user approves, then the action executes immediately
  - Given the user rejects, then the rejection reason (if provided) is stored as a preference signal for behavioral training
  - Given the user doesn't respond within a configurable timeout, then the action is logged as expired (not auto-approved)

- [ ] **Data egress audit** `P0` `M`
  As a Privacy Migrant, I want cryptographic proof of what data left my machine so that I can demonstrate my privacy posture.
  - Given `clawhq audit --egress` runs, then it shows every outbound API call: timestamp, provider, model, token count, data category, cost
  - Given `clawhq audit --egress --export` runs, then a signed report is generated that can be shared (e.g., for compliance, for personal records)
  - Given `clawhq audit --egress --zero` runs, then it verifies that no data left the machine in the specified period and generates a zero-egress attestation

- [ ] **"Why did you do that?" trace** `P1` `M`
  As a Privacy Migrant, I want to ask the agent why it took a specific action and get a clear answer so that I understand its reasoning.
  - Given the user asks "why did you mark that email as urgent?" (via messaging channel), when the agent responds, then it cites the specific rules, preferences, and context that drove the decision
  - Given the user disagrees with the reasoning, when they correct it, then the correction feeds into behavioral training

- [ ] **Tool execution audit trail** `P1` `M`
  As a Fleet Operator, I want every tool execution logged and searchable for compliance review.
  - Given `clawhq audit` runs, then tool execution history with timestamps, redacted inputs, and summarized outputs is displayed
  - Given `clawhq audit --compliance` runs, then an exportable report aligned with OWASP GenAI Top 10 controls is generated

### 8. Evolve — The Agent Gets Better

This is the retention mechanism. An agent that doesn't improve is just a chatbot you host yourself. An agent that learns your preferences, adapts its autonomy, and gets better at being YOUR agent — that's what keeps people from going back to ChatGPT.

- [ ] **Identity governance** `P0` `L`
  As a Tinkerer, I want my agent's identity files tracked for bloat, staleness, and contradictions so that the agent doesn't slowly become someone else.
  - Given identity files exist, when governance checks run, then token budget is tracked per file with warnings at 70%/90% thresholds vs. `bootstrapMaxChars` (default 20K)
  - Given files haven't been updated in a configurable period, then staleness detection generates review prompts
  - Given multiple identity files exist, then consistency checks flag contradictions
  - _Impl note: See OPENCLAW-REFERENCE.md → Identity Drift Research._

- [ ] **Memory lifecycle management** `P0` `L`
  As a Tinkerer, I want agent memory automatically tiered and compacted so that context windows don't overflow and quality doesn't degrade.
  - Given memory is accumulating, when hot tier exceeds 100KB or 7 days, then old memories are summarized (LLM-powered, using local model) and moved to warm tier
  - Given warm memories exceed 90 days, then they're further compressed, PII masked, and archived to cold tier
  - Given cold memories exceed retention period, then they're permanently deleted
  - _Impl note: See OPENCLAW-REFERENCE.md → Memory Lifecycle Research. ~120KB/day growth observed in production. Summarization uses local model by default (private data stays local)._

- [ ] **Preference learning from corrections** `P1` `L`
  As a Privacy Migrant, I want the agent to learn from my corrections so that it stops making the same mistakes and starts anticipating my preferences.
  - Given the user corrects an agent action (rejects an approval, edits a draft, overrides a triage decision), when the correction is logged, then it's classified: preference signal (user likes X, dislikes Y), boundary signal (never do X), or one-time override (don't generalize)
  - Given preference signals accumulate, when a threshold is reached (configurable, default 5 signals in same category), then the system proposes a preference update to the agent's identity files ("You've corrected email urgency 7 times — update: meetings with [client] are always high priority?")
  - Given the user approves a preference update, when it's applied, then the identity file is updated and the change is logged for rollback

- [ ] **Autonomy tuning from behavior** `P1` `M`
  As a Privacy Migrant, I want the system to recommend autonomy changes based on actual patterns so that the agent handles more over time without me micromanaging.
  - Given approval queue history is analyzed, when patterns emerge, then the system recommends changes: "You approved 47 of 48 email sends this month — auto-approve routine replies?" / "You rejected 3 of 4 calendar reschedule requests — require approval for all calendar changes?"
  - Given the user accepts an autonomy change, when it's applied, then the approval policy is updated and the change is logged with rollback capability
  - Given the user rejects an autonomy recommendation, when the rejection is logged, then the system doesn't recommend the same change again for a configurable cooldown period

- [ ] **Selective personality refinement** `P1` `M`
  As a Tinkerer, I want to update specific aspects of my agent's config without re-running the full setup.
  - Given `clawhq evolve --identity` runs, then the user can re-run specific questionnaire sections
  - Given changes are selected, then diffs are shown before applying
  - Given changes are applied, then manual customizations are preserved with conflicts flagged

- [ ] **Integration management** `P1` `M`
  As a Tinkerer, I want to add, remove, or swap integrations cleanly.
  - Given a new integration is added, then credential is validated, tool installed, TOOLS.md updated, cron dependencies checked
  - Given an integration is removed, then credential cleaned, tool uninstalled, identity updated, no orphaned cron dependencies
  - Given a provider is swapped (Gmail → iCloud), then the same category interface works with the new backend

### 9. Migrate — On-Ramp From Big Tech

The biggest barrier to adoption isn't setup complexity — it's starting from zero. Migration tools turn switching costs into switching momentum.

- [ ] **ChatGPT conversation import** `P1` `L`
  As a Privacy Migrant, I want to import my ChatGPT conversation history so that my new agent already knows what my old one knew.
  - Given a user has exported their ChatGPT data (Settings → Export), when `clawhq migrate --from chatgpt <export.zip>` runs, then conversation history is parsed, key facts and preferences are extracted (LLM-powered, local model), and the results are proposed as additions to USER.md and warm memory
  - Given the extracted preferences are shown, when the user reviews them, then they can approve, edit, or reject each one before it's written to identity/memory files
  - Given the import contains PII, when processing runs, then PII masking is applied to warm/cold memory and the user is warned about what was found

- [ ] **Google Assistant routine import** `P1` `M`
  As a Privacy Migrant, I want my Google Assistant routines converted to agent cron jobs so that my daily automations don't break when I switch.
  - Given a user exports their Google Assistant data (Google Takeout), when `clawhq migrate --from google-assistant <export>` runs, then routines are parsed and converted to equivalent cron job definitions in `cron/jobs.json`
  - Given a routine can't be directly mapped (requires Google-specific APIs), when the conversion runs, then it flags the gap and suggests an OpenClaw-native alternative

- [ ] **Contact and calendar bootstrapping** `P1` `M`
  As a Privacy Migrant, I want my agent to immediately know my calendar patterns and key contacts so that it's useful from day one, not after weeks of learning.
  - Given the user connects their calendar during setup, when bootstrapping runs, then the agent analyzes the last 90 days: recurring meetings, frequent contacts, scheduling patterns, busy/free patterns — and adds structured context to USER.md
  - Given the user connects their email, when bootstrapping runs, then it identifies top correspondents, response patterns, and email categories — added to USER.md as preferences
  - Given bootstrapping generates identity file content, when token budget is checked, then it stays within `bootstrapMaxChars` and prioritizes the most recent/frequent patterns

- [ ] **"Replace my X" migration wizard** `P2` `L`
  As a Privacy Migrant, I want a guided flow that walks me through replacing a specific big-tech product so that switching feels like an upgrade, not a sacrifice.
  - Given `clawhq migrate --replace "google assistant"` runs, when the wizard starts, then it: maps Google Assistant features to OpenClaw equivalents, identifies what transfers cleanly vs. what needs alternatives, sets up integrations, imports routines, and runs a comparison checklist ("✓ Morning briefing, ✓ Calendar management, ⚠ Smart home control — requires Home Assistant integration")
  - Given the comparison shows gaps, when gaps are displayed, then each includes a workaround or a link to a community template that addresses it

### 10. Decommission — Export & Destroy

End of life done right. Export everything portable. Destroy everything else. Verify the destruction cryptographically.

- [ ] **Portable export** `P0` `L`
  As a Tinkerer, I want to export my agent's identity, memory, config, and workspace into a portable bundle so that I can migrate or start fresh without losing everything.
  - Given `clawhq export` runs, then it includes: identity files + template source, memory archive (all tiers), workspace snapshot, config (secrets redacted), integration manifest (credentials excluded), interaction history, build manifest, and a README.md explaining bundle structure and how to use with raw OpenClaw
  - Given `clawhq export --mask-pii` runs, then PII is masked throughout
  - Given `clawhq export --no-memory` runs, then only identity + config are exported

- [ ] **Pre-decommission checklist** `P0` `M`
  As a Tinkerer, I want to see exactly what will be destroyed and what persists externally before I decommission.
  - Given `clawhq destroy --dry-run` runs, then it lists: all local data locations, data ClawHQ can destroy vs. data requiring manual cleanup, whether a current backup and export exist
  - Given no backup or export exists, then the user is prompted to create them first
  - Given the user confirms, then the deployment name must be typed out

- [ ] **Verified destruction** `P0` `L`
  As a Tinkerer, I want cryptographic proof that my agent's data has been completely removed.
  - Given `clawhq destroy` runs and is confirmed, then it proceeds: stop container → remove volumes → wipe workspace → wipe config → wipe secrets → remove images → remove networks → remove firewall → remove ClawHQ config → generate signed destruction manifest
  - Given `clawhq destroy --keep-export` runs, then the export bundle is preserved

- [ ] **Partial decommission** `P1` `M`
  As a Tinkerer, I want to migrate, fresh-start, or template-swap without losing everything.
  - Given a migration, then `clawhq init --import <bundle>` bootstraps a new deployment from an export
  - Given a fresh-start, then identity + memory are preserved while everything else resets

---

## How It Should Feel

- **Fast:** CLI commands respond in < 2s for reads. Builds complete Stage 2 in < 30s. Config writes propagate within 1s via WebSocket RPC. Local model routing adds < 100ms decision overhead.
- **Secure:** Hardened by default. No secret in config files. Egress firewall with domain allowlisting (not just "allow all HTTPS"). Identity files read-only. Container runs non-root with minimal capabilities.
- **Private:** Zero data leaves the machine by default. Cloud APIs are opt-in per-task-category. Every outbound call logged. Air-gapped mode available. Self-operated is the hero product.
- **Reliable:** Auto-recovery from common failures. Pre-update snapshots with instant rollback. Predictive alerts catch problems before users notice.
- **Transparent:** Daily activity digest. Approval queue for high-stakes actions. Egress audit with zero-egress attestation. "Why did you do that?" trace.
- **Improving:** Preference learning from corrections. Autonomy tuning from approval patterns. Memory actively managed. Agent at 6 months is dramatically better than at day 1.
- **Portable:** `clawhq export` produces a self-documented bundle. Zero lock-in to ClawHQ, any cloud, or any model provider. Works with raw OpenClaw if the user leaves.

---

## Tech Stack & Constraints

**Stack:** Go (single static binary) · Docker · iptables · GPG · WebSocket (Gateway communication) · Ollama (local model runtime)

**Key integrations:**
- OpenClaw Gateway → config read/write, status, health → WebSocket RPC (:18789) → token auth
- OpenClaw Workspace → identity, memory, skills, cron → filesystem read/write → direct access
- Docker Engine → container lifecycle, image builds → Docker CLI (subprocess) → Unix socket
- Ollama → local model inference → HTTP API (localhost:11434) → no auth (localhost only)
- iptables → egress firewall with domain allowlisting → CLI (subprocess) → requires sudo

**Core data model:**
- `Template` — operational profile (YAML). Fields: name, version, use_case_mapping, personality, security posture, monitoring, memory policy, cron config, autonomy model, model routing strategy, integration requirements, skill bundle
- `ModelRoutingPolicy` — per-category escalation rules. Fields: task_category, local_model_preference, cloud_allowed (bool), cloud_provider, quality_threshold, cost_cap
- `DeploymentBundle` — generated config set. Fields: openclaw.json, .env, docker-compose.yml, identity files, cron jobs, model routing config. Generated from Template + setup answers
- `EgressLog` — outbound API call record. Fields: timestamp, provider, model, token_count_in, token_count_out, data_category, cost, session_id
- `PreferenceSignal` — user correction record. Fields: timestamp, action_type, original_decision, correction, signal_type (preference/boundary/one-time), applied_to_identity (bool)
- `BackupSnapshot` — encrypted state capture. Fields: id, timestamp, type, encryption method, manifest hash
- `ExportBundle` — portable agent archive. Fields: identity, memory, workspace, config, integrations, history, build manifest

**Hard constraints:**
- Single Go binary — no runtime dependencies except Docker (and Ollama for local models)
- Must work fully air-gapped after initial build (no phone-home, no cloud dependency)
- Local models are the default; cloud APIs are opt-in per-task-category
- Generated config must pass OpenClaw's TypeBox schema validation
- All config writes go through `config.patch` RPC when Gateway is running (rate limited: 3 req/60s)
- Templates can tighten Layer 1 security baselines but can never loosen them
- Self-operated is the primary product; managed mode is a convenience tier
- Memory summarization and preference extraction use local models by default (private data stays local)

---

## What We're NOT Building

- **A fork of OpenClaw** — ClawHQ is a layer on top, not a replacement. We use OpenClaw's Dockerfiles, Gateway, agent runtime, and channel adapters as-is.
- **Message routing or model API calls** — OpenClaw handles these well. We set policy (including model routing), we don't intercept execution.
- **A competing agent framework** — We're the control panel, not the engine.
- **A no-code agent builder** — We make OpenClaw accessible, not invisible. Power users can always drop to raw config.
- **A cloud AI service** — We don't host models, don't train on user data, don't see user content. Self-operated is the product.
- **Multi-agent orchestration** (for now) — Sub-agent management, agent-to-agent delegation, shared memory are future considerations.

**Icebox** (good ideas, no commitment):
- Mobile companion app for agent management
- Marketplace with paid community templates
- White-label managed hosting for MSPs
- Integration with non-OpenClaw agent frameworks
- Smart home integration (Home Assistant bridge)
- Shared family memory with per-member privacy boundaries

---

## Build Order

**Phase 0 — Concierge**
Stories: None (manual). We set up 3-5 agents by hand for real users. We ARE the control panel. Focus on Privacy Migrants leaving specific big-tech products.
Done when: We know which use-case templates matter, which integrations are most requested, what breaks first, and what keeps people engaged at 30 days.

**Phase 1 — Self-install panel (Operate + Secure + Deploy + Model Routing)**
Stories: Doctor, Predictive health alerts, Status dashboard, Intelligent cost routing, Full deploy sequence, Pre-flight checks, Graceful shutdown, Egress firewall (with domain allowlisting), Container hardening, Secrets management, Encrypted backup, Safe upstream updates, Two-stage Docker build, Health self-repair, Local-first model routing, Per-category cloud opt-in, Data egress visibility
Done when: A Tinkerer installs the CLI on an existing OpenClaw deployment and immediately gets value: diagnostics, security hardening, local-first model routing with egress visibility. They can `clawhq up` / `clawhq down` / `clawhq backup` / `clawhq update` with full safety. Zero data leaves the machine unless they opt in.

**Phase 2 — Full panel (Plan + Evolve + Transparency + Decommission)**
Stories: Use-case templates, AI-powered config inference, Guided questionnaire, Integration auto-detection, Config generation, Config validation, Identity governance, Memory lifecycle, Preference learning, Autonomy tuning, Activity digest, Approval queue, Data egress audit, Portable export, Verified destruction, Pre-decommission checklist, PII scanning, Channel connection, Post-deploy smoke test, Intelligent task-level routing
Done when: A Privacy Migrant goes from zero to working agent using only `clawhq init`. The agent gets better over time through preference learning and autonomy tuning. The user knows exactly what the agent did and what data left their machine.

**Phase 3 — Migration + Managed hosting**
Stories: ChatGPT conversation import, Google Assistant routine import, Contact/calendar bootstrapping, "Replace my X" wizard, Infrastructure provisioning, Fleet management, Web console, Access control
Done when: A non-technical Privacy Migrant can switch from ChatGPT/Google Assistant to ClawHQ with their history and routines intact. Managed mode available for those who accept the trade-off.

**Phase 4 — Ecosystem**
Stories: Community templates, Supply chain security, "Why did you do that?" trace, Air-gapped mode, Template marketplace
Done when: Community is contributing use-case templates. The WordPress flywheel is turning.

---

## Risks & Open Questions

**Risks:**
- Local model quality isn't good enough for daily use → mitigation: intelligent routing that escalates to cloud when local falls short; as local models improve (they are, rapidly), the cloud dependency shrinks. Phase 0 validates which tasks are local-ready today.
- OpenClaw makes breaking changes to config schema or Gateway API → mitigation: pin to known-good upstream versions, test against upstream CI, maintain compatibility shims
- Template ecosystem doesn't attract contributors → mitigation: ship 6 excellent use-case templates that cover 80% of migration scenarios, make contribution easy (single YAML file PR)
- Preference learning creates feedback loops (agent reinforces bad patterns) → mitigation: all preference updates require explicit user approval, rollback capability on every change, cooldown on repeated suggestions
- Privacy Migrants don't care enough to self-host → mitigation: Phase 0 concierge validates willingness to pay. If self-hosting is the barrier, managed mode exists — but we lead with self-operated.
- Managed mode operational costs too high for pricing → mitigation: Phase 0 validates unit economics before building infrastructure

**Open questions:**
- [ ] Phase 0 candidates — Who are the 3-5 Privacy Migrants? What are they replacing? — owner: [name], decide by: [date]
- [ ] Local model minimum bar — Which Ollama models are good enough for which task categories today? — owner: [name], decide by: [date]
- [ ] OpenClaw relationship — Inform? Partner? They might want lifecycle tooling upstream. — owner: [name], decide by: [date]
- [ ] Template quality gate — Open marketplace vs. curated garden? — owner: [name], decide by: [date]
- [ ] Pricing — Cost to run one managed agent? Price point? — owner: [name], decide by: [date]
- [ ] Jurisdiction — Incorporation location? VM locations? Matters for sovereignty. — owner: [name], decide by: [date]
- [ ] Encryption model — User-held keys for at-rest workspace encryption? — owner: [name], decide by: [date]
- [ ] Team — Service model is solo-friendly. Platform model may need co-founders. — owner: [name], decide by: [date]
- [ ] Multi-agent orchestration — When does agent density justify the coordination protocol? — owner: [name], decide by: [date]

---

## Links

- OpenClaw Implementation Reference: `OPENCLAW-REFERENCE.md`
- Design: [link]
- Repo: [link]

---

<!--
USING THIS WITH AI CODING TOOLS
================================

1. Drop this as docs/PRODUCT.md in your repo, alongside
   docs/OPENCLAW-REFERENCE.md for implementation details.

2. Point your AI agent at specific stories:
   "Implement the [story title] story from docs/PRODUCT.md.
   Follow the acceptance criteria exactly.
   Refer to docs/OPENCLAW-REFERENCE.md for OpenClaw internals."

3. Generate your backlog:
   "Read the 'What We're Building' section of docs/PRODUCT.md.
   Create one GitHub Issue per story with acceptance criteria
   as a checklist. Label with priority and size."

4. Generate tests from acceptance criteria:
   "For each Given/When/Then in [feature], write a test."

5. Validate work:
   "Check my code against the acceptance criteria for [story].
   Which criteria pass? Which are missing?"

6. The impl notes reference OPENCLAW-REFERENCE.md for
   architectural details, config mappings, and landmine rules.
   Load that file when implementing any story.

7. Update THIS FILE when scope changes. The PRD is the source
   of truth — not your chat history with the AI.
-->
