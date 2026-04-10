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

Blueprints define complete operational stacks:

**Mission profiles** define what the agent can do — tools, integrations, cron jobs, autonomy rules, security posture, memory policy. Profiles are a-la-carte: users stack whichever combination fits their life. Most start with LifeOps and add from there. **Launch scope:** LifeOps, Dev, and Marketing ship first (covering the top 3 adoption cohorts). Remaining profiles ship post-traction. The 10 profiles, each with clean non-overlapping tool ownership:

- **LifeOps** — email (Himalaya), calendar (khal/vdirsyncer), tasks (Todoist et al), weather (Open-Meteo), meal planning, grocery lists, morning/evening briefs, appointment coordination, reminders. The universal base — personal admin that everyone needs. Boundary: the moment it's about a business pipeline or a codebase, you're in another profile.
- **Dev** — GitHub/GitLab (gh, glab), git, CI/CD monitoring, Sentry error tracking, Linear/Jira issue tracking, PR creation and review, repo monitoring, architecture decisions, deployment triggers. Boundary: building and maintaining software. Updating marketing site copy is Marketing; fixing site infrastructure is Dev.
- **Research** — web search (Tavily, Brave, SearXNG), synthesis/analysis, long-form drafting, knowledge base management (Obsidian, Notion, Logseq), document summarization, competitive analysis, literature review. Boundary: produces knowledge artifacts (reports, summaries, analysis). Doesn't publish them — publishing is Marketing's job.
- **Markets** — market data feeds (Yahoo Finance, Alpha Vantage, Polygon), portfolio tracking, charting (TradingView via browser), SEC filing monitoring, trading execution (Alpaca, IBKR), crypto (Coinbase), alerts on price/volume/filing events. Boundary: financial instruments and trading. Business financials (revenue, runway, invoicing) are a separate concern.
- **Sales** — CRM (HubSpot, Salesforce, Pipedrive, Airtable), lead tracking, outreach drafting, follow-up sequences, deal stage management, contact enrichment, meeting prep from CRM data. Boundary: owns the relationship pipeline from lead to close. Marketing generates leads; Sales works them.
- **Marketing** — social media posting/scheduling (X, LinkedIn, Instagram, YouTube — via browser automation or APIs), content calendar management, newsletter composition and sending, SEO monitoring, analytics, content repurposing (long-form → social), ad campaign monitoring. Boundary: creates and distributes content to attract attention. Doesn't write deep research (that's Research) or manage site infrastructure (that's SiteOps).
- **SiteOps** — website content updates, deployment pipelines, uptime monitoring, SSL/domain management, CMS operations, page speed monitoring, broken link detection, SEO technical audit. Boundary: the webmaster. Maintains and deploys. Doesn't create content strategy (Marketing) or write articles (Research/Marketing).
- **Home** — Home Assistant REST API, HomeKit, smart device control, camera monitoring, MQTT, lighting/thermostat/lock automations, presence-based routines. Boundary: physical space automation. Disjoint from other profiles except LifeOps (presence-based routine triggers).
- **Health** — WHOOP, Oura, Garmin, Apple Health export, Strava, nutrition tracking (Cronometer via browser), workout logging, sleep analysis, recovery recommendations, supplement/medication reminders. Boundary: tracks biometrics and fitness. Meal *planning* lives in LifeOps (daily logistics); Health owns nutritional *analysis* and body data. Cross-profile signaling: Health says "recovery is low, suggest lighter meals" and LifeOps adjusts.
- **Media** — image generation (DALL-E, ComfyUI, fal.ai), video processing (FFmpeg, Sora), voice synthesis (ElevenLabs, Piper), image manipulation (ImageMagick), audio processing, creative asset production. Boundary: a production toolkit. Other profiles *request* from Media — Marketing needs a social image, Research needs a diagram, LifeOps needs a voice memo transcribed.

**Not profiles — infrastructure layers:** Messaging channels (Telegram, WhatsApp, Discord, Slack, Signal, iMessage) are transport, configured at agent level. Files/cloud storage (rclone, Google Drive, Dropbox) are shared infrastructure any profile can use. Voice I/O (Whisper STT) is an input modality.

**Identified gaps for future profiles:** Finance/Accounting (invoicing, bookkeeping, Stripe, QuickBooks — distinct from Markets), Comms/Community (Discord server management, moderation, forum monitoring), Travel (booking, itineraries, loyalty programs).

**Integration categories** — profiles declare which categories they need (email, calendar, tasks). Users pick which provider fills each category during setup. The compiler generates the right tool script, egress rules, and credential config. Same CLI interface regardless of provider — `email inbox` works the same whether the backend is Gmail or ProtonMail.

| Category | Providers | Interface |
|---|---|---|
| **Email** | Gmail, Outlook, FastMail, ProtonMail, generic IMAP | himalaya (universal IMAP/JMAP/Notmuch) |
| **Calendar** | Google, iCloud, Outlook, any CalDAV | khal + vdirsyncer (universal sync) |
| **Tasks** | Todoist, TickTick, Things, Apple Reminders, Linear, markdown | Provider-specific API scripts |
| **Notes** | Obsidian, Notion, Logseq, Apple Notes, markdown files | Provider-specific, local preferred |
| **Passwords** | 1Password, Bitwarden, pass, KeePass | Provider CLI |
| **Contacts** | Google, iCloud, CardDAV | vdirsyncer (universal sync) |
| **Research** | Tavily, Brave Search, SearXNG, Perplexity | Provider-specific API scripts |
| **Weather** | Open-Meteo, OpenWeatherMap | REST API (no auth for Open-Meteo) |
| **CRM** | HubSpot, Salesforce, Pipedrive, Airtable | Provider-specific API scripts |
| **Code** | GitHub, GitLab, Bitbucket | gh/glab CLI |
| **CI/CD** | GitHub Actions, GitLab CI, CircleCI | Provider-specific API scripts |
| **Errors** | Sentry, Datadog, PagerDuty | Provider-specific API scripts |
| **Social** | X, LinkedIn, Instagram, Threads, Reddit | Browser automation or API |
| **Market Data** | Yahoo Finance, Alpha Vantage, Polygon | REST API scripts |
| **Models** | Ollama (local), Anthropic, OpenAI, Google, OpenRouter | OpenClaw model routing |
| **Storage** | Google Drive, Dropbox, iCloud, S3, rclone | rclone (universal) |

**80/20 for launch:** Email (himalaya), Calendar (khal/vdirsyncer), Tasks (Todoist), Research (Tavily), Weather (Open-Meteo), Code (GitHub), Models (Ollama + one cloud). These 7 categories cover the top 3 adoption cohorts (Daily Briefing, Content Engine, Dev Workflow). Everything else is post-launch expansion driven by user demand.

**Sovereign mode** is a provider-preference overlay: swap cloud providers for self-hosted alternatives across all active profiles — Tavily→SearXNG, cloud notes→Obsidian, OpenAI→Ollama, Google Calendar→local CalDAV. Provider mappings are in `src/design/catalog/providers.ts`. Sovereign mode is currently applied by selecting self-hosted providers during setup; a dedicated `--sovereign` flag is planned.

**Agent tone: "LifeOps, no BS."** Every ClawHQ blueprint ships one opinionated SOUL.md — the fourth option OpenClaw doesn't have. OpenClaw ships three defaults: empty (model slop), C-3PO (helpful, eager, grating within hours), and Architect/CEO (too stiff for daily use). ClawHQ's default is the agent you'd actually want running your life: supportive without flattery, direct without being cruel, competent enough to disappear into the work. Ten lines of SOUL.md. Not a product feature — a quality-of-life detail that comes free with the operational config you actually came for.

The community has 177 SOUL.md templates that say "You are warm and helpful." None include an operational stack. A personality without tools, skills, and security is a character sheet for a game nobody set up. ClawHQ ships the whole game.

Users who want something different use **`soul_overrides`** — free text in the config ("Humor is welcome. Swear when it fits. Be brutally honest."). Three sentences of personal preference do more than a personality menu. Domain-specific behavior — how the agent drafts outreach, structures reports, triages email — lives in **skills** and **operational playbooks** (AGENTS.md), not in tone config.

A published blueprint is a specific composition: pick one or more mission profiles, the compiler resolves everything — tools, skills, cron, security, identity, tone — into flat runtime config. A solo founder might stack LifeOps + Dev + Marketing + Sales. An investor stacks LifeOps + Markets + Research. A busy parent runs LifeOps with warmth turned up. Everyone starts with LifeOps and adds profiles until the agent earns its always-on cost.

This is grounded in how people actually use OpenClaw. Cohort research across 3.2M monthly active users (April 2026 data) identified 10 distinct behavior clusters (Morning Briefing, Content/Social, Email Triage, Solo Founder Ops, Dev Workflow, Research/Intel, Home/Family, SEO Pipeline, CRM/Sales, Companion). The top 3 adoption cohorts — daily briefing, content automation, and inbox management — all map to LifeOps and Marketing, which is why those profiles ship first. The research shows most users run ONE agent with multiple capabilities — not separate agents per role. ClawHQ builds operational agents, not conversational companions. Companion/relationship agents are explicitly out of scope — different product, different safety requirements.

**Config generation** — Every generated config prevents all 14 known landmines. Guided and AI-powered setup. Integration auto-detection.

**Container hardening** — Three security postures: **minimal** (development/testing), **hardened** (default — `cap_drop: ALL`, read-only rootfs, non-root user, egress firewall with per-integration domain allowlists, gVisor runtime, `chattr +i` identity files, Tailscale sidecar for encrypted networking), and **under-attack** (active threat response — kill non-essential processes, freeze config, restrict egress to known-good destinations, elevate logging). Hardened by default, not opt-in.

**Diagnostics** — `clawhq doctor` with 30 diagnostic checks, auto-fix, predictive health alerts. Extends OpenClaw's built-in `openclaw doctor` with landmine detection, firewall verification, credential probes, identity size enforcement, context pruning verification.

**Deployment** — Two-stage Docker build, pre-flight checks, firewall, health verification, smoke tests.

**Operations** — Encrypted backup/restore, safe updates with rollback, status dashboard, audit trail, memory lifecycle management.

**Security** — PII/secret scanning, skill vetting with sandboxed evaluation, credential health with expiry tracking, prompt injection defense.

---

## Onboarding — What It Actually Looks Like

The gap between "here's a YAML" and "my agent works differently now" is where most people drop off. This is the literal journey:

**Path 1: ClawHQ CLI (full lifecycle)**
```
git clone clawhq && cd clawhq && npm install
clawhq init --guided              # Pick profile, connect services, 5 minutes
clawhq build                      # Two-stage Docker build
clawhq up                         # Deploy with pre-flight checks + firewall
```
Result: hardened OpenClaw agent running in Docker, connected to Telegram/Signal/Discord, with correct config, egress firewall, and identity files. `clawhq doctor` keeps it healthy.

**Path 2: Standalone blueprint (no ClawHQ dependency)**
Download a published blueprint (YAML + 8 workspace files). Copy into an existing OpenClaw install's workspace directory. Restart. The agent reads the new identity files on next session. This is the community-first path — works with stock OpenClaw, no tooling required.

**Path 3: Config file (CI/headless)**
```yaml
# config.yaml
profile: life-ops
providers:
  email: gmail
  calendar: icloud-cal
  tasks: todoist
channels:
  telegram:
    bot_token: "..."
user:
  name: Alex
  timezone: America/New_York
```
```
clawhq init --config config.yaml -d ~/.clawhq
clawhq build && clawhq up
```

The setup story must be as tight as the architecture. If it takes more than 10 minutes from clone to working agent, something is wrong.

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
- **Opinionated composition.** "Here's what a good email agent looks like" is outside framework scope. Frameworks serve everyone and can't have opinions about specific use cases. Complete operational blueprints — profiles, tools, skills, security, cron, autonomy — are a design insight the framework doesn't encode.
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

**Honest fallback:** If all revenue signals are negative at month 9, the body of work — blueprints, configuration reference, security pattern catalog, 74 production hardening patterns — is a portfolio of deep technical work in AI agent infrastructure. Valuable for job applications, advisory roles, speaking, and credibility in the space even if ClawHQ never generates direct revenue. The work is not wasted; it's repositioned.

---

## What We're Not Building

- **A fork of OpenClaw** — We contribute to it, not compete with it.
- **A replacement for OpenClaw's built-in UI** — The Control UI handles config editing. ClawHQ's value is composition, lifecycle, and security — not forms.
- **A model routing engine** — OpenClaw handles model calls. We set policy via config.
- **Managed hosting as primary business** — 10+ funded competitors own this. Sovereignty is the position.
- **A community blueprint marketplace** — 10 a-la-carte mission profiles with production-tested tools, skills, and operational playbooks beat 177 untested SOUL.md-only templates. Quality over quantity.
- **A personality menu** — 95% of users want the same thing: a competent professional that doesn't waste their time. One good default + a warmth slider + free-text overrides. Domain behavior lives in skills, not personality.

See [ROADMAP.md § Known Limitations](ROADMAP.md#known-limitations) for current constraints (Docker required, Linux/macOS only, single machine, blueprints not yet publishable, etc.).

---

## Links

- Configuration Reference: `docs/OPENCLAW-REFERENCE.md`
- Blueprint Specification: `docs/BLUEPRINT-SPEC.md`
- Architecture: `docs/ARCHITECTURE.md`
- Strategy: `docs/STRATEGY.md`
- Roadmap: `docs/ROADMAP.md`
