# ClawHQ

> One-liner: Your AI agent runs on your hardware, talks to your services, and never sends a byte to anyone you didn't choose. ClawHQ makes that possible without a PhD in DevOps.

**Owner:** [Name] · **Status:** Active Development · **Updated:** 2026-03-17

---

## The Problem

The big 4 AI companies (OpenAI, Google, Anthropic, Apple) are building personal AI agents that know everything about you — your emails, calendar, tasks, health, finances, relationships. They store it on their servers. They train on it. They lose it in breaches. They shut down features and your data goes with them. You have zero sovereignty over the most intimate dataset that has ever existed about you.

OpenClaw is the escape hatch — the most powerful open-source framework for persistent AI agents, running in a Docker container you control. But it's nearly impossible to operate. Setting up a production agent means wrangling ~13,500 tokens of configuration across 11+ files, dodging 14 silent landmines that produce no errors when misconfigured. Memory bloats to 360KB in 3 days. Credentials expire silently. Identity files corrupt and drift. Security is entirely opt-in. This is full-time SRE work. Most deployments are abandoned within a month.

So today you choose between **surveillance AI** (polished, easy, you own nothing) or **raw framework** (sovereign, powerful, months of expertise required). Nobody makes the sovereign option usable. That's the gap.

---

## Why Now

10+ hosting providers have appeared for OpenClaw, proving demand — but they all stop at deploy and most just run default config on shared infrastructure, which is barely better than the big 4 for privacy. Meanwhile, the big 4 are accelerating: ChatGPT's memory is persistent, Gemini is embedded in every Google service, Apple Intelligence is on-device but locked to their ecosystem. Every month that passes, more people hand over more data to platforms they don't control. The framework itself is maturing fast (sandbox isolation, Ollama integration, plugin channels), creating a real technical foundation for local-first agents — but also more configuration surface area that users can't manage. The window for a purpose-built agent distribution is now.

---

## The Solution

ClawHQ turns generic, unsecured open-source software into your personalized digital agent — without you knowing how any of it works. You get a Signal, Telegram, or Discord UI. We do the rest.

OpenClaw already has a control panel (the Gateway UI). That's cPanel — fine for basic management. ClawHQ is WordPress. We have hundreds of recipes — complete operational profiles for every use case — and during setup we cook ~10 personalized for you. "Manage my email" → email tools, triage skills, inbox-check cron, morning digest, auto-reply with approval gates. "Help with meal planning" → nutrition tools, recipe research, weekly meal plan, shopping list, dietary preferences baked into identity. "Assist with stock trading" → market data tools, research skills, pre-market alerts, portfolio monitoring, risk guardrails.

Everything in OpenClaw is either a file or an API call. ClawHQ controls all of it programmatically — identity, tools, skills, cron, integrations, security, autonomy, memory, model routing, egress firewall — through templates that configure a complete agent for a specific job.

One command gives you a running, hardened, purpose-built agent. The same stack runs everywhere — your PC, a Mac Mini, a DigitalOcean droplet. Self-managed or fully managed. The only difference is who maintains the host.

**Core bet:** People will choose a sovereign AI agent over a big-tech one — if the sovereign option isn't dramatically harder to use.

---

## Design Principles

These aren't aspirations. They're constraints that flow through every design decision, every story, every line of code.

**Local-first.** Local models (Ollama) are the default for all agent tasks. Cloud APIs (Anthropic, OpenAI, Google) are opt-in escalation — enabled per-task-category, not globally. The agent works fully air-gapped. If a user never configures a cloud API key, their agent still functions for daily use. This is the architectural commitment that makes ClawHQ different from "a better way to send your data to OpenAI."

**Transparent.** The user knows exactly what their agent did, what data it touched, and what left their machine — without asking. Every agent session produces a human-readable activity summary. Every outbound API call is logged with the provider, token count, and data category. The agent doesn't operate in the dark.

**Sovereign.** Self-operated is the primary product, not an equal sibling to managed hosting. Your data stays on your hardware by default. `clawhq export` gives you everything portable. `clawhq destroy` proves it's gone. No lock-in to ClawHQ, no lock-in to any cloud provider, no lock-in to any model provider.

**Gets more capable, not stale.** The agent's capabilities grow safely over time. You install new skills, connect new services, add API providers, install CLI tools — all through a validated, sandboxed, rollback-capable pipeline. The agent at 6 months can do more than at day 1 because you've deliberately expanded its toolkit. Every change is auditable and reversible. This is the retention mechanism that keeps people from going back to ChatGPT: their agent handles more task types every month.

---

## What Your Day Looks Like

<!--
This is the plain-language version of the product for the Privacy Migrant.
No technical details. Just the experience.
-->

**Without ClawHQ (today):**
You wake up and check Gmail — Google reads every email. You ask ChatGPT to help draft a response — OpenAI stores the conversation. You check Google Calendar — Google knows your schedule. You ask Siri to add a reminder — Apple logs it. By 9 AM, four companies know more about your day than your spouse does. You didn't choose this. There's just no alternative that works.

**With ClawHQ (after setup):**
You wake up to a message from your agent on Telegram: "Morning. You have 3 meetings today. I triaged 40 emails overnight — 6 need you, the rest are handled. John moved Thursday's standup, which conflicts with your client call — I've drafted a reschedule for your approval. Your focus block from 10-12 is protected. Also, you have an investor update due Friday — I've pulled the latest metrics and drafted an outline based on last quarter's format. Want me to send the reschedule?"

You reply "yes" and get on with your morning.

At the end of the day, your agent sends a summary: what it handled, what it flagged, what it learned ("you rejected the 2 PM meeting suggestion — noted: no meetings during focus blocks"). Zero data left your machine today — the entire day ran on local models.

**After 6 months:**
The agent auto-sends routine email replies in your voice without asking. It knows that meetings with your top 3 clients are always high priority. It preps investor updates unprompted because it learned the quarterly rhythm. It notices when your schedule is overloaded and proactively reschedules low-priority meetings. It built itself a custom tool for parsing your weekly analytics report because you kept asking for the same data. You approved all of this along the way — nothing happened without your say-so — but you barely think about it anymore. It just works, and none of it goes through Google, OpenAI, Apple, or anyone else.

**The Privacy Migrant** — Currently using ChatGPT, Google Assistant, or Apple Intelligence and increasingly uncomfortable with the trade-off. Not necessarily technical — they might run a small business, manage a household, or work in a field where confidentiality matters (legal, medical, financial). Their biggest headache is that there's no alternative that doesn't require becoming a sysadmin. They'd switch to something that gives them the same daily utility without the surveillance.

**The Tinkerer** — Technical user running or wanting to run an OpenClaw agent on their own hardware. Comfortable with Docker and CLI but doesn't want to spend weeks on configuration and ongoing SRE. Their biggest headache is the gap between "I got it running" and "it actually works well." They'd pay for something that handles security, monitoring, and config management so they can focus on what the agent does.

**The Fleet Operator** — Manages agents for multiple people or use cases (family coordinator, team assistant, client-facing bots). Cares most about fleet-wide visibility, consistent security posture, and operational efficiency. Currently solving this with custom scripts and manual SSH sessions.

---

## What Success Looks Like

- **Time to working agent:** < 5 minutes via AI-inference path, < 30 minutes via guided questionnaire (currently weeks)
- **Config-related failures:** 0 silent landmines shipped (currently 14 possible)
- **Data leaving the machine:** 0 bytes by default; user explicitly opts in per-task-category for cloud APIs
- **Agent improvement rate:** Measurable increase in autonomous task completion at 30/60/90 days (baseline TBD from Phase 0)
- **Churn at 30 days:** < 20% (most raw OpenClaw deployments abandoned within a month)

---

## How the Agent Grows Over Time

<!--
This is the unified narrative for capability expansion. Individual stories
reference this section. It should be understandable without any technical context.
-->

The agent ships with a baseline — the template you chose, the integrations you connected, the tools in the container. But your needs change. You discover new services, find better models, need the agent to handle tasks it couldn't before. Evolve is how you grow the agent's capabilities safely over time.

**Week 1 — Baseline works.** Your agent handles the tasks from your template: email triage, calendar management, morning briefs. Everything runs on local models. You're getting value, but you notice gaps — the agent can't parse your weekly analytics PDF, and you wish it could post to Slack.

**Month 1 — You expand.** You run `clawhq skill install slack-poster` — ClawHQ sandboxes it, scans for suspicious patterns, shows you what it does, and you approve. Now your morning brief goes to Slack. You run `clawhq tool install pandoc` — the agent can now convert documents. You add an OpenAI provider for research tasks only (`clawhq provider add openai` → opt-in for "research" category only). Your email triage still runs 100% local.

**Month 3 — It does more.** You've connected three new integrations (Notion, Linear, your company's internal API via a custom skill). Each was validated, sandboxed, and approved. The egress dashboard shows exactly which providers get which data. You installed `ffmpeg` for media processing. Your agent handles twice the task types it did at day 1 — and every change is in the audit log with rollback available.

**Month 6 — Your toolkit.** The agent runs 12 skills, 6 integrations, 3 API providers, and 8 CLI tools — all installed through the safe pipeline. Nothing was installed without your approval. Nothing runs that you can't trace. If the Slack skill update next week breaks something, you roll back to the previous version with one command. Your agent at 6 months is dramatically more capable than at day 1 because you grew its toolkit deliberately.

This pipeline — discover → vet → sandbox → approve → install → monitor → rollback-if-needed — is what makes expanding your agent safe instead of scary. And it's why ClawHQ agents don't stagnate: the user has a clear, safe path to make their agent do more.

---

## What We're Building

<!--
Organized by install phases, not toolchains. Each phase produces a working state.
Stories are atomic — one behavior each.
Personas: Privacy Migrant, Tinkerer, Fleet Operator.
Impl notes reference OPENCLAW-REFERENCE.md for implementation details.

PRIORITY KEY:
  P0-critical = Nothing works without this. Ship-blocking.
  P0          = Important for launch quality. Not blocking but close.
  P1          = Valuable, can follow fast after launch.
  P2          = Future phase.

SIZE KEY: S = hours, M = days, L = weeks, XL = multi-week
-->

### 1. Plan — Agent Setup

From "I want to replace Google Assistant" to a running agent — in under 5 minutes with AI inference, or 30 minutes with guided setup. The system infers the right config from what you connect and what you tell it, not from a 50-question form.

- [ ] **Use-case templates** `P0` `L`
  As a Privacy Migrant, I want to pick what I'm replacing (not an abstract personality archetype) so that my agent is immediately useful for my actual daily workflow.
  - Given a user runs `clawhq init`, when templates are presented, then they're organized by what they replace: "Replace Google Assistant" (daily life management), "Replace ChatGPT Plus" (research + writing partner), "Replace my PA" (calendar, email triage, task management), "Family Hub" (shared calendar, chore tracking, meal planning), "Research Co-pilot" (deep research, citation management, writing), "Founder's Ops" (inbox zero, investor updates, hiring pipeline)
  - Given a user selects a template, when preview is shown, then it displays: what integrations are needed, what the agent will handle autonomously vs. with approval, what local model requirements are, estimated daily cost (local vs. cloud), and a "day in the life" narrative showing what a typical day looks like with this agent (e.g., "Replace my PA" shows: agent auto-schedules focus blocks around your meetings, notices a conflict John mentioned in email and proposes a reschedule, triages 40 emails down to 6 that need you, and adds prep time before your client call)
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

- [ ] **Config generation with landmine prevention** `P0-critical` `L`
  As a Tinkerer, I want the generated config to be impossible to break so that I never hit a silent failure.
  - Given any setup path completes (AI inference, questionnaire, or template), when config is generated, then it produces: `openclaw.json`, `.env`, `docker-compose.yml`, all identity files, `cron/jobs.json`
  - Given config is generated, when validation runs, then every file passes all 14 landmine rules — generation cannot produce a broken config
  - Given a generated `openclaw.json`, when the Gateway loads it, then it passes TypeBox schema validation with zero unknown keys
  - _Impl note: See OPENCLAW-REFERENCE.md → The 14 Configuration Landmines for full rule set. See → Config Generator Output for file-to-landmine mapping._

- [ ] **Config validation engine** `P0-critical` `M`
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

- [ ] **Local-first model routing** `P0-critical` `L`
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

- [ ] **Two-stage Docker build** `P0-critical` `L`
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

### 4. Secure — Hardening & Isolation

Hardened by default, isolated by context, monitored continuously. Every conversation runs in its own container. Every secret is managed. Every credential is health-checked. Every skill is vetted. Security is the baseline, not a feature flag.

- [ ] **Container hardening** `P0-critical` `L`
  As a Tinkerer, I want my agent container hardened automatically based on my template's security posture so that I don't have to manually configure Docker security options.
  - Given a template with `security.posture: hardened`, when the deployment bundle is generated, then `docker-compose.yml` includes: `cap_drop: ALL`, read-only rootfs, `no-new-privileges`, non-root UID 1000, tmpfs with noexec/nosuid, ICC disabled, resource limits per posture level
  - Given multiple contexts exist (work group, family group, personal), when the agent handles messages from different contexts, then each context runs in its own isolated container with its own filesystem and memory — a compromised or misbehaving agent in one context cannot access data from another
  - Given the container is running, when Doctor checks security, then it verifies all hardening controls are active, per-context isolation is enforced, and alerts on any regression
  - _Impl note: Per-context container isolation is the architectural commitment that makes ClawHQ's security OS-level, not application-level. OpenClaw runs everything in one Node process with shared memory — session-level DM scope is a config setting, not a security boundary. ClawHQ enforces isolation at the container level so that even a prompt injection in one context can't leak data from another. See OPENCLAW-REFERENCE.md → Container Hardening Matrix for posture comparison._

- [ ] **Egress firewall** `P0-critical` `M`
  As a Tinkerer, I want outbound network traffic restricted so that my agent can't exfiltrate data to unexpected destinations.
  - Given `clawhq up` runs, when the container starts, then iptables chain `CLAWHQ_FWD` is applied: ESTABLISHED/RELATED → DNS (53) → HTTPS (443) to allowlisted domains only (configured per template + user cloud opt-in) → LOG+DROP everything else
  - Given a cloud API provider is opted-in for specific categories, when the firewall is generated, then only that provider's API domains are allowlisted — not the entire internet over HTTPS
  - Given `docker compose down` was run, when `clawhq up` or `clawhq restart` runs, then the firewall is automatically reapplied
  - _Impl note: See OPENCLAW-REFERENCE.md → Egress Firewall Implementation. The domain-allowlist approach is stronger than the original "allow all HTTPS" — it enforces the local-first principle at the network level._

- [ ] **Secrets lifecycle management** `P0-critical` `L`
  As a Tinkerer, I want to add, rotate, revoke, and audit secrets through the CLI so that credential management is safe, auditable, and I never have to manually edit `.env` files.
  - Given `clawhq secrets add <name>` runs, when the user provides a value, then input is masked, the secret is written to `.env` with 600 permissions (never to `openclaw.json` or workspace files), and an optional live validation runs via credential health probes
  - Given `clawhq secrets list` runs, then it displays secret names, provider category, health status, age, and last rotation date — never values
  - Given `clawhq secrets rotate <name>` runs, when the user provides a new value, then the old value is swapped atomically, health validation runs against the new value, and a rotation event is logged to the audit trail
  - Given `clawhq secrets revoke <name>` runs, then the secret is removed from `.env`, removal is verified, and a warning is shown if any config file still references `${NAME}`
  - Given `clawhq secrets audit` runs, then it displays a chronological log of all secret events (added, rotated, revoked, accessed-by-deploy) from the local audit trail
  - Given `clawhq secrets export` runs, then secrets are encrypted (AES-256-GCM or `age`) and written to a portable archive; `clawhq secrets import` restores from that archive with integrity verification
  - Given Doctor runs, when the secrets check executes, then it scans all config files for embedded secrets and alerts on any found
  - Given `clawhq creds` runs, when credential checks execute, then each integration's health probe reports valid/expired/failing
  - _Impl note: Must integrate with existing `src/security/secrets/env.ts` (parseEnv/serializeEnv), `src/security/credentials/index.ts` (health probes), and deploy pipeline (decrypt-to-tmpfs at deploy time). Storage abstracted behind a `SecretStore` interface so plaintext `.env` remains a supported backend. Encrypted storage backend (Node.js `crypto` AES-256-GCM or `age`) as upgrade path from plaintext `.env`. Local-only audit trail is append-only JSONL with HMAC chain for tamper detection._

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

- [ ] **Full deploy sequence** `P0-critical` `L`
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

- [ ] **Graceful shutdown and restart** `P0-critical` `S`
  As a Tinkerer, I want shutdown that preserves state and restart that reapplies firewall.
  - Given `clawhq down` runs, then containers stop gracefully preserving workspace state
  - Given `clawhq restart` runs, then containers restart, firewall is reapplied, health is re-verified

- [ ] **Infrastructure provisioning** `P2` `XL`
  As a Privacy Migrant (managed mode), I want one-click deployment to cloud infrastructure so that I never touch a terminal. This is the convenience tier for people who accept the trade-off of running on managed infrastructure.
  - Given a managed mode user selects deploy, then it handles VM creation, DNS, SSL, reverse proxy, and Docker setup
  - _Impl note: Managed mode is secondary to self-operated. See OPENCLAW-REFERENCE.md → Managed Mode Architecture. The operational boundary ensures we never see agent contents._

### 6. Operate — Predictive Operations

Not just diagnostics and dashboards — predictive intelligence that catches problems before they happen, fixes what it can automatically, and tells you what your agent actually did.

- [ ] **Doctor — preventive diagnostics** `P0-critical` `XL`
  As a Tinkerer, I want a single command that checks every known failure mode so that I catch problems before they cause visible failures.
  - Given `clawhq doctor` runs, then it checks: all 14 configuration landmines, file permissions, credential health (live probes), cross-file consistency, memory health, cron health, container resources, network state, config drift, model availability (Ollama models still present and loadable)
  - Given checks complete, then each shows pass/warn/fail with specific fix instructions
  - Given `clawhq doctor --fix` runs, then safe issues (permissions, firewall) are auto-fixed
  - _Impl note: Reuses OpenClaw's `openclaw doctor --json` as subset, adds ClawHQ-specific checks. See OPENCLAW-REFERENCE.md → The 14 Configuration Landmines._

- [ ] **Predictive health alerts** `P0` `L`
  As a Tinkerer, I want the system to predict problems and act before I notice so that my agent runs like autopilot, not a dashboard I have to watch.
  - Given memory is growing, when trend analysis runs, then it predicts when workspace memory size will impact performance and alerts before degradation ("Memory at 78KB, growing 12KB/day — approaching threshold, consider cleanup")
  - Given credential expiry is tracked, when an API key has a known expiry, then a renewal notification fires 7 days before expiry with a one-command renewal flow
  - Given agent response quality is measurable (user corrections per session, redo requests, escalation rate), when quality degrades, then the system diagnoses likely causes (identity bloat, memory retrieval regression, model routing mismatch) and suggests fixes
  - Given any metric crosses a warning threshold, when the alert fires, then it includes the projected timeline and automated remediation if available — not just "something is wrong"

- [ ] **Status dashboard** `P0` `L`
  As a Tinkerer, I want a single-pane view of agent health, integrations, cost, cron, workspace, and data egress so that I know everything's fine at a glance.
  - Given `clawhq status` runs, then it shows: agent state, integration health, cost (by model, local vs. cloud breakdown), cron job status, workspace metrics (memory by tier, identity budget), data egress summary (bytes sent to cloud today/week/month, zero-egress badge if applicable), and any active predictive alerts
  - Given `clawhq status --watch` runs, then it live-updates
  - _Impl note: Data sources: Docker API, Gateway WebSocket, credential probes, filesystem, egress logs. See OPENCLAW-REFERENCE.md → Three Communication Channels._

- [ ] **Intelligent cost routing** `P0` `M`
  As a Tinkerer, I want the system to minimize cost automatically by routing tasks to the cheapest capable model — with local models as the cheapest option.
  - Given a budget is configured, when usage tracking runs, then it attributes cost per-task-category and per-model: "Morning brief: $0.00 (local). Research session: $0.47 (Sonnet). Email triage: $0.00 (local)."
  - Given local models are the default, when cost tracking runs, then it shows cost savings from local routing vs. hypothetical cloud-only usage, reinforcing the local-first value proposition
  - Given budget hits 75%, when the router adjusts, then it shifts eligible tasks from cloud to local models before alerting
  - Given budget hits 100%, when the cap is enforced, then cloud-escalation stops entirely and the agent operates local-only until the budget resets — never pauses completely

- [ ] **Encrypted backup and restore** `P0-critical` `L`
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
  As a Privacy Migrant, I want a daily summary that tells me what my agent did, what it noticed, and what it thinks I should do next — so that I trust it and get value without micromanaging.
  - Given the agent ran overnight, when the user checks in (via messaging channel or `clawhq digest`), then they see: tasks completed autonomously, tasks queued for approval, problems the agent found with proposed solutions (e.g., "John moved Thursday's meeting, which conflicts with your client call — I've drafted a reschedule for your approval"), emails triaged (count + categories, not content — unless user drills in), calendar changes made, integrations used, errors encountered, and data egress summary
  - Given the agent monitors connected integrations continuously, when it detects something actionable (scheduling conflict, urgent email pattern, missed deadline approaching), then it surfaces the problem with a proposed action in the digest or as a real-time alert — not just a log entry
  - Given the digest is generated, when privacy mode is active, then it summarizes by category ("read 12 emails, triaged 3 as urgent") rather than showing content — the user drills into specifics only if they want to
  - _Impl note: Digest generated from structured activity logs. Proactive monitoring is cron-driven: the heartbeat checks integrations and surfaces actionable items. This is the core "it works for you while you sleep" experience._

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

### 8. Evolve — Keep Your Agent Alive Past Month One

Without active management, OpenClaw agents degrade. Memory bloats until context windows overflow. Identity files drift and contradict each other. Credentials expire silently. Cron jobs fail without warning. Skills reference tools that were removed. Most raw OpenClaw deployments are abandoned within a month — not because they stopped working suddenly, but because they rotted gradually.

Evolve is ClawHQ's answer to that degradation. It covers two things: **taming decay** (identity governance, memory lifecycle, credential monitoring, consistency checking) and **safe growth** (adding skills, integrations, tools, and providers through a validated, sandboxed, rollback-capable pipeline). The agent at month 6 is still working *and* can do more than at day 1.

- [ ] **Skill management** `P0` `L`
  As a Tinkerer, I want to install, list, update, and remove agent skills safely so that my agent can handle new types of tasks without risking my existing setup.
  - Given `clawhq skill list` runs, then it shows installed skills with version, source, status (active/disabled), and last-used timestamp
  - Given `clawhq skill install <name|url>` runs, when the skill is fetched, then it's sandboxed in an isolated container, scanned for suspicious patterns (outbound calls, filesystem access outside workspace, credential access), and presented for user approval before installation
  - Given a skill is approved and installed, when it's activated, then TOOLS.md is updated, the agent's available tool list reflects the new skill, and a Stage 2 image rebuild is triggered if the skill requires container-level dependencies
  - Given `clawhq skill remove <name>` runs, then the skill is deactivated, its tools removed from TOOLS.md, and a rollback snapshot is available for 30 days
  - Given `clawhq skill update <name>` runs, then the new version is sandboxed and vetted before replacing the old version — the old version is kept as rollback
  - _Impl note: Skills are OpenClaw's primary extensibility mechanism. ClawHQ adds the safety layer (sandboxing, vetting, rollback) that raw OpenClaw doesn't provide. See OPENCLAW-REFERENCE.md → Skill System._

- [ ] **Integration management** `P0` `M`
  As a Tinkerer, I want to add, remove, or swap service integrations cleanly so that my agent can connect to new services without breaking existing ones.
  - Given `clawhq integrate add <type>` runs (e.g., `clawhq integrate add calendar`), then it walks through provider selection (Google Calendar, iCloud, CalDAV, etc.), credential setup with live validation, and config generation
  - Given a new integration is added, then: credential is validated and stored in .env, the integration tool is installed, TOOLS.md is updated, cron dependencies are checked, egress firewall allowlist is updated for the new provider's domains, and doctor runs a targeted health check
  - Given `clawhq integrate remove <name>` runs, then: credential is cleaned from .env, tool is uninstalled, TOOLS.md is updated, identity files are updated to remove references, orphaned cron dependencies are flagged, and firewall allowlist is tightened
  - Given `clawhq integrate swap <category> <new-provider>` runs (e.g., `clawhq integrate swap calendar icloud`), then the same category interface works with the new backend — the agent's behavior doesn't change, only the provider
  - Given `clawhq integrate list` runs, then it shows all integrations with provider, status, credential health, and last-used timestamp

- [ ] **API provider management** `P0` `M`
  As a Tinkerer, I want to add and manage LLM and service API providers so that I can expand my model options or connect to new cloud services — with full visibility into what each provider can access.
  - Given `clawhq provider add <name>` runs (e.g., `clawhq provider add openai`), then it walks through API key setup, validates the credential, configures which task categories this provider is allowed for, and updates the egress firewall allowlist
  - Given `clawhq provider list` runs, then it shows all configured providers with: name, credential status (valid/expired/failing), allowed task categories, egress stats (calls today/week/month, tokens sent, cost), and routing priority
  - Given `clawhq provider remove <name>` runs, then the credential is cleaned, routing policy is updated to exclude the provider, firewall allowlist is tightened, and tasks previously routed to this provider fall back to local or the next available provider
  - Given `clawhq provider test <name>` runs, then a test inference call verifies the provider is working end-to-end
  - _Impl note: Provider management is the user-facing control for the model routing engine. Adding a provider doesn't automatically route traffic to it — the user must also configure category opt-in._

- [ ] **CLI tool installation** `P1` `M`
  As a Tinkerer, I want to install additional CLI tools into the agent container so that my agent can use command-line utilities I depend on (e.g., `jq`, `ffmpeg`, `pandoc`, `gh`).
  - Given `clawhq tool install <package>` runs, then the package is validated against an allowlist of known-safe packages, added to the Stage 2 Dockerfile, and a Stage 2 rebuild is triggered
  - Given a package is not on the allowlist, when installation is attempted, then it's flagged for manual review with a warning about what the package does and what permissions it requires
  - Given `clawhq tool list` runs, then it shows all installed tools (both base and user-added) with version and source
  - Given `clawhq tool remove <package>` runs, then the package is removed from Stage 2 and a rebuild is triggered
  - _Impl note: Tools are installed via apt/apk in the Stage 2 Docker layer. This is a thin wrapper around the two-stage build — it modifies the Stage 2 Dockerfile and triggers a rebuild. The allowlist prevents installing arbitrary packages without review._

- [ ] **Identity governance** `P1` `M`
  As a Tinkerer, I want my agent's identity files tracked for bloat and staleness so that the agent's personality and guardrails don't degrade as I make changes.
  - Given identity files exist, when governance checks run, then token budget is tracked per file with warnings at 70%/90% thresholds vs. `bootstrapMaxChars` (default 20K)
  - Given files haven't been updated in a configurable period, then staleness detection generates review prompts
  - Given `clawhq evolve --identity` runs, then the user can review and update specific identity sections with diffs shown before applying — manual customizations are preserved with conflicts flagged
  - _Impl note: See OPENCLAW-REFERENCE.md → Identity Drift Research._

- [ ] **Supply chain security for skills and tools** `P1` `M`
  As a Tinkerer, I want community skills and tools vetted before installation so that I don't introduce malicious code into my agent.
  - Given a community skill is being installed, when vetting runs, then: source is checked against known registries, AI-powered scanning checks for suspicious patterns (outbound network calls, credential access, filesystem writes outside workspace), and VirusTotal integration scans artifacts
  - Given a package/tool is being installed, when vetting runs, then it's checked against the known-safe allowlist and flagged if not present
  - Given an internal allowlist exists, when a non-allowlisted install is attempted, then it's blocked with an explanation of the risk and instructions for manual override
  - Given `clawhq evolve audit` runs, then it shows the full change history: every skill installed, tool added, integration connected, provider configured — with timestamps, sources, and rollback availability

- [ ] **Evolve rollback** `P1` `S`
  As a Tinkerer, I want to undo any Evolve change if it breaks something so that expanding my agent's capabilities is never a one-way door.
  - Given any Evolve action (skill install, integration add, provider add, tool install, identity change), when it completes, then a rollback snapshot is created
  - Given `clawhq evolve rollback <change-id>` runs, then the specific change is reversed: files restored, config reverted, image rebuilt if needed
  - Given `clawhq evolve history` runs, then it shows all Evolve changes with IDs, timestamps, and rollback status (available/expired)

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

- [ ] **Portable export** `P0-critical` `L`
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
- **Secure:** Hardened by default. Per-context container isolation so your work agent can't see your family group's data. No secret in config files. Egress firewall with domain allowlisting (not just "allow all HTTPS"). Identity files read-only. Container runs non-root with minimal capabilities.
- **Private:** Zero data leaves the machine by default. Cloud APIs are opt-in per-task-category. Every outbound call logged. Air-gapped mode available. Self-operated is the hero product.
- **Reliable:** Auto-recovery from common failures. Pre-update snapshots with instant rollback. Predictive alerts catch problems before users notice.
- **Transparent:** Daily activity digest that surfaces problems with proposed solutions, not just logs. Approval queue for high-stakes actions. Egress audit with zero-egress attestation. "Why did you do that?" trace.
- **Expanding:** The agent's capabilities grow safely over time. Install new skills, connect new services, add API providers, install CLI tools — all through a validated, sandboxed, rollback-capable pipeline. An agent at 6 months can do more than at day 1 because you've expanded its toolkit with confidence.
- **Portable:** `clawhq export` produces a self-documented bundle. Zero lock-in to ClawHQ, any cloud, or any model provider. Works with raw OpenClaw if the user leaves.

---

## Tech Stack & Constraints

**Stack:** TypeScript / Node.js · Docker · iptables · GPG · WebSocket (Gateway communication) · Ollama (local model runtime)

**Key integrations:**
- OpenClaw Gateway → config read/write, status, health → WebSocket RPC (:18789) → token auth
- OpenClaw Workspace → identity, memory, skills, cron → filesystem read/write → direct access
- Docker Engine → container lifecycle, image builds → Docker CLI (subprocess) → Unix socket
- Ollama → local model inference → HTTP API (localhost:11434) → no auth (localhost only)
- iptables → egress firewall with domain allowlisting → CLI (subprocess) → requires sudo

**Core data model:**
- `Template` — operational profile (YAML). Fields: name, version, use_case_mapping, personality, security posture, monitoring, memory policy, cron config, autonomy model, model routing strategy, integration requirements, skill bundle
- `ModelRoutingPolicy` — per-category escalation rules. Fields: task_category, local_model_preference, cloud_allowed (bool), cloud_provider, quality_threshold, cost_cap
- `InstalledSkill` — agent skill record. Fields: name, version, source (registry/url/local), status (active/disabled), installed_at, last_used, vetting_result, rollback_snapshot_id
- `InstalledTool` — container CLI tool record. Fields: package_name, version, source (apt/apk), allowlisted (bool), installed_at, stage2_rebuild_id
- `DeploymentBundle` — generated config set. Fields: openclaw.json, .env, docker-compose.yml, identity files, cron jobs, model routing config. Generated from Template + setup answers
- `EgressLog` — outbound API call record. Fields: timestamp, provider, model, token_count_in, token_count_out, data_category, cost, session_id
- `EvolveChange` — capability change record. Fields: id, timestamp, change_type (skill_install/integration_add/provider_add/tool_install/identity_update), target, previous_state, new_state, rollback_snapshot_id, rollback_expires_at
- `BackupSnapshot` — encrypted state capture. Fields: id, timestamp, type, encryption method, manifest hash
- `SecretEntry` — managed secret record. Fields: name, value (encrypted), provider_category, created_at, rotated_at, accessed_at, health_status
- `SecretAuditEvent` — audit log entry. Fields: seq, event_type (added/rotated/revoked/accessed), secret_name, timestamp, prev_hmac, hmac
- `ExportBundle` — portable agent archive. Fields: identity, memory, workspace, config, integrations, history, build manifest

**Hard constraints:**
- Node.js ≥20 — matches OpenClaw's runtime, shares TypeBox schema types directly
- Must work fully air-gapped after initial build (no phone-home, no cloud dependency)
- Local models are the default; cloud APIs are opt-in per-task-category
- Generated config must pass OpenClaw's TypeBox schema validation
- All config writes go through `config.patch` RPC when Gateway is running (rate limited: 3 req/60s)
- Templates can tighten Layer 1 security baselines but can never loosen them
- Self-operated is the primary product; managed mode is a convenience tier
- All Evolve changes (skills, integrations, providers, tools) must be sandboxed, vetted, and rollback-capable
- Per-context container isolation for multi-group/multi-channel deployments (OS-level, not application-level)

---

## What We're NOT Building

- **A fork of OpenClaw** — ClawHQ is a layer on top, not a replacement. We use OpenClaw's Dockerfiles, Gateway, agent runtime, and channel adapters as-is.
- **Message routing or model API calls** — OpenClaw handles these well. We set policy (including model routing), we don't intercept execution.
- **A competing agent framework** — We're the operational layer, not the engine.
- **A skill marketplace** — OpenClaw's marketplace already exists and has demonstrated the security problems inherent in running untrusted community code inside agents with access to everything. ClawHQ's construct skill takes the zero-trust approach: read marketplace skills as a source of inspiration, understand what they do, rebuild from scratch inside the agent's security boundary. The marketplace is a curriculum, not a supply chain.
- **A no-code agent builder** — We make OpenClaw accessible, not invisible. Power users can always drop to raw config.
- **A cloud AI service** — We don't host models, don't train on user data, don't see user content. Self-operated is the product.

**Icebox** (good ideas, no commitment):
- Mobile companion app for agent management
- White-label managed hosting for MSPs
- Integration with non-OpenClaw agent frameworks
- Smart home integration (Home Assistant bridge)
- Shared family memory with per-member privacy boundaries
- Agent swarms — teams of specialized agents collaborating on complex tasks, each in isolated containers (natural extension of per-context isolation)

---

## Why Not the Alternatives

10+ OpenClaw hosting providers exist — they all stop at deploy. You get default config on shared infrastructure with no lifecycle management. NanoClaw solves container isolation brilliantly but has no configuration management, no memory lifecycle, no operational tooling, and no path for non-technical users — it's "fork the code and have Claude rewrite it," which is powerful for hackers and useless for everyone else. memU has the best memory architecture in the space but it's a memory layer, not a distribution — it doesn't handle security, deployment, identity governance, or decommissioning. Point tools exist for security scanning, dashboards exist for monitoring, and guides exist for hardening — but nobody stitches the full lifecycle together. ClawHQ's moat is that it's the complete distribution — from install through decommission — with opinionated security defaults that work out of the box, and a feedback loop that makes the agent get better over time. Nobody else goes past deploy. Nobody else is the install.

---

## Build Order

**Phase 0 — Concierge**
Stories: None (manual). We set up 3-5 agents by hand for real users. We ARE the distro. Focus on Privacy Migrants leaving specific big-tech products. Document exactly what they're migrating from, what features they depend on, and what breaks when they switch — this research directly shapes use-case templates and migration tooling.
Done when: We know which use-case templates matter, which integrations are most requested, what breaks first, what keeps people engaged at 30 days, and what the migration experience from each big-tech product actually requires.

**Phase 1 — The Distro (Install → Configure → Harden → Launch)**
Stories: Installer (pre-reqs, source acquisition, distro directory), guided questionnaire, config generation with landmine prevention, config validation engine, container hardening, egress firewall (domain allowlisting), credentials manager (credentials.json mode 0600), two-stage Docker build, full deploy sequence, pre-flight checks, graceful shutdown, local-first model routing, per-category cloud opt-in
Done when: A user runs one command and gets a running, hardened, functional agent. The installer acquires OpenClaw (from trusted cache or source), configures it via guided setup, hardens it automatically, and launches it. Zero data leaves the machine unless they opt in. This is the end-to-end distro experience.

**Phase 2 — Tools + Skills + Ops (equip → operate)**
Stories: CLI tool generators (email, calendar, tasks, web-search, travel, meals, etc.), skill installation (morning-brief, construct, email-digest, meeting-prep), doctor (14+ checks with auto-fix), predictive health alerts, status dashboard, intelligent cost routing, encrypted backup/restore, safe upstream updates, health self-repair, data egress visibility, PII scanning, credential health probes, audit logging (tool execution, secret lifecycle, egress), channel connection, post-deploy smoke test
Done when: The agent has hands (tools), brain (skills), and a safety net (ops). A Tinkerer gets immediate day-2 value: diagnostics, monitoring, backups, safe updates. The agent is proactive — morning briefs, email triage, scheduled heartbeats.

**Phase 3 — Evolve + Transparency + Decommission (grow → trust → exit)**
Stories: Skill management (install/update/remove with vetting), integration management (add/remove/swap), API provider management, CLI tool installation, identity governance, supply chain security, evolve rollback, activity digest (proactive), approval queue, data egress audit, "why did you do that?" trace, portable export, verified destruction, pre-decommission checklist, intelligent task-level routing, use-case templates (community), AI-powered config inference
Done when: The agent grows safely over time. A user can install skills, connect services, add providers — all through a validated, sandboxed, rollback-capable pipeline. The user knows exactly what the agent did and what data left their machine. Clean exit with cryptographic verification.

**Phase 4 — Managed Service + Migration (cloud + onramp)**
Stories: Cloud monitoring service (remote health dashboard, security advisories, update notifications), managed hosting (DigitalOcean, Hetzner, Mac Mini), agentd daemon, web console, fleet management, ChatGPT conversation import, Google Assistant routine import, contact/calendar bootstrapping, "Replace my X" wizard, infrastructure provisioning, access control
Done when: The same distro runs as a managed service. A non-technical Privacy Migrant can get a working agent without touching a terminal. Migration from ChatGPT/Google Assistant with history and routines intact.

**Phase 5 — Ecosystem**
Stories: Community templates, template marketplace, air-gapped mode, agent swarms (multi-agent collaboration), mobile companion app
Done when: Community is contributing use-case templates. The WordPress flywheel is turning.

---

## Risks & Open Questions

**Risks:**
- Local model quality isn't good enough for daily use → mitigation: intelligent routing that escalates to cloud when local falls short; as local models improve (they are, rapidly), the cloud dependency shrinks. Phase 0 validates which tasks are local-ready today.
- OpenClaw makes breaking changes to config schema or Gateway API → mitigation: pin to known-good upstream versions, test against upstream CI, maintain compatibility shims
- Template ecosystem doesn't attract contributors → mitigation: ship 6 excellent use-case templates that cover 80% of migration scenarios, make contribution easy (single YAML file PR)
- Skill/tool supply chain compromise (malicious community skills) → mitigation: sandboxed vetting, AI-powered scanning, allowlists for tools, VirusTotal integration, all changes reversible via rollback
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
