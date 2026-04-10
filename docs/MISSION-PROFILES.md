# ClawHQ Mission Profiles

> The a-la-carte menu. Each profile is a coherent set of tools, cron jobs, skills, egress domains, and autonomy rules serving a specific job to be done. Stack what you need.

**Version:** 0.1.0
**Status:** Draft
**Updated:** 2026-04-03

---

## How Profiles Work

A mission profile defines **what** the agent can do in a specific domain. Users compose their agent by stacking one or more profiles. Each profile brings its own tools, skills, cron jobs, security posture, and operational playbook. Agent tone is a single professional default — domain-specific behavior lives in skills and playbooks, not personality config.

**Organizing principle:** Two profiles should never fight over who owns a tool. If a tool could belong to two profiles, that's a boundary problem. Each profile owns specific tools, cron patterns, integrations, and egress domains. Cross-profile collaboration happens through signaling, not shared ownership.

**Everyone starts with LifeOps.** It's the universal base — personal admin that justifies the always-on cost. Other profiles add domain-specific capability on top.

**Not profiles — infrastructure layers:**
- **Messaging channels** (Telegram, WhatsApp, Discord, Slack, Signal, iMessage) — transport, configured at agent level. Every profile uses them; none owns them.
- **Files/cloud storage** (rclone, Google Drive, Dropbox, local filesystem) — shared infrastructure any profile can read/write.
- **Voice I/O** (Whisper STT for inbound voice messages) — input modality, not a mission.
- **Sovereign mode** — a provider-preference overlay applied across all active profiles. Swaps cloud providers for self-hosted alternatives: Tavily→SearXNG, OpenAI Whisper→Whisper.cpp, cloud notes→Obsidian, cloud TTS→Piper. Not a profile — a philosophy.

---

## The 10 Profiles

### 1. LifeOps

*Your day, handled.*

**Job to be done:** Personal administration — the daily operational load everyone carries.

**Owns:**
- Email triage and response drafting (Himalaya — any IMAP provider)
- Calendar management and conflict detection (khal/vdirsyncer — any CalDAV provider)
- Task management (Todoist, Linear, Apple Reminders, Notion, etc.)
- Weather briefings (Open-Meteo)
- Meal planning, grocery lists, recipe management
- Morning and evening briefings
- Appointment coordination and reminders
- Routine household logistics

**Cron patterns:** Morning brief (daily), email triage (every 15min waking), task review (every 30min waking), evening summary (daily).

**Key integrations:** Email (required), calendar (required), tasks (required), weather (recommended).

**Boundary:** LifeOps is personal admin. The moment work involves a business pipeline, a codebase, a financial instrument, or a content publication — you're in another profile.

---

### 2. Dev

*Code from anywhere.*

**Job to be done:** Software development and infrastructure maintenance from any device.

**Owns:**
- GitHub/GitLab operations (gh, glab) — issues, PRs, repos, actions
- Git operations — commits, branches, merges
- CI/CD monitoring and deployment triggers
- Error tracking (Sentry)
- Issue tracking for dev teams (Linear, Jira)
- PR creation, review, and merge management
- Repository monitoring — new issues, failing builds, security alerts
- Architecture decision support
- Code generation and refactoring

**Cron patterns:** CI/CD status check (every 15min waking), repo monitoring (every 30min), dependency security scan (daily).

**Key integrations:** GitHub or GitLab (required), git (required), CI/CD (recommended), error tracking (optional).

**Boundary:** Dev is about building and maintaining software. Updating marketing site copy is Marketing. Fixing the site's infrastructure or deployment pipeline is Dev if it's code/infra, SiteOps if it's content deployment and uptime.

---

### 3. Research

*Deep work on demand.*

**Job to be done:** Finding, synthesizing, and organizing knowledge.

**Owns:**
- Web search and deep research (Tavily, Brave Search, SearXNG, Perplexity)
- Synthesis and analysis — turning raw sources into structured insight
- Long-form draft writing (reports, memos, analysis documents)
- Knowledge base management (Obsidian, Notion, Logseq, Nextcloud Notes)
- Document summarization
- Competitive analysis and landscape mapping
- Literature review and citation management

**Cron patterns:** Knowledge base maintenance (weekly), source monitoring for tracked topics (daily).

**Key integrations:** Web search (required), knowledge base (recommended), notes (optional).

**Boundary:** Research produces knowledge artifacts — reports, summaries, analysis docs, knowledge base entries. It does not publish them anywhere public-facing. Publishing is Marketing's job. Research hands off finished artifacts; Marketing distributes them.

---

### 4. Markets

*Eyes on the money.*

**Job to be done:** Financial market monitoring, analysis, and trading.

**Owns:**
- Market data feeds (Yahoo Finance, Alpha Vantage, Polygon.io)
- Portfolio tracking and P&L monitoring
- Chart analysis (TradingView via browser automation)
- SEC filing monitoring (EDGAR watcher)
- Trading execution (Alpaca, Interactive Brokers)
- Crypto monitoring and trading (Coinbase)
- Price, volume, and filing event alerts
- Risk management and position sizing

**Cron patterns:** Market data refresh (every 5min during market hours), portfolio snapshot (daily market close), filing watch (every 30min), overnight futures/crypto check (configurable).

**Key integrations:** Market data (required), portfolio tracking (required), trading execution (optional — many users monitor only).

**Boundary:** Markets is about financial instruments — stocks, bonds, options, crypto, commodities. Business financials (revenue tracking, invoicing, runway, bookkeeping) are not Markets. That's a Finance/Accounting concern (identified gap, future profile).

---

### 5. Sales

*Pipeline, worked.*

**Job to be done:** Managing the relationship pipeline from lead to close.

**Owns:**
- CRM operations (HubSpot, Salesforce, Pipedrive, Airtable, Google Sheets)
- Lead tracking and scoring
- Outreach drafting (cold emails, follow-ups, LinkedIn messages)
- Follow-up sequence management
- Deal stage tracking and pipeline health
- Contact enrichment and research
- Meeting prep from CRM data
- Post-close handoff documentation

**Cron patterns:** Pipeline review (daily morning), follow-up reminders (every 2hr waking), deal stage stale check (daily), lead scoring refresh (daily).

**Key integrations:** CRM (required), email (uses LifeOps email — cross-profile signaling).

**Boundary:** Sales owns lead-to-close. Marketing generates the leads that enter the pipeline; Sales works them. Post-close customer success is gray — stays in Sales for now because the tooling is the same CRM.

**Cross-profile signaling:** Sales reads from LifeOps email (inbound from prospects) and requests Marketing to produce outreach content. Sales doesn't own the email tool — it signals LifeOps to draft/send on its behalf with sales context.

---

### 6. Marketing

*Get the word out.*

**Job to be done:** Creating and distributing content to attract attention and generate leads.

**Owns:**
- Social media posting and scheduling (X, LinkedIn, Instagram, YouTube, TikTok — via browser automation or platform APIs)
- Content calendar management
- Newsletter composition and sending
- SEO monitoring and keyword tracking
- Analytics dashboards (traffic, engagement, conversion)
- Content repurposing (long-form → social clips, threads, summaries)
- Ad campaign monitoring
- Brand monitoring and mention tracking

**Cron patterns:** Social media queue check (every 2hr waking), analytics snapshot (daily), SEO rank check (weekly), brand mention scan (daily).

**Key integrations:** Social media platforms (required), analytics (recommended), newsletter platform (optional).

**Boundary:** Marketing creates and distributes. It doesn't write deep research (that's Research — Marketing may request Research to produce a draft, then repurpose it). It doesn't manage the website's technical infrastructure (that's SiteOps). Marketing owns the editorial calendar and the act of publishing.

**Cross-profile signaling:** Marketing requests from Research (produce an analysis I can turn into content), from Media (generate a social image or video clip), and hands leads to Sales (new inbound from content).

---

### 7. SiteOps

*Your web presence, maintained.*

**Job to be done:** Keeping websites up, fast, correct, and deployed.

**Owns:**
- Website content updates and page management
- Deployment pipelines (static site generators, CMS deploys)
- Uptime monitoring and alerting
- SSL certificate and domain management
- CMS operations (headless CMS APIs, WordPress, static site builders)
- Page speed monitoring and optimization
- Broken link detection and repair
- SEO technical audit (distinct from Marketing's SEO keyword tracking)
- Staging/production environment management

**Cron patterns:** Uptime check (every 5min), SSL expiry check (daily), broken link scan (weekly), page speed audit (weekly), deployment status (on-push or every 15min).

**Key integrations:** Deployment pipeline (required), domain/DNS (required), CMS (recommended), monitoring (recommended).

**Boundary:** SiteOps is the webmaster. It maintains and deploys the site. It doesn't create the content strategy (Marketing), write the articles (Research or Marketing), or build new site features (Dev). If the work is "make the site work," it's SiteOps. If the work is "build a new feature for the site," it's Dev.

---

### 8. Home

*Your space, smart.*

**Job to be done:** Physical space automation and monitoring.

**Owns:**
- Home Assistant REST API integration
- HomeKit device control (macOS only)
- Smart device management — lights, thermostats, locks, switches
- Camera monitoring and alerting
- MQTT device communication
- Presence-based automation routines
- Energy monitoring

**Cron patterns:** Device health check (every 30min), camera review summary (configurable), presence routine triggers (event-driven), energy report (daily).

**Key integrations:** Home Assistant (required — the standard), smart devices (via HA).

**Boundary:** Home is physical space automation. Completely disjoint from all other profiles. The only cross-profile signaling is with LifeOps (e.g., "I'm leaving — arm the system and adjust thermostat").

---

### 9. Health

*Body data, tracked.*

**Job to be done:** Biometric monitoring, fitness tracking, and wellness optimization.

**Owns:**
- Wearable data ingestion (WHOOP, Oura, Garmin, Apple Health export)
- Activity tracking (Strava, workout logs)
- Nutrition tracking and analysis (Cronometer via browser automation)
- Sleep analysis and recommendations
- Recovery scoring and readiness assessment
- Supplement and medication reminders
- Workout programming and adaptation
- Body composition tracking

**Cron patterns:** Wearable data sync (every 2hr), sleep analysis (morning), recovery assessment (morning), nutrition log reminder (meal times), weekly health summary (Sunday).

**Key integrations:** Wearable API (required — at least one of WHOOP/Oura/Garmin), nutrition tracking (recommended).

**Boundary:** Health tracks biometrics and fitness. Meal *planning* (what to cook, grocery lists, recipes) lives in LifeOps because it's daily logistics. Health owns nutritional *analysis* (macros, calorie targets, deficiency tracking) and body data.

**Cross-profile signaling:** Health informs LifeOps — "recovery is low, suggest lighter meals today" or "sleep was poor, clear morning calendar if possible." Health doesn't touch the calendar or meal plan directly; it signals LifeOps with recommendations.

---

### 10. Media

*Create and transform.*

**Job to be done:** Producing and manipulating creative assets.

**Owns:**
- Image generation (DALL-E, ComfyUI local, fal.ai)
- Video processing (FFmpeg, Sora)
- Voice synthesis / TTS (ElevenLabs, Piper local)
- Image manipulation (ImageMagick)
- Audio processing and editing
- Creative asset production pipelines

**Cron patterns:** None by default — Media is reactive, triggered by requests from other profiles or direct user commands.

**Key integrations:** At least one generation provider (required), FFmpeg (recommended — always available in Docker).

**Boundary:** Media is a production toolkit, not an autonomous actor. Other profiles *request* from Media: Marketing needs a social image, Research needs a diagram, LifeOps needs a voice memo transcribed. Media provides the capability; the requesting profile provides the intent and context.

---

## Cross-Profile Signaling

Profiles don't share tool ownership, but they do communicate. The signaling model:

| From | To | Signal |
|------|-----|--------|
| Health | LifeOps | Recovery/sleep data → meal and schedule adjustments |
| Research | Marketing | Finished analysis → content for distribution |
| Marketing | Sales | Inbound leads from content → pipeline entries |
| Marketing | Media | Content needs → asset generation requests |
| Sales | LifeOps | Prospect communication → email drafting with sales context |
| Home | LifeOps | Presence events → schedule and routine adjustments |
| Any | Media | Asset requests → creative production |

This signaling is currently implemented through the agent's reasoning — SOUL.md and AGENTS.md describe the relationships between active profiles. A future spec version may formalize signaling as explicit inter-profile contracts.

---

## Common Stacks

Recommended starting compositions by audience. These are entry points, not products — users adjust freely.

| Audience | Recommended Stack | Why |
|----------|------------------|-----|
| Everyone | LifeOps | Universal base. Justifies always-on cost alone. |
| Developer | LifeOps + Dev | Code from anywhere. Morning brief includes repo status. |
| Solo founder | LifeOps + Dev + Marketing + Sales | The full indie operation. |
| Investor / trader | LifeOps + Markets + Research | Market monitoring with deep analysis capability. |
| Knowledge worker | LifeOps + Research | Research and synthesis on demand. |
| Content creator | LifeOps + Marketing + Media | Create and distribute with asset production. |
| Homelab enthusiast | LifeOps + Home + Dev | Smart home meets agent infrastructure. |
| Health optimizer | LifeOps + Health | Biometrics-informed daily operations. |
| Power user | LifeOps + Markets + Research | Multi-profile daily driver — one agent, many hats. |

---

## Identified Gaps (Future Profiles)

These are real use cases without a current profile home. Tracked for future development when tooling and demand justify:

1. **Finance/Accounting** — Invoicing, expense tracking, bookkeeping, runway monitoring, tax prep. QuickBooks, Xero, Stripe, bank feed monitoring. Distinct from Markets (instruments) and Sales (pipeline). Solo founders and freelancers need this.

2. **Comms/Community** — Discord server management, community moderation, Slack workspace ops, forum monitoring. Distinct from messaging-as-transport. The person running a community or open-source project needs this.

3. **Travel** — Booking, itinerary management, loyalty program tracking, flight monitoring. Real use case but thin tooling ecosystem.

4. **Legal/Compliance** — Contract review, compliance monitoring, regulatory tracking. Niche but real for founders and regulated industries.

5. **Education/Learning** — Flashcard generation, study scheduling, paper reading pipeline. May fold into Research as a specialization rather than a standalone profile.

---

## Design Principles

1. **Clean boundaries.** Each tool has exactly one profile owner. No ambiguity about which profile handles what.

2. **Additive composition.** Profiles stack cleanly. LifeOps + Dev + Marketing should produce no conflicts, no redundant tools, no contradictory cron patterns.

3. **Independent scaling.** Adding a profile adds capability without disrupting existing profiles. Removing one doesn't break the others.

4. **Sovereign by default.** Each profile prefers self-hosted, local-first tool options. Cloud providers are available for better quality/convenience, but the default path runs on your hardware with your data.

5. **Provider-agnostic.** Profiles own tool *categories*, not specific providers. "Email" means Himalaya with any IMAP backend — Gmail, Fastmail, iCloud, self-hosted. Provider selection is a credential and egress problem, not a profile problem.
