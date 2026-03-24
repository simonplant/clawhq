# Contributing to ClawHQ

ClawHQ is an agent platform for OpenClaw that forges purpose-built agents from blueprints. There are three ways to contribute: **blueprints**, **skills**, and **code**.

---

## Blueprint Contribution Guide

A blueprint is a complete agent design — a YAML file that configures every dimension of an OpenClaw agent for a specific job. See `configs/blueprints/` for existing examples.

### Required Fields

Every blueprint YAML must include these top-level fields:

| Field | Type | Description |
|---|---|---|
| `name` | string | Human-readable blueprint name |
| `version` | string | Semantic version (e.g. `"1.0.0"`) |
| `use_case_mapping` | object | What the blueprint replaces, tagline, description, day-in-the-life narrative |
| `customization_questions` | array | 1–3 blueprint-specific setup questions (id, prompt, type, options/default) |
| `personality` | object | Tone, style, relationship, boundaries, and dimension scores (directness, warmth, verbosity, proactivity, caution, formality, analyticalDepth — each 1–5) |
| `security_posture` | object | `posture` (standard/hardened/paranoid), `egress` (allowlist-only), `egress_domains` list, `identity_mount: read-only` |
| `monitoring` | object | Heartbeat frequency, health checks, quiet hours, alert triggers |
| `memory_policy` | object | Hot/warm/cold retention limits and summarization strategy |
| `cron_config` | object | Heartbeat, work session, and skill-specific cron schedules |
| `autonomy_model` | object | Default autonomy level, list of actions requiring approval |
| `model_routing_strategy` | object | Default provider, local model preference, cloud escalation categories |
| `integration_requirements` | object | Required, recommended, and optional integrations |
| `channels` | object | Supported messaging channels and default |
| `skill_bundle` | object | Included and recommended skills |
| `toolbelt` | object | Role, description, tools array (name, category, required, description), skills array |

### Worked Example

Here is a condensed blueprint for a hypothetical "Home Automation" agent:

```yaml
name: Home Automation
version: "1.0.0"

use_case_mapping:
  replaces: Google Home / Alexa routines (cloud-dependent)
  tagline: "Smart home orchestration with full local control"
  description: >
    Purpose-built home automation agent. Monitors sensors, triggers
    routines, manages energy usage, and reports anomalies — all
    locally, no cloud dependency.
  day_in_the_life: >
    7:00am: "Morning routine activated. Lights on, thermostat to 72°F,
    coffee maker started. Weather today: 58°F, rain expected — garage
    door reminder set for 8am."

customization_questions:
  - id: home_platform
    prompt: "What smart home platform do you use?"
    type: select
    options:
      - "Home Assistant"
      - "OpenHAB"
      - "Hubitat"
  - id: energy_priority
    prompt: "How important is energy optimization?"
    type: select
    options:
      - "Not important — comfort first"
      - "Balanced — save energy without discomfort"
      - "Aggressive — minimize consumption always"

personality:
  tone: direct
  style: "concise, status-focused, proactive about anomalies"
  relationship: home operations manager
  boundaries: "never disarms security system without approval, never adjusts HVAC beyond user-set limits"
  dimensions:
    directness: 5
    warmth: 2
    verbosity: 1
    proactivity: 5
    caution: 4
    formality: 1
    analyticalDepth: 3

security_posture:
  posture: hardened
  egress: allowlist-only
  egress_domains:
    - homeassistant.local
    - api.weather.gov
  identity_mount: read-only

monitoring:
  heartbeat_frequency: "5min"
  checks:
    - home-assistant
  quiet_hours: "00:00-06:00"
  alert_on:
    - credential_expiry
    - integration_degraded
    - cron_failure

memory_policy:
  hot_max: "80KB"
  hot_retention: "7d"
  warm_retention: "90d"
  cold_retention: "365d"
  summarization: balanced

cron_config:
  heartbeat: "*/5 waking"
  work_session: "*/10 waking"
  morning_brief: "07:00"

autonomy_model:
  default: medium
  requires_approval:
    - security_changes
    - account_changes

model_routing_strategy:
  default_provider: local
  local_model_preference: "llama3:8b"
  cloud_escalation_categories: []
  quality_threshold: low

integration_requirements:
  required:
    - messaging
  recommended:
    - home-assistant
  optional:
    - weather

channels:
  supported:
    - telegram
    - signal
    - discord
  default: telegram

skill_bundle:
  included:
    - morning-brief
  recommended:
    - home-routine

toolbelt:
  role: "Home operations manager"
  description: "Smart home monitoring, routine automation, energy management"
  tools:
    - name: ha-api
      category: home
      required: true
      description: "Home Assistant API integration for device control and sensor monitoring"
    - name: tasks
      category: core
      required: true
      description: "Local work queue for automation task tracking"
  skills:
    - name: morning-brief
      required: true
      description: "Daily morning briefing — home status, weather, schedule"
```

### Testing Your Blueprint

Before submitting, validate your blueprint against the landmine validator:

1. Place your YAML in `configs/blueprints/`
2. Run `npm run build` to verify the blueprint loads without errors
3. Verify all `egress_domains` are legitimate and minimal — only domains your integrations actually need
4. Verify `security_posture.identity_mount` is set to `read-only`
5. Verify `customization_questions` has 1–3 focused questions (not more)

---

## Skill Contribution Guide

Skills are the agent's autonomous capabilities — declarative definitions that tell the agent what to do, when, and within what boundaries. A skill consists of three parts:

```
configs/skills/<skill-name>/
├── SKILL.md           # Behavior specification
├── config.yaml        # Machine-readable configuration
└── prompts/           # Step-specific prompt templates
    ├── step-one.md
    └── step-two.md
```

### SKILL.md Format

SKILL.md is the human-readable behavior specification. Follow this structure:

```markdown
# <skill-name>

One-paragraph description: what the skill does, for which blueprint, on what schedule.

## Behavior

Numbered step-by-step list of what the skill does at each execution:
1. Step one — what it reads/checks
2. Step two — what it processes
3. Step three — what it produces
4. Step four — how results are delivered or queued

## Boundaries

Bullet list of hard constraints:
- What the skill CANNOT do (no auto-send, no account changes, etc.)
- Data locality requirements (local-only, no cloud)
- Approval requirements

## Schedule

When and how often the skill runs.

## Execution

Explain that this is a declarative skill triggered by cron.
List the prompt templates in prompts/ and what each one does.

## Approval Integration

If approval is required: what category, what metadata is attached,
how the user reviews proposals.

## Model Requirements

Provider, minimum model, cloud escalation policy.
```

See `configs/skills/email-digest/SKILL.md` for a complete reference.

### config.yaml Schema

Every skill's `config.yaml` must follow this schema:

```yaml
name: skill-name              # Lowercase, hyphenated
version: "1.0.0"              # Semantic version
description: "One-line purpose"

schedule:
  cron: "*/15 * * * *"        # When to trigger (standard cron syntax)
  active_hours:
    start: 6                   # Earliest hour (24h format)
    end: 23                    # Latest hour (24h format)

model:
  provider: local              # "local" (Ollama) is always the default
  minimum: "llama3:8b"         # Minimum model capability
  cloud_escalation: false      # Whether cloud models are allowed

dependencies:
  tools:                       # Workspace tools this skill uses
    - email
    - calendar
  skills: []                   # Other skills this depends on

approval:
  required: true               # Whether actions need user consent
  category: send_email         # Approval queue category
  auto_approve: false          # Whether ops can auto-approve

boundaries:
  network_access: false        # Can the skill make external requests?
  file_write: false            # Can the skill write to workspace files?
  account_changes: false       # Can the skill modify account state?
  auto_send: false             # Can the skill send messages/emails?
```

All fields are required. See `configs/skills/email-digest/config.yaml` for a complete reference.

### Prompt Templates

Each step in the skill's behavior should have a corresponding prompt template in `prompts/`. Prompt templates:

- Are Markdown files with a heading, context section, input/output specification, and rules
- Define the exact input format the model receives and the exact output format expected (typically JSON)
- Include explicit rules the model must follow
- Must not include instructions that would violate the skill's boundary flags

See `configs/skills/email-digest/prompts/categorize.md` for a complete reference.

### Boundary Enforcement Rules

Boundaries are **architectural, not advisory**. Each flag in `config.yaml` maps to a runtime constraint:

| Flag | What It Blocks |
|---|---|
| `network_access: false` | External API calls blocked by egress firewall per-skill rules |
| `auto_send: false` | Any send action intercepted and routed to approval queue |
| `file_write: false` | Workspace file modifications blocked — read-only access only |
| `account_changes: false` | Account state modifications blocked (archive, delete, move) |

**Rules for contributors:**

1. **Default to `false` for all boundary flags.** Only set a flag to `true` if the skill genuinely requires that capability.
2. **Boundaries in SKILL.md must match config.yaml.** If SKILL.md says "no auto-send", `auto_send` must be `false` in config.yaml.
3. **Prompt templates must not instruct the model to bypass boundaries.** A prompt that tells the model to send an email in a skill with `auto_send: false` is invalid.
4. **Approval is required for any skill that produces externally-visible actions** (sending emails, modifying calendar events, posting messages).

---

## Code Contribution Guide

### TypeScript Conventions

- TypeScript strict mode, ESM modules
- Matches OpenClaw's Node.js/TypeBox stack — shares schema types directly
- Single npm package with module boundaries via barrel exports and directory structure (AD-04)
- Tight coupling to OpenClaw — no abstraction layers over TypeBox schema, WebSocket RPC, or file paths (AD-03)

### Branch Strategy

- Feature branches off `main`
- Branch naming: `<type>/<description>` (e.g. `feat/home-automation-blueprint`, `fix/cron-validation`)
- One focused change per branch

### PR Process

1. Create a feature branch from `main`
2. Make your changes, following existing code patterns
3. Run `npm run build && npm test` — all checks must pass
4. Submit a PR with a clear description of what changed and why
5. Reference any related backlog items if applicable

### Testing Requirements

- Run `npm run build` to verify TypeScript compilation
- Run `npm test` to run the test suite
- New code should include tests where the existing codebase has test coverage for similar functionality

---

## What's Needed

High-impact contributions we're actively looking for:

### Blueprints

We need blueprints for use cases people actually want to replace:

- **Home Automation** — replace Google Home / Alexa routines with local-first smart home orchestration
- **Stock Trading Assistant** — market monitoring, research digests, portfolio alerts, risk guardrails
- **Content Creator** — social media scheduling, content calendar, engagement tracking, draft approval
- **Personal Finance** — expense categorization, budget alerts, bill reminders, investment summaries
- **Health & Fitness** — workout tracking, nutrition logging, health metrics, appointment reminders
- **Student Assistant** — assignment tracking, study schedules, research organization, deadline alerts
- **Customer Support** — ticket triage, response drafting, escalation routing, satisfaction tracking

### Skills

Skills that would unlock new autonomous capabilities:

- **auto-reply** — autonomous email responses in user's voice with approval gates
- **calendar-sync** — cross-calendar conflict detection and resolution
- **research-digest** — periodic web research compilation on configured topics
- **home-routine** — smart home routine automation and anomaly detection
- **expense-tracker** — receipt parsing and expense categorization

### Tooling

Developer experience improvements:

- Blueprint validation CLI tool — validate YAML schema before submission
- Skill scaffolding generator — `clawhq skill scaffold <name>` to generate the directory structure
- Integration test harness for skills — simulate cron triggers and verify output formats

---

## Architectural Constraints

All contributions must respect the five architectural decisions documented in `docs/ARCHITECTURE.md`:

- **AD-01: One binary, flat CLI** — Modules (`design`, `build`, `secure`, `operate`, `evolve`, `cloud`) are internal source organization only. Users see flat commands like `clawhq doctor`, never `clawhq operate doctor`.
- **AD-02: Unix philosophy in agent tools, not in ClawHQ** — Workspace tools (`email`, `calendar`, `tasks`, `quote`) are small and composable. Blueprints compose them. ClawHQ is the orchestrator.
- **AD-03: Tight coupling to OpenClaw** — No abstraction layers. Use TypeBox schema, WebSocket RPC, and file paths directly.
- **AD-04: TypeScript monorepo, single package** — One npm package. Module boundaries via barrel exports and directory structure.
- **AD-05: Security is architecture, not policy** — Content access in managed mode is architecturally blocked (no code path exists), not policy-blocked.

---

## Security Requirements

Contributed skills must meet these security requirements:

1. **Default to local models.** Set `model.provider: local` and `model.cloud_escalation: false` unless cloud is genuinely required for quality. Users opted for sovereignty — respect that.

2. **Minimize egress.** Skills should not require `network_access: true` unless they interact with an external service. If network access is needed, the blueprint's `egress_domains` allowlist controls which domains are reachable — the egress firewall (`CLAWHQ_FWD` iptables chain) blocks everything else.

3. **Never auto-send without approval.** Any skill that sends data externally (emails, messages, API calls with side effects) must set `approval.required: true` and `boundaries.auto_send: false`.

4. **No credential exposure.** Skills must never log, store, or include credentials in prompt templates. Credentials live in `credentials.json` (mode 0600) and `.env` (mode 0600), never in config files or workspace files.

5. **Identity files are read-only.** Contributed skills cannot modify agent identity files (SOUL.md, AGENTS.md, IDENTITY.md). These are mounted read-only at runtime.

6. **Prompt templates must not bypass boundaries.** A prompt that instructs the model to send an email in a skill with `auto_send: false` is rejected. Prompt intent must align with config.yaml boundary flags.

7. **Declare all tool dependencies.** Every workspace tool a skill uses must be listed in `dependencies.tools`. Undeclared tool usage is a security violation.
