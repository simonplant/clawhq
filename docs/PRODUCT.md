# ClawHQ — Product Design Document

**The control panel for OpenClaw agents.**

---

## The Problem

OpenClaw gives you a persistent AI agent with tools, memory, cron jobs, and messaging integrations — running in a Docker container you control. It's the most powerful open-source framework for personal agents.

It's also nearly impossible to operate.

Setting up a production agent takes weeks of trial and error. Keeping it running requires ongoing SRE work. The framework is excellent — the operational burden is the bottleneck.

### What Goes Wrong

Every item below was discovered running a production agent for months:

- **14 configuration landmines** that silently break the agent. No errors, no warnings — just an agent that doesn't work. Each takes hours to diagnose.
- **Memory bloat** — 360KB in 3 days without lifecycle management. Context windows overflow. Agent quality degrades.
- **Credential rot** — API keys expire silently. The agent doesn't notice. The user thinks everything is fine.
- **Identity drift** — Personality files corrupt, bloat, and go stale. The agent slowly becomes someone else.
- **Security is opt-in** — Defaults let the agent escalate privileges and read the host filesystem.
- **Configuration fragmentation** — ~13,500 tokens across 11+ files. 40% is universal, 60% is personalized. No tooling separates the two.
- **Ongoing SRE burden** — Cron jobs fail silently, integrations degrade, costs accumulate, backups don't happen.

### The Gap

Today you choose between **raw framework** (powerful, months of expertise required) or **basic hosting** (someone runs the container with default config). Nobody offers the full lifecycle — from initial design through long-term evolution to eventual decommissioning — that makes an agent production-ready and keeps it that way.

This is exactly the gap that control panels filled for Linux servers. In the early 2000s, Linux was powerful but operationally brutal — configuring Apache, managing SSL, setting up email, writing cron jobs, hardening security. Then cPanel, Plesk, and Webmin emerged. They didn't replace Linux. They made it usable. The server was the engine. The panel made it run.

---

## What ClawHQ Is

The control panel for OpenClaw agents. A suite of toolchains covering every phase of the agent lifecycle — the same way a VPS control panel covers every phase of server management from initial setup through daily operations to decommission.

Every successful open-source infrastructure engine follows this pattern:

| Engine | Operational Burden | Control Panel |
|---|---|---|
| Linux | Server admin, security, mail, cron | cPanel, Plesk, Webmin |
| WordPress | Hosting, updates, security, backups | WordPress.com, managed WP hosting |
| AWS/multi-cloud | Infrastructure provisioning, governance | RightScale, CloudFormation |
| Kubernetes | Container orchestration, networking | Rancher, OpenShift |
| **OpenClaw** | **Agent config, security, monitoring, evolution** | **ClawHQ** |

ClawHQ is the management layer that makes OpenClaw production-ready — with purpose-built toolchains for each phase of the agent lifecycle.

### The Lifecycle

```
Plan  →  Build  →  Secure  →  Deploy  →  Operate  →  Evolve  →  Decommission
```

Seven phases. Each is a distinct problem domain with its own toolchain. Together they cover the complete lifecycle — from the moment you decide to create an agent to the moment you decide to end it.

### Two Delivery Modes

**ClawHQ Managed** — We host the panel and the agent. Web console. You never touch a terminal. We manage the container lifecycle, not the contents. Think managed WordPress hosting — same WordPress, zero ops.

**ClawHQ Self-Operated** — Install the panel on your own hardware. Same engine, full control. Think installing cPanel on your own VPS — same panel, your server.

Both modes use identical toolchains. Self-operated is the open-source engine. Managed wraps it with infrastructure, a web console, and support.

---

## The Toolchains

### 1. Plan

> *From "I want an agent" to a complete, valid, deployable configuration bundle — without touching a single config file.*

#### The Problem

An OpenClaw deployment requires ~13,500 tokens of configuration spread across 11+ files: `openclaw.json` (runtime config), `.env` (secrets), `docker-compose.yml` (container orchestration), and 5-7 identity files (SOUL.md, USER.md, AGENTS.md, HEARTBEAT.md, TOOLS.md, IDENTITY.md). Roughly 40% of this configuration is universal — the same for any user, encoding hardened defaults and landmine avoidance. The other 60% is personalized — personality, integrations, schedule, autonomy preferences.

No tooling separates the two. A new user must understand all of it, including 14 silent landmines that produce no errors when misconfigured. One wrong value in `openclaw.json` and the agent silently breaks — no crash, no log, just an agent that doesn't do what you asked.

#### What This Toolchain Does

**Templates** — Full operational profiles, not prompt skins. A template is the WordPress theme model applied to AI agents. Each template defines a complete configuration across every operational dimension:

| Dimension | What the Template Controls | Why It Matters |
|---|---|---|
| **Personality** | Tone, relationship model, communication style, boundaries | Defines how the agent interacts — steward vs. assistant vs. coach |
| **Security posture** | Hardening level, egress rules, isolation mode | A family coordinator needs different security than a day-trading analyst |
| **Monitoring profile** | Alert thresholds, check frequency, escalation rules | Guardian templates alert aggressively; analyst templates minimize interruption |
| **Memory policy** | Hot/warm/cold tier sizes, summarization aggressiveness, retention periods | Companion templates retain emotional context; assistant templates prune aggressively |
| **Cron configuration** | Heartbeat frequency, quiet hours, waking hours, budget caps | Coach templates check in frequently; analyst templates run on-demand |
| **Autonomy model** | What the agent handles independently vs. flags for approval | Guardian: high autonomy, pushes back on bad ideas. Assistant: handles routine, escalates exceptions |
| **Integration requirements** | Which tool categories are required, recommended, or optional | Coach requires tasks + calendar. Analyst requires research + code. |
| **Skill bundle** | Which pre-built skills are included | Morning brief, email digest, meeting prep, session reports, autonomous construction |

```yaml
# template.yaml — Guardian template (the production-tested default)
name: "Guardian"
version: "1.0.0"
author: "clawhq"
category: "personal"
description: "Proactive steward — manages your digital life, pushes back when needed"

personality:
  tone: direct
  style: "proactive, no sugarcoating, protective of user's time and attention"
  relationship: "trusted steward"
  boundaries: "will challenge bad ideas, will refuse harmful requests"

security:
  posture: hardened            # standard | hardened | paranoid
  egress: restricted           # default | restricted | allowlist-only
  identity_mount: read-only    # read-only | writable

monitoring:
  heartbeat_frequency: "10min"
  checks: [email, calendar, tasks, markets]
  quiet_hours: "23:00-05:00"
  alert_on: [credential_expiry, memory_bloat, cron_failure, integration_degraded]

memory:
  hot_max: "100KB"
  hot_retention: "7d"
  warm_retention: "90d"
  cold_retention: "365d"
  summarization: balanced

cron:
  waking_hours: "05:00-23:00"
  heartbeat: "*/10 waking"
  work_session: "*/15 waking"
  morning_brief: "08:00"

autonomy:
  default: high
  requires_approval: [large_purchases, account_changes, public_posts]

integrations_required: [messaging]
integrations_recommended: [email, calendar, tasks]
skills_included: [morning-brief, construct]
```

**Questionnaire** — Three-phase interactive flow:

1. **Basics** — Name your agent, set timezone, define waking hours, pick briefing time. The platform auto-generates the universal 40% of config with all hardened defaults and landmine protections.
2. **Template** — Browse available templates, see detailed previews of what each configures, select one, customize overrides (autonomy level, hard stops, personal context like work domain, interests, health conditions, family). The template applies its full operational profile.
3. **Integrations** — Select providers per category (email: iCloud/Gmail/Outlook, calendar: iCloud/Google, tasks: Todoist/TickTick, etc.). Guided credential setup with inline validation. Health check verification before proceeding. Secrets stored in `.env`, never in config files.

**Config Generator** — Assembles answers into a complete deployment bundle:

| Generated File | Contents | Landmines Auto-Handled |
|---|---|---|
| `openclaw.json` | Runtime config — models, tools, gateway, channels | `dangerouslyDisableDeviceAuth`, `allowedOrigins`, `trustedProxies`, `exec.host`, `exec.security`, `fs.workspaceOnly` |
| `.env` | Secrets — API keys, tokens, session keys | Token format validation, no secrets in config |
| `docker-compose.yml` | Container orchestration — volumes, networks, security | UID 1000, cap_drop ALL, read-only rootfs, ICC disabled, resource limits |
| `SOUL.md` | Agent personality and boundaries | Token budget vs. `bootstrapMaxChars` (20K default) |
| `USER.md` | User context — work, interests, preferences | Kept within token budget, structured for parseability |
| `AGENTS.md` | Multi-model routing — primary, subagent, heartbeat | Model IDs match auth profile capabilities |
| `HEARTBEAT.md` | Cron behavior — what to check, how to respond | Schedule syntax validated, waking hours respected |
| `TOOLS.md` | Available tools and usage guidance | Cross-referenced against actually-installed tools |
| `cron/jobs.json` | Scheduled job definitions | Stepping syntax validated (no `5/15`), timezone-correct |

Every generated file passes the same validation that `doctor` uses. It is impossible for the Plan toolchain to produce a broken config.

**Built-in templates:**

| Template | Relationship | Operational Profile |
|---|---|---|
| **Guardian** | Steward, protector | High autonomy, aggressive monitoring, hardened security, pushes back |
| **Assistant** | Professional aide | Medium autonomy, balanced monitoring, handles routine, flags exceptions |
| **Coach** | Accountability partner | Frequent check-ins, goal tracking, encouraging but firm |
| **Analyst** | Research partner | Low proactivity, deep on demand, minimal interruption |
| **Companion** | Conversational partner | Long memory retention, emotional context, warm check-ins |
| **Custom** | User-defined | Guided builder or raw YAML |

**Community templates** extend the platform to use cases we'd never design: real estate agent, student life manager, chronic illness tracker, day trader, family coordinator, solo founder, academic research assistant. Contributed via PR, reviewed for safety. Templates can tighten Layer 1 security baselines but can never loosen them.

```bash
clawhq init          # Guided questionnaire → complete deployment bundle
clawhq template      # Browse, preview, compare, customize templates
```

---

### 2. Build

> *From source code to auditable, reproducible container images — with every tool, skill, and integration baked in.*

#### The Problem

OpenClaw images should be built from source for auditability — you should be able to inspect every line of code running in your agent's container. But the build process is multi-stage and error-prone. The base image needs specific apt packages. Custom tooling (email clients, CLI tools, language runtimes) needs a second build layer. Skills and integration tools need to be bundled correctly. Version mismatches between the base image and custom layer cause silent failures. And the whole thing needs to be reproducible — the same config should produce the same image every time.

#### What This Toolchain Does

**Source Management** — Clone or update the OpenClaw source repository. Track which upstream version is deployed. Detect when upstream changes might break the current configuration. Maintain a local source cache for offline builds.

**Two-Stage Docker Build** — The same architecture proven in production:

```
Stage 1: openclaw:local (base image)
├── OpenClaw source (upstream)
├── apt packages: tmux, ffmpeg, jq, ripgrep (configurable per template)
├── Node.js runtime + dependencies
└── Base tools: git, curl, openssl

Stage 2: openclaw:custom (user layer)
├── himalaya (IMAP email client, static musl binary)
├── gh (GitHub CLI)
├── Additional tools declared by template
├── Integration CLI wrappers (todoist, ical, quote, tavily, email)
├── Skills (morning-brief, construct, etc.)
└── Custom user tools
```

Stage 1 rebuilds only when OpenClaw upstream changes or apt packages change. Stage 2 rebuilds when tools, skills, or integration wrappers change. This separation means most builds only need Stage 2 — seconds instead of minutes.

**Tool Bundling** — Each integration declares its CLI tools. The Build toolchain collects them from the template's integration manifest and copies them into the image at the correct paths with correct permissions. Tools are validated before bundling — syntax check for shell scripts, import check for Python, build check for Go.

**Skill Packaging** — Skills declared by the template are bundled into the workspace directory. Each skill is validated: required files present, prompt templates parseable, declared dependencies (tools, integrations) satisfied.

**Build Verification** — After build completes:
- Verify both image layers exist with expected tags
- Spot-check that declared binaries are present and executable
- Verify tool versions match expectations
- Check image size is reasonable (flag bloat from accidental inclusion)
- Generate a build manifest (image hash, tool versions, upstream commit, build timestamp)

**Reproducibility** — Build manifests are stored alongside the deployment. `clawhq build --verify` rebuilds and compares against a previous manifest to detect drift.

```bash
clawhq build                    # Two-stage build from source
clawhq build --stage1-only      # Rebuild base image only
clawhq build --stage2-only      # Rebuild custom layer only
clawhq build --verify           # Rebuild and compare against manifest
clawhq build --dry-run          # Show what would be built without building
```

---

### 3. Secure

> *Hardened by default. Monitored continuously. Every secret managed. Every skill vetted. Security is the baseline, not a feature flag.*

#### The Problem

OpenClaw's security is entirely opt-in. The default configuration runs as root with full capabilities, no egress filtering, secrets in config files, and writable identity files — the agent can modify its own personality and remove its own guardrails. Most users never harden their deployment because they don't know what to harden or how.

Beyond the container itself: agents create code, push to repos, and generate files that may contain PII or leaked secrets. There's no scanning. Credentials expire silently — the agent doesn't notice, continues running, and the user assumes everything is fine because the container is healthy. Community skills represent an unvetted supply chain. And thousands of instances sit publicly exposed with authentication bypasses.

#### What This Toolchain Does

**Container Hardening** — Applied automatically by the Deploy toolchain, configured by the template's security posture:

| Control | Standard | Hardened | Paranoid |
|---|---|---|---|
| Linux capabilities | `cap_drop: ALL` | `cap_drop: ALL` | `cap_drop: ALL` |
| Filesystem | Read-only rootfs | Read-only rootfs | Read-only rootfs + encrypted workspace |
| Privilege escalation | `no-new-privileges` | `no-new-privileges` | `no-new-privileges` |
| User | Non-root (UID 1000) | Non-root (UID 1000) | Non-root (UID 1000) |
| Temp storage | tmpfs 256MB, noexec/nosuid | tmpfs 128MB, noexec/nosuid | tmpfs 64MB, noexec/nosuid |
| Network isolation | ICC disabled | ICC disabled | ICC disabled + allowlist egress |
| Resource limits | 4 CPU, 4GB RAM | 2 CPU, 2GB RAM | 1 CPU, 1GB RAM |
| Identity files | Read-only mount | Read-only mount | Read-only mount + integrity hash |
| Workspace | Writable (scoped) | Writable (scoped) | Writable (encrypted at rest) |

**Egress Firewall** — iptables rules restricting container network access:

- Allow established/related connections (return traffic)
- Allow DNS (UDP/TCP 53) — required for API resolution
- Allow HTTPS (TCP 443) — required for API calls
- Log and drop everything else

The firewall is implemented as a dedicated iptables chain (`CLAWHQ_FWD`) attached to the Docker bridge interface. Critical operational detail: after every `docker compose down`, Docker destroys and recreates the bridge interface, invalidating the chain. ClawHQ detects this and reapplies automatically — a landmine that has caused hours of debugging in manual setups. The Deploy toolchain applies the firewall; Doctor verifies it continuously.

**Network & Access Hardening** — Attack surface reduction beyond containers:

| Control | What It Prevents | Implementation |
|---|---|---|
| Gateway binding | Publicly exposed instances via `0.0.0.0` binding | Enforce loopback-only binding by default |
| WebSocket origin validation | Cross-site WebSocket hijacking (ClawJacked vector) | Origin header validation on all upgrade requests |
| CSRF protections | Unauthorized state changes via cross-site requests | Token-based guards on all state-changing operations |
| mDNS/Bonjour control | Network reconnaissance via service discovery | Disable service discovery broadcasts in container |
| Secure remote access | Raw port exposure | Tailscale, SSH tunnels, or Cloudflare Tunnel only |
| Device pairing | Silent auto-pairing on localhost | Explicit device registration approval required |
| Auth failure tracking | Brute-force attacks | Failed auth logging with fail2ban integration |

**Secrets Management** — Secrets (API keys, tokens, session keys) are injected via environment variables from `.env`, never stored in config files:

- `.env` file permissions set to 600 (owner-only read/write)
- Config files scanned for embedded secrets on every `doctor` run
- `.env.example` template tracked in version control with `CHANGE_ME` placeholders
- Secrets never logged, never included in backups without encryption
- Enterprise option: source secrets from HashiCorp Vault, AWS Secrets Manager, Doppler, or 1Password CLI instead of `.env`
- Scheduled rotation of API keys and tokens; per-service scoping with minimum necessary permissions

**PII & Secret Scanning** — Continuous scanning of agent-created artifacts:

| Scan Target | What It Catches | How |
|---|---|---|
| Agent repos | PII (names, addresses, phone, SSN, credit cards) | Regex patterns with false-positive filtering |
| Agent repos | Secrets (API keys: `ghp_*`, `sk-ant-*`, `AKIA*`, Bearer tokens, JWTs) | Pattern matching + entropy analysis |
| Agent repos | Dangerous files (`.env`, `*.pem`, `*.key`, `id_rsa*`, `*.db`) | Filename patterns |
| Git history | Previously committed secrets | `git log` pattern scan |
| Repo settings | Public repos that should be private, unauthorized collaborators, deploy keys | GitHub API policy checks |

The scanner skips known false positives: `CHANGE_ME` placeholders, environment variable references (`$VAR`), comments explaining patterns, and functional identity references in designated files (USER.md, MEMORY.md).

**Supply Chain Security** — Agent skills and community contributions represent an attack surface:

| Control | What It Does |
|---|---|
| Skill vetting | AI-powered scanning of community skills before installation; VirusTotal integration |
| Skill allowlisting | Internal registry of approved skills only; block unapproved installs |
| IOC database | Known C2 IPs, malicious domains, file hashes, publisher blacklists from known campaigns |
| CVE monitoring | Automated NVD CVE polling; community threat intelligence feeds; same-day fleet patching |

**Credential Health** — Per-integration probes that test actual credential validity:

| Integration | Health Probe | What It Tests |
|---|---|---|
| Email (IMAP) | `himalaya account check` | IMAP + SMTP auth, server reachable |
| Calendar (CalDAV) | CalDAV PROPFIND request | Auth valid, calendar accessible |
| Tasks (Todoist) | `todoist projects` list | API key valid, API reachable |
| Code (GitHub) | `gh auth status` | PAT valid, scopes sufficient |
| Research (Tavily) | Search query | API key valid, quota remaining |
| Finance (Yahoo) | Quote fetch | Endpoint reachable (no auth) |

Probes run on schedule (configurable per template). Failures trigger alerts with specific remediation steps. Credential expiry is tracked where APIs expose it — 7-day advance warnings.

**Audit & Compliance** — Every tool execution inside the container is logged by OpenClaw. The Secure toolchain makes these logs accessible, searchable, and alertable:

- Tool execution history with timestamps, inputs (redacted), outputs (summarized)
- Anomaly detection: unusual tool usage patterns, unexpected outbound connections
- Exportable audit trail for compliance review
- SIEM forwarding: Splunk, Elastic, or Graylog with structured event format
- Alignment with OWASP GenAI Top 10, SOC 2, ISO 27001, GDPR, and HIPAA controls
- Published, community-maintained threat model with attack examples and mitigations per lifecycle phase

```bash
clawhq scan                     # Full PII + secret scan across agent repos
clawhq scan --repo <name>       # Scan specific repo
clawhq scan --history           # Include git history scan
clawhq creds                    # Credential health check
clawhq creds --renew <name>     # Guided credential renewal
clawhq audit                    # Review tool execution history
clawhq audit --cost             # Cost attribution report
clawhq audit --compliance       # Exportable compliance report
```

---

### 4. Deploy

> *One command: container up, firewall applied, networks verified, channels connected, health confirmed. No manual steps, no forgotten scripts.*

#### The Problem

Deploying an OpenClaw agent is a multi-step sequence where skipping any step produces a subtly broken system. You need to `docker compose up` with the correct project directory and file paths, then apply the egress firewall (which requires sudo and knowledge of the bridge interface name), then verify the ollama-bridge network is connected (it's an external network that must exist before compose runs), then wait for the healthcheck to pass, then verify the agent can actually reach its integrations through the firewall. After every `docker compose down`, the bridge interface changes — the firewall must be reapplied. Miss that step and the agent runs without egress filtering until someone notices.

#### What This Toolchain Does

**Pre-flight Checks** — Before starting anything:

| Check | What It Validates | Failure Action |
|---|---|---|
| Docker daemon | Running, accessible, version compatible | Error with install instructions |
| Images exist | Both `openclaw:local` and `openclaw:custom` tags present | Prompt to run `clawhq build` |
| Config valid | `openclaw.json` passes full schema validation | Run `doctor`, show specific issues |
| Secrets present | `.env` exists with all required variables populated | List missing variables |
| Networks exist | External networks (`ollama-bridge`) created | Create automatically or error with instructions |
| Ports available | Required ports (18789) not in use | Show what's using the port |
| Permissions | Config dirs owned by UID 1000, correct modes | Auto-fix or show commands |
| Prior state | Check for orphaned containers from previous runs | Offer cleanup |

**Container Orchestration** — `docker compose up -d` with the correct project context:

- Compose file: resolved from `clawhq.yaml` manifest (default: `~/.clawhq/compose/docker-compose.yml`)
- Environment: `.env` loaded from deployment directory
- Project name: consistent naming for `docker compose` commands
- Force-recreate if config has changed since last deploy

**Firewall & Network** — Immediately after containers start, the Deploy toolchain applies the egress firewall defined by the Secure toolchain and verifies the full network stack:

1. Detect the Docker bridge interface for the agent network (`br-<hash>`)
2. Apply `CLAWHQ_FWD` iptables chain (ESTABLISHED/RELATED → DNS → HTTPS → LOG+DROP)
3. Persist with `netfilter-persistent` (survives reboot)
4. Verify `ollama-bridge` connects the agent container to the Ollama service
5. Test DNS resolution and HTTPS connectivity from inside the container
6. Confirm ICC is disabled on the agent network

Requires sudo. The toolchain explains why and what it's doing before prompting.

**Health Verification** — Wait for the OpenClaw healthcheck to pass:

- Poll `http://localhost:18789/healthz` inside the container (Node.js fetch)
- Timeout after 60 seconds with diagnostic output (container logs, network state)
- Verify the gateway token is accepted (authenticated health check)
- Confirm cron scheduler is running (jobs loaded, next execution scheduled)

**Channel Connection** — Messaging channel setup (separate from container deployment):

- Telegram: guide through BotFather bot creation, token configuration, first-message pairing
- WhatsApp/Slack/Discord/Signal: provider-specific setup flow
- Verify bidirectional message flow (send test message, confirm receipt)

**Infrastructure Provisioning** (Managed mode) — For ClawHQ Managed, the Deploy toolchain also handles infrastructure:

| Capability | Description |
|---|---|
| Multi-cloud deploy | One-click provisioning across Hetzner, DigitalOcean, Vultr, AWS, and self-hosted VMs |
| Server sizing | Recommend CPU/RAM/storage based on intended workload and template requirements |
| Region selection | Deploy to geographically optimal datacenter for latency to messaging platform APIs |
| DNS & SSL automation | Automatic subdomain creation, Let's Encrypt certificate provisioning and renewal |
| Reverse proxy | Auto-configured nginx/Traefik with TLS termination, WebSocket support, and rate limiting |
| Infrastructure-as-code | Reproducible provisioning via cloud-init templates |

**Media Directory Setup** — Create required bind-mount directories:

- `~/.openclaw/media/inbound` for Telegram attachments
- Correct ownership (UID 1000) and permissions
- Symlinks don't work inside the sandboxed container — bind mounts are required

**Post-Deploy Smoke Test** — After everything is up:

- Send a test message through the messaging channel
- Verify the agent responds coherently
- Confirm identity files are loaded (agent knows its name and personality)
- Run a quick integration probe (one tool per connected integration)

```bash
clawhq up                       # Full deploy: preflight → compose → firewall → verify
clawhq up --skip-firewall       # Deploy without firewall (development)
clawhq up --dry-run             # Show what would happen without doing it
clawhq connect                  # Connect/reconnect messaging channel
clawhq connect --test           # Send test message through channel
clawhq down                     # Graceful shutdown (preserves state)
clawhq restart                  # Restart with firewall reapply + health verify
```

---

### 5. Operate

> *Day-2 through day-365. Diagnostics, monitoring, cost tracking, backup, updates, fleet management. The invisible work that separates a demo from a production system.*

#### The Problem

A deployed agent starts degrading immediately. Credentials expire. Memory grows. Cron jobs fail silently. Upstream releases introduce breaking changes. Config files drift from the generated state. Backups don't happen. Without active operational management, a working agent becomes a broken agent within weeks — and the user doesn't know until something visibly fails.

This is full-time SRE work. It's the reason most OpenClaw deployments are abandoned within a month.

#### What This Toolchain Does

**Doctor** — The hero feature. Preventive diagnostics that check every known failure mode:

*Configuration Landmines (14+ rules):*

| # | Landmine | What Goes Wrong | What Doctor Checks |
|---|---|---|---|
| 1 | `dangerouslyDisableDeviceAuth: true` missing | "Device signature invalid" loop — agent becomes inaccessible | Key present and `true` in `openclaw.json` |
| 2 | `allowedOrigins` stripped after onboard | Control UI returns CORS errors, can't manage agent via web | Array contains expected origin |
| 3 | `trustedProxies` stripped after onboard | Gateway rejects requests through Docker NAT | Array contains Docker bridge gateway IP |
| 4 | `tools.exec.host` set to wrong value | `"node"` fails (no companion), `"sandbox"` fails (no Docker-in-Docker) | Value is `"gateway"` |
| 5 | `tools.exec.security` not `"full"` | Tool execution silently restricted | Value is `"full"` |
| 6 | Container user not UID 1000 | Permission errors on mounted volumes | Compose file specifies `user: "1000:1000"` |
| 7 | ICC enabled on agent network | Containers can communicate (security breach) | Docker network inspect shows ICC disabled |
| 8 | Identity files exceed `bootstrapMaxChars` | Files silently truncated — agent loses personality context | Sum of identity file sizes vs. threshold (default 20K) |
| 9 | Cron stepping syntax invalid | `5/15` is invalid, must be `3-58/15` — jobs silently don't run | Regex validation on all cron expressions |
| 10 | External networks not created | Compose fails or containers can't reach services | `docker network ls` for required networks |
| 11 | `.env` missing required variables | Container starts but integrations silently fail | Cross-reference compose env vars vs. `.env` |
| 12 | Config/credentials not read-only mount | Agent can modify its own config | Volume mount flags in compose |
| 13 | Firewall not applied after network recreate | Agent runs without egress filtering | `iptables -L CLAWHQ_FWD` |
| 14 | `fs.workspaceOnly` misconfigured | Too restrictive (can't read media) or too permissive (reads host FS) | Value matches expected for template security posture |

*Beyond landmines — operational health:*

| Check Category | What It Validates |
|---|---|
| File permissions | Config dirs owned by UID 1000, `.env` is 600, credential files are 600, config is 644 |
| Credential health | Live probes for each integration (reuses Secure toolchain's credential checks) |
| Cross-file consistency | Tools referenced in TOOLS.md exist in workspace, models in AGENTS.md match auth profile |
| Memory health | Workspace size, growth rate, time since last summarization |
| Cron health | All jobs have valid syntax, schedules are timezone-correct, no overlapping execution windows |
| Container resources | CPU/memory within limits, no OOM kills, tmpfs not full |
| Network state | Firewall active, bridge interface exists, ollama reachable |
| Configuration drift | Current config matches generated state; alerts on manual changes that weaken security |

Doctor outputs a structured report: pass/warn/fail per check, with specific fix instructions for every failure. It can also auto-fix safe issues (permissions, firewall reapplication) with `--fix`.

**Status** — Single-pane operational dashboard:

```
┌─────────────────────────────────────────────────────────┐
│  AGENT: Clawdius Maximus                                │
│  Status: ● Running (healthy)    Uptime: 14d 6h 23m     │
│  Restarts: 0    Image: openclaw:simon (built 3d ago)    │
├─────────────────────────────────────────────────────────┤
│  INTEGRATIONS                                           │
│  ● Email (iCloud)      Last check: 2m ago    ✓ Healthy │
│  ● Calendar (iCloud)   Last check: 2m ago    ✓ Healthy │
│  ● Tasks (Todoist)     Last check: 2m ago    ✓ Healthy │
│  ● Code (GitHub)       Last check: 2m ago    ✓ Healthy │
│  ● Research (Tavily)   Last check: 2m ago    ✓ Healthy │
│  ● Finance (Yahoo)     Last check: 2m ago    ✓ Healthy │
├─────────────────────────────────────────────────────────┤
│  COST                                                   │
│  Today: $0.43 (↓12%)    This week: $2.87    MTD: $8.14 │
│  By model: Sonnet $6.20 · Haiku $1.94                   │
│  Budget: $15/mo (54% used)    ⚠ Pace: $12.20 projected │
├─────────────────────────────────────────────────────────┤
│  CRON                                                   │
│  heartbeat     Last: 3m ago (OK)    Next: 7m            │
│  work-session  Last: 8m ago (OK)    Next: 7m            │
│  morning-brief Last: 6h ago (OK)    Next: 18h           │
│  construct     Last: 22h ago (OK)   Next: 2h            │
├─────────────────────────────────────────────────────────┤
│  WORKSPACE                                              │
│  Memory: 124KB (hot: 45KB, warm: 79KB)                  │
│  Growth: ~12KB/day    Last backup: 2h ago               │
│  Identity files: 8.2KB / 20KB budget (41%)              │
└─────────────────────────────────────────────────────────┘
```

Status data comes from:
- Container state: Docker API (inspect, stats)
- Integration health: reuses Secure toolchain's credential probes
- Cost: token usage tracked per model, per agent, per session; budget caps with alerts at 50%/75%/90% and graceful degradation to lower-cost models before pausing
- Cron status: parse `cron/jobs.json` for schedule + read execution logs for last run/outcome
- Workspace metrics: file size measurements + git log for growth rate

**Fleet Management** — For users running multiple agents:

- Monitor and manage multiple OpenClaw agents from a single dashboard across multiple servers
- Aggregated health, cost, and security posture across the fleet
- Fleet-wide operations: patch all agents, rotate all credentials, run doctor across fleet
- Per-agent drill-down from fleet view to individual status

**Backup** — Encrypted snapshots with restore:

| Backup Type | What's Included | Encryption | Retention |
|---|---|---|---|
| **Full snapshot** | Workspace, config, credentials, cron, identity files | GPG symmetric (passphrase) or asymmetric (key) | 30 days default |
| **Secrets-only** | `openclaw.json`, `.env`, `credentials/`, `identity/` | GPG (always encrypted) | 30 days |
| **Workspace incremental** | Workspace directory (rsync with hardlink dedup) | Optional | 30 days |

Restore from any snapshot to any point in time. Restore validates the snapshot integrity before applying, runs `doctor` after restore, and verifies the agent starts successfully.

**Update** — Safe upstream upgrades:

1. Fetch upstream OpenClaw source, show changelog (commits since current version)
2. Prompt for approval (show breaking changes, if any)
3. Two-stage rebuild (same as Build toolchain)
4. Stop current container, start new one
5. Wait for healthcheck pass
6. Reapply firewall and run `doctor` post-update to catch regressions
7. If anything fails: automatic rollback to previous image, restart, verify

The update toolchain maintains the previous image tag so rollback is always instant — no rebuild required.

**Incident Response** — Documented playbook for when things go wrong:

1. **Detect** — Automated alerts from monitoring, doctor, credential checks
2. **Contain** — Isolate affected agent (network disconnect, pause)
3. **Assess** — Audit trail review, scope determination
4. **Recover** — Restore from backup, credential rotation, re-deploy
5. **Report** — Exportable incident report with timeline and remediation steps

Automated credential rotation triggers on breach detection.

**Health Self-Repair** — Proactive recovery without human intervention:

- Auto-reconnect on network drops
- Gateway restart on crash detection
- Firewall reapplication on bridge interface change
- Self-healing deployment skill for common failure modes

**Logs** — Structured access to agent activity:

- Stream live container logs with filtering (tool executions, cron runs, errors)
- Historical log search with time ranges
- Cron job output history (per-job, per-run)

```bash
clawhq doctor                   # Full diagnostic — every known failure mode
clawhq doctor --fix             # Auto-fix safe issues (permissions, firewall)
clawhq doctor --json            # Machine-readable output
clawhq status                   # Single-pane health dashboard
clawhq status --watch           # Live-updating dashboard
clawhq status --cost            # Detailed cost breakdown
clawhq fleet                    # Fleet-wide status dashboard
clawhq fleet doctor             # Run doctor across all managed agents
clawhq backup                   # Full encrypted snapshot
clawhq backup --secrets-only    # Secrets backup only
clawhq backup restore <id>      # Restore from snapshot
clawhq backup list              # List available snapshots
clawhq update                   # Safe upstream upgrade
clawhq update --check           # Show what would change without updating
clawhq update --rollback        # Roll back to previous version
clawhq logs                     # Stream live logs
clawhq logs --cron heartbeat    # Cron job history for specific job
```

---

### 6. Evolve

> *Agents degrade without active lifecycle management. Identity drifts. Memory bloats. Personality shifts. Evolve is the toolchain that keeps your agent becoming more useful, not less.*

#### The Problem

A newly deployed agent works well. After a week, memory has grown by ~120KB and context windows are getting crowded. After a month, identity files have been implicitly reinterpreted so many times that the agent's behavior has drifted from the original intent. After three months, some integrations have been deprecated by their providers, credentials have rotated, and the user's own needs have changed. Without active lifecycle management, a good agent becomes a bad agent — not through any single failure, but through slow accumulation of drift.

This is the phase nobody else addresses. Basic hosting stops at deploy. Even sophisticated platforms treat the agent as a static deployment. But agents are living systems — they need ongoing evolution to remain useful.

#### What This Toolchain Does

**Identity Governance** — The agent's identity is defined by structured files (SOUL.md, USER.md, AGENTS.md, HEARTBEAT.md, TOOLS.md). Without governance, these files drift:

| Drift Type | What Happens | How Evolve Prevents It |
|---|---|---|
| **Bloat** | Files grow as users add context, exceeding `bootstrapMaxChars` and getting silently truncated | Token budget tracking per file, warnings at 70%/90% thresholds, guided compression |
| **Staleness** | Information becomes outdated (old job title, changed interests, deprecated tools) | Staleness detection based on last-modified dates + content heuristics, periodic review prompts |
| **Contradiction** | Different files make conflicting claims (SOUL says "never trade stocks," TOOLS lists a trading tool) | Cross-file consistency checks, contradiction flagging |
| **Scope creep** | Agent's role expands gradually beyond original intent | Boundary tracking against template definition, drift alerts |

Identity governance maintains a structured source of truth (version-controlled YAML) from which the markdown identity files are generated. Changes go through the source of truth, not through direct file edits — ensuring consistency and enabling rollback.

**Memory Lifecycle** — Without management, agent memory grows at ~120KB/day during active use:

```
Hot (in context)          Warm (indexed)           Cold (archived)
≤7 days, ≤100KB          7-90 days                90+ days
Full fidelity             Summarized, indexed      Summarized, compressed
In every conversation     Searchable on demand     Retrievable on demand
```

| Transition | What Happens | When |
|---|---|---|
| Hot → Warm | Conversation memories older than 7 days are summarized, key facts extracted, full text moved to warm storage | Daily (configurable) |
| Warm → Cold | Warm memories older than 90 days are further compressed, PII masked, archived | Weekly (configurable) |
| Cold → Deleted | Cold memories older than retention period are permanently removed | Per retention policy |

Each transition preserves the important information while reducing token cost. Summarization is LLM-powered (using the agent's own subagent model) — it understands context, not just truncation.

PII masking runs at each transition: names, addresses, phone numbers, financial details are detected and replaced with tagged placeholders that can be resolved if the original is needed.

**Personality Refinement** — Update the agent's personality and context without starting over:

- Re-run specific questionnaire sections (change just timezone, or just autonomy level, or just integrations — not the full init flow)
- Preview diffs before applying: see exactly what would change in each generated file
- Merge, not overwrite: manual customizations to identity files are preserved where possible, with conflicts flagged for review
- Template upgrade: when a template releases a new version, see what changed and apply selectively

**Integration Management** — Add, remove, or swap integrations:

- Add a new integration: guided credential setup, health verification, tool installation, identity file update (TOOLS.md)
- Remove an integration: clean credential removal, tool uninstall, identity file update, confirm no cron jobs depend on it
- Swap a provider: replace Gmail with iCloud for email category — same interface, different backend, guided migration

**Session Management** — Per-channel session control:

- Per-channel-peer DM isolation — conversations from different contacts don't cross-contaminate
- Identity linking across channels — same user recognized across Telegram, WhatsApp, Slack
- Session pruning and compaction for long-running conversations
- Configurable session timeouts and history retention per channel

**Behavioral Training** — Refine agent behavior from interaction history:

- Review interaction patterns: what the agent handled well, what it got wrong, what it escalated unnecessarily
- Feedback incorporation: user corrections and preferences extracted from conversation history, distilled into identity file updates
- Autonomy tuning: based on actual escalation patterns, recommend autonomy adjustments ("you approved 95% of email sends — consider auto-approve for routine replies")

```bash
clawhq evolve                   # Interactive evolution — guided updates
clawhq evolve --identity        # Review and update identity files
clawhq evolve --integrations    # Add, remove, or swap integrations
clawhq evolve --template        # Upgrade to new template version
clawhq evolve --diff            # Show what would change without applying
clawhq train                    # Behavioral analysis + refinement suggestions
clawhq train --review           # Review interaction patterns
clawhq train --autonomy         # Autonomy tuning recommendations
```

---

### 7. Decommission

> *End of life done right. Export everything portable. Destroy everything else. Verify the destruction cryptographically. No orphaned data, no lingering secrets.*

#### The Problem

When an agent needs to be retired — whether migrating to a new platform, shutting down permanently, or starting fresh — there's no clean way to do it. Data is scattered across bind mounts, Docker volumes, config directories, git repos, messaging platforms, and integration providers. Secrets persist in `.env` files, credential stores, and environment variables. The agent's workspace contains months of accumulated context, tools, and skills that may be valuable to preserve even if the agent itself is retired.

Without a structured decommission process, users either leave orphaned data everywhere (security risk) or delete things manually and miss something (both security risk and data loss).

#### What This Toolchain Does

**Export** — Create a portable bundle that captures everything valuable about the agent, independent of ClawHQ:

| Exported Artifact | Format | Contents |
|---|---|---|
| Identity bundle | Markdown + YAML | SOUL.md, USER.md, AGENTS.md, HEARTBEAT.md, TOOLS.md, template source |
| Memory archive | Structured JSON | All memory tiers (hot + warm + cold), with PII optionally masked or included |
| Workspace snapshot | tar.gz | Tools, skills, custom scripts, workspace files |
| Configuration | JSON + YAML | `openclaw.json` (secrets redacted), template config, cron definitions |
| Integration manifest | YAML | List of configured integrations, categories, provider details (credentials excluded) |
| Interaction history | JSON | Conversation logs (if retained), cron job history, tool execution audit trail |
| Build manifest | JSON | Image hashes, tool versions, upstream commit, build timestamps |

The export bundle is self-contained and documented. A `README.md` inside explains the bundle structure, how to import into a new ClawHQ deployment, and how to use the artifacts with raw OpenClaw if the user leaves ClawHQ entirely. Zero lock-in — this is a core principle.

**Pre-Decommission Checklist** — Before destroying anything:

1. Verify a current backup exists (prompt to create one if not)
2. Verify an export bundle has been created (prompt to create one if not)
3. List all known data locations (local filesystem, Docker volumes, agent-created repos, integration data)
4. Identify data that ClawHQ can destroy vs. data that requires manual cleanup (e.g., messages sent to Telegram contacts, repos pushed to GitHub, tasks created in Todoist)
5. Show a complete inventory of what will be destroyed and what will persist externally
6. Require explicit confirmation with deployment name typed out (no accidental destruction)

**Destruction Sequence:**

| Step | What's Destroyed | How | Verification |
|---|---|---|---|
| 1. Stop agent | Running container | `docker compose down` | Container no longer in `docker ps` |
| 2. Remove container data | Docker volumes, container filesystem | `docker volume rm`, `docker system prune` | Volumes no longer in `docker volume ls` |
| 3. Wipe workspace | `~/.openclaw/workspace/` | Secure overwrite + `rm -rf` | Directory doesn't exist |
| 4. Wipe config | `openclaw.json`, `cron/`, `identity/` | Secure overwrite + `rm -rf` | Files don't exist |
| 5. Wipe secrets | `.env`, `credentials/` | Secure overwrite + `rm -rf` | Files don't exist |
| 6. Remove images | Docker images (both stages) | `docker rmi` | Images not in `docker images` |
| 7. Remove networks | Agent Docker networks | `docker network rm` | Networks not in `docker network ls` |
| 8. Remove firewall | iptables chain | Flush + delete `CLAWHQ_FWD` | Chain not in `iptables -L` |
| 9. Remove ClawHQ config | `~/.clawhq/` | `rm -rf` | Directory doesn't exist |
| 10. Generate manifest | Cryptographic hash of destruction | SHA-256 of pre/post filesystem state | Manifest file (kept or printed) |

**Cryptographic Verification** — After destruction:
- Compute SHA-256 hashes of all directories/files that should no longer exist
- Scan for orphaned files matching known patterns (`.env*`, `openclaw*`, `*.key`, `*.pem`)
- Compare filesystem state against pre-destruction inventory
- Generate a signed destruction manifest proving what was removed and when
- Optionally: run a final PII/secrets scan to catch anything missed

**Partial Decommission** — Not every decommission is a full wipe:

- **Migration**: Export + destroy local, then `clawhq init --import <bundle>` on new infrastructure
- **Fresh start**: Export identity + memory, destroy everything, re-init with same identity but clean state
- **Template change**: Export, destroy, re-init with different template, import compatible artifacts

```bash
clawhq export                   # Create portable bundle
clawhq export --no-memory       # Export without memory (identity + config only)
clawhq export --mask-pii        # Export with PII masked
clawhq destroy                  # Full decommission with verification
clawhq destroy --dry-run        # Show what would be destroyed
clawhq destroy --keep-export    # Destroy but preserve the export bundle
clawhq destroy --verify         # Re-verify a previous destruction
```

---

## Architecture

### The Three Layers

The seven toolchains operate across three architectural layers:

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 1: CORE PLATFORM (same for every agent)          │
│  Config Safety · Security · Monitoring · Memory Mgmt    │
│  Cron Guardrails · Identity Governance · Audit Logging  │
│  Credential Health · Backup/Restore · Update Safety     │
│  Cost Tracking · Fleet Management · Access Control      │
├─────────────────────────────────────────────────────────┤
│  LAYER 2: TEMPLATES (operational profiles)              │
│  Guardian · Assistant · Coach · Analyst · Companion     │
│  Each: personality + security + monitoring + memory     │
│  + cron + autonomy + integration recommendations       │
├─────────────────────────────────────────────────────────┤
│  LAYER 3: INTEGRATIONS (providers per category)         │
│  Email · Calendar · Tasks · Messaging · Files · Code    │
│  Finance · Research · Notes · Health · CRM              │
└─────────────────────────────────────────────────────────┘
```

**Layer 1: Core Platform** — The engineering that makes any agent safe, observable, and maintainable. Same for every agent. This is the product. Every toolchain contributes to and draws from this layer.

**Layer 2: Templates** — Community-contributed operational profiles. The WordPress ecosystem model. Templates customize Layer 1 within safe bounds — they can tighten security but never loosen it below the platform baseline.

**Layer 3: Integrations** — Provider-agnostic tool categories. The agent talks to "calendar" not "Google Calendar." Each integration ships with: manifest, standard interface, health check, credential lifecycle, fallback behavior, version pinning.

| Category | Example Providers | Interface |
|---|---|---|
| **Email** | Gmail, iCloud, Outlook, Fastmail, ProtonMail | `email inbox`, `email send`, `email search` |
| **Calendar** | Google, iCloud, Outlook, Fastmail | `calendar today`, `calendar create` |
| **Tasks** | Todoist, TickTick, Linear, Notion, Asana | `tasks list`, `tasks add`, `tasks complete` |
| **Messaging** | Telegram, WhatsApp, Slack, Discord, Signal, iMessage, Teams, Matrix | Channel config |
| **Files** | Google Drive, Dropbox, iCloud Drive | `files list`, `files get` |
| **Code** | GitHub, GitLab, Sentry | `code repos`, `code issues`, `code prs` |
| **Finance** | Yahoo Finance, Alpha Vantage | `quote AAPL` |
| **Research** | Tavily, Perplexity | `research <query>` |
| **Notes** | Notion, Obsidian | `notes search`, `notes create` |
| **Health** | Garmin, Apple Health | `health log`, `health summary` |
| **CRM** | Salesforce, HubSpot | `crm contacts`, `crm deals` |

### Self-Operated

A single Go binary. All seven toolchains compiled in. No runtime dependencies except Docker.

```
clawhq (Go CLI)
├── plan/          — templates, questionnaire, config generation
├── build/         — source management, Docker builds
├── secure/        — hardening, firewall, scanning, credentials, audit
├── deploy/        — compose, networking, channels
├── operate/       — doctor, status, backup, update, logs
├── evolve/        — identity, memory, training, integration management
└── decommission/  — export, destroy, verify
```

### Managed

Same engine, hosted infrastructure, web console:

```
┌────────────────────────────────────────────┐
│          ClawHQ Console (web)           │
│  Onboarding · Dashboard · Fleet · Support │
│             WebSocket Hub                  │
└────────────────┬───────────────────────────┘
                 │
      ┌──────────┴──────────┐
      ▼                     ▼
┌───────────┐        ┌───────────┐
│ Node 1    │        │ Node N    │
│ agentd    │        │ agentd    │
│ OpenClaw  │ . . .  │ OpenClaw  │
│ Guardrails│        │ Guardrails│
│ Monitoring│        │ Monitoring│
└───────────┘        └───────────┘
```

**agentd** is the self-operated CLI running as a daemon. It receives config from the console, manages Docker lifecycle, applies all seven toolchains, streams operational metadata back. The console is a thin coordination layer — it never sees agent contents.

**Web Console** — The managed mode web console provides GUI access to all CLI capabilities:

- Visual config editor with validation, auto-backup, and gateway restart on save
- Model routing and tool policy management
- Skill browsing, installation, and management
- Cron scheduling with natural language or cron syntax
- Webhook configuration for external triggers (Gmail Pub/Sub, GitHub webhooks, custom HTTP)
- Environment variable management without SSH

**Access Control** (Managed mode) — Team collaboration with appropriate boundaries:

| Role | Capabilities |
|---|---|
| **Admin** | Full access: config, security, deploy, destroy, user management |
| **Operator** | Operational access: status, doctor, backup, restart, logs |
| **Viewer** | Read-only: status, logs, audit trail |

Authentication: username/password, TOTP MFA, OAuth SSO (Google, GitHub). Human-in-the-loop exec approvals for sensitive agent actions, configurable per template.

### Operational Boundary (Managed Mode)

| We CAN see | We CANNOT see |
|---|---|
| Container health (up/down/restarts) | Agent conversations |
| Integration status (healthy/degraded/failed) | Email, task, or calendar content |
| Memory tier sizes (45KB hot, 120KB warm) | Memory contents |
| API cost metrics | What the agent does with the calls |
| Cron job status (running/failed) | Cron job outputs |

Architecturally enforced. For the paranoid template: user-held encryption keys for at-rest workspace encryption.

---

## Data Sovereignty

Your agent holds the most intimate dataset about you that has ever existed. ClawHQ is designed so that data stays yours.

| Principle | How |
|---|---|
| **Workspace isolation** | Isolated infrastructure. We manage the container, not the contents. |
| **Identity integrity** | Identity files mounted read-only. Agent cannot modify its own guardrails. |
| **Portability** | `clawhq export` — portable bundle. Zero lock-in. Take it anywhere. |
| **Deletion** | `clawhq destroy` — cryptographic verification of complete wipe. |
| **Auditability** | Every tool execution logged. Full transparency into agent behavior. |
| **Open source** | Auditable engine. Verify every claim. |

---

## Competitive Positioning

### The Landscape

| Option | What You Get | What's Missing |
|---|---|---|
| **Raw OpenClaw** | Full power, full control | Months of setup, ongoing SRE, no lifecycle management |
| **Basic OpenClaw hosting** (10+ providers) | Someone runs the container | Default config, no hardening, no memory mgmt, no evolution |
| **Community dashboards** | Basic monitoring, read-only views | No security, no lifecycle, no configuration management |
| **Security point tools** (ClawSec, security-monitor) | Hardening guides, scanning | Fragmented, no unified platform, manual execution |
| **No-code agent builders** (Lindy, Relevance AI) | Workflow automation | Not true persistent agents, SaaS data handling |
| **Big-tech agents** (Google, Apple, MS) | Polished, integrated, easy | Platform lock-in, no sovereignty, black box |
| **ChatGPT / Claude** (direct) | Best models, growing memory | Platform-controlled, no customization, no operational layer |
| **ClawHQ** | **Full lifecycle across seven toolchains** | — |

### Market Gap Analysis

| Domain | Current Market Coverage | Gap Severity |
|---|---|---|
| Provisioning & Deploy | Well-served by 10+ hosting providers | Low |
| Security Hardening | Fragmented: guides + point tools; no unified self-serve platform | **Critical** |
| Monitoring & Observability | Partial: community dashboards cover basics; no unified cost + health + security | High |
| Agent Lifecycle | Weak: most dashboards are read-only, no full lifecycle management | High |
| Configuration Management | Very weak: built-in dashboard is minimal; most config requires CLI/JSON editing | **Critical** |
| Operations & Maintenance | Fragmented: updates manual, backups DIY, incident response is "read this blog post" | **Critical** |
| Governance & Compliance | Nearly nonexistent for self-hosted; no governance solution | **Critical** |

Four domains are critically underserved: Security, Configuration, Operations, and Governance. These are precisely the domains that differentiate a control panel from another deploy button.

### Where We Sit

```
Raw framework ←──────────────────────────────────→ Platform lock-in
OpenClaw         Basic hosting      CLAWHQ          Big-tech agents
(powerful,       (default config,   (control panel,     (polished,
 expert-only)    no lifecycle)      full lifecycle)     captive)
```

### What Nobody Else Does

1. **Full lifecycle in one product** — Plan → Build → Secure → Deploy → Operate → Evolve → Decommission. No one covers more than two of these today.
2. **Opinionated security defaults** — Instead of a checklist users must execute manually, ship pre-hardened and maintain hardened state continuously.
3. **Configuration-as-product** — Make OpenClaw's complex JSON config accessible through templates, validation, and visual editors with best-practice presets.
4. **Continuous compliance** — Not a one-time audit but ongoing drift detection, automated remediation, and exportable compliance reports.
5. **Operational intelligence** — Correlate cost spikes with agent behavior, security events with config changes, and performance issues with model routing decisions.

The market has settled into two camps: "deploy it fast" (hosting providers) and "secure it after" (security guides and tools). Nobody owns the middle — the ongoing operational reality of running OpenClaw as critical infrastructure. ClawHQ is the operational platform.

### The Moat

1. **Operational expertise** — 14+ landmines, hardening playbooks, identity governance, memory lifecycle, cron guardrails. Hard-won knowledge encoded as rules. Compounds with every user.
2. **Template ecosystem** — Community-built operational profiles. WordPress flywheel: more templates → more use cases → more users → more templates.
3. **Full lifecycle** — Seven toolchains from plan through decommission. Nobody else goes past deploy.
4. **Portability** — `clawhq export` gives you everything. Zero lock-in.
5. **Open source trust** — Auditable engine. Every claim verifiable.

---

## The Ecosystem

### Template Marketplace

Templates are the primary scaling mechanism — the WordPress model. Community extends the platform to domains we'd never design.

**Built-in templates** — ship with ClawHQ, deeply tested.

**Community templates** — contributed via PR, reviewed for safety. Can never override Layer 1 security baselines.

**Custom templates** — guided builder or raw YAML.

### Skill Library

Pre-built capabilities that templates include:

- **morning-brief** — daily briefing (tasks, calendar, priorities)
- **email-digest** — summarize and triage incoming email
- **meeting-prep** — research attendees, prep talking points
- **session-report** — work session ledger and time tracking
- **construct** — autonomous self-improvement (agent builds its own tools)

Open-source. Community-contributed. Reviewed for safety.

### Integration Catalog

Provider-specific implementations of category interfaces. Each ships with manifest, health check, credential lifecycle, fallback, version pinning.

---

## Strategy

### The cPanel Playbook

cPanel followed a specific path: first it was a tool sysadmins used to manage their own servers, then hosting companies licensed it for their customers, then it became the industry standard control panel. ClawHQ follows the same playbook.

**Phase 0: Concierge** — Manually set up 3-5 agents for real people. Deploy on VMs. Observe what they use, what breaks, what they ask for. We are the control panel — running it by hand. The service IS the research.

**Phase 1: Self-Install Panel (Operate + Secure + Deploy)** — The CLI you install on your own machine to manage your agent. `doctor`, `status`, `up`, `update`, `build`, `backup`, `scan`. One template (Guardian). Dogfood against the production prototype. Marketing screenshot: `clawhq doctor` catching real problems. This is cPanel-on-your-own-VPS.

**Phase 2: Full Panel (Plan + Evolve + Decommission)** — `init`, `template`, `evolve`, `train`, `export`, `destroy`. Full onboarding. Template system. Identity governance. Memory lifecycle. A technical friend goes from zero to working agent using only `clawhq`. This is the complete self-install product.

**Phase 3: Managed Hosting** — Web console, agentd, VM provisioning, billing. Non-technical users served. They never see a terminal. This is WordPress.com — same engine, hosted for you.

**Phase 4: Ecosystem** — Template marketplace, skill library, community contributions, integration catalog. The WordPress flywheel: more templates → more use cases → more users → more templates.

---

## The Foundation

Everything in ClawHQ was extracted from a production agent running for months:

| Discovery | Implication |
|---|---|
| 40% of config is universal, 60% is personalized | Config generator separates the two |
| 14 config landmines silently break agents | Every landmine is a rule — impossible to ship a broken config |
| Identity files corrupt, bloat, and go stale | Identity governance: structured YAML, token budgets, staleness detection |
| Memory accumulates at ~120KB/day | Memory lifecycle: hot/warm/cold tiers, auto-summarization, size caps |
| Credentials expire silently | Credential health: probes, expiry tracking, renewal notifications |
| Security is opt-in, defaults are dangerous | Security hardened by default — every template starts secure |
| Production agents need ongoing SRE | The entire platform exists because this is true |

---

## Open Questions

1. **Phase 0 candidates** — Who are the 3-5 people? What use cases determine initial template and integration priorities?
2. **Relationship with OpenClaw** — Inform? Partner? They might want lifecycle tooling upstream.
3. **Template quality gate** — Open marketplace vs. curated garden?
4. **Training pipeline** — What does `clawhq train` look like? Interaction logs → behavior refinement?
5. **Pricing** — Cost to run one managed agent? Price point? Needs Phase 0 data.
6. **Jurisdiction** — Incorporation location? VM locations? Matters for sovereignty segment.
7. **Encryption model** — User-held keys for at-rest encryption? Trust architecture?
8. **Team** — Service model is solo-friendly. Platform model may need co-founders.
9. **Multi-agent orchestration** — Sub-agent management, agent-to-agent delegation, shared memory. When does agent density justify designing the coordination protocol?

---

## Philosophy

Every powerful open-source engine eventually gets a control panel. Linux got cPanel. WordPress got WordPress.com. AWS got RightScale. Kubernetes got Rancher.

Personal AI agents are about to become as common as smartphones. OpenClaw is the most powerful open-source engine for building them. It needs a control panel.

**OpenClaw is the engine. ClawHQ is the panel.**
