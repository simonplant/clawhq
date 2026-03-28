# ClawHQ Configuration Reference

> The single reference for writing custom blueprints, skills, and configuring every dimension of a ClawHQ agent.

**Updated:** 2026-03-24

---

## Table of Contents

1. [Blueprint Schema](#blueprint-schema)
2. [Skill Schema](#skill-schema)
3. [SKILL.md Authoring Format](#skillmd-authoring-format)
4. [The 14 Landmine Rules](#the-14-landmine-rules)
5. [Model Routing](#model-routing)
6. [Integration Patterns](#integration-patterns)
7. [Generated Directory Structure](#generated-directory-structure)

---

## Blueprint Schema

A blueprint is a YAML file that defines a complete agent design. During setup, ClawHQ forges a personalized agent from the blueprint — generating config, identity, tools, skills, cron, and security rules. Blueprint files live in `configs/blueprints/`.

### Top-Level Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | Yes | — | Display name of the blueprint (e.g., `"Email Manager"`) |
| `version` | string | Yes | — | Semantic version (e.g., `"1.0.0"`) |

### `use_case_mapping`

Describes what the blueprint replaces and why a user would choose it.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `use_case_mapping.replaces` | string | Yes | — | Product or workflow this blueprint replaces (e.g., `"Gmail / Outlook / Apple Mail"`) |
| `use_case_mapping.tagline` | string | Yes | — | One-line description shown during blueprint selection |
| `use_case_mapping.description` | string | Yes | — | Multi-line description of the blueprint's purpose and capabilities |
| `use_case_mapping.day_in_the_life` | string | Yes | — | Narrative describing a typical day using this agent — used to generate SOUL.md context |

### `customization_questions[]`

Blueprint-specific questions asked during `clawhq init`. Each blueprint defines 1-4 questions.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `customization_questions[].id` | string | Yes | — | Unique identifier for the question (e.g., `"communication_style"`) |
| `customization_questions[].prompt` | string | Yes | — | User-facing question text |
| `customization_questions[].type` | enum | Yes | — | `"input"` (free text) or `"select"` (pick from options) |
| `customization_questions[].options[]` | string[] | Conditional | — | Required when `type` is `"select"`. Array of option strings. |
| `customization_questions[].default` | string | Optional | `""` | Default value for `"input"` type questions |

### `personality`

Defines the agent's character, tone, and behavioral boundaries. Used to generate SOUL.md.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `personality.tone` | string | Yes | — | Primary tone keyword (e.g., `"direct"`, `"analytical"`, `"warm"`) |
| `personality.style` | string | Yes | — | Multi-part style description (e.g., `"concise, technical, no-nonsense"`) |
| `personality.relationship` | string | Yes | — | Role the agent plays (e.g., `"email operations manager"`, `"research partner"`) |
| `personality.boundaries` | string | Yes | — | Ethical and operational boundaries statement |

#### `personality.dimensions`

Seven-dimensional personality model. Each dimension is an integer on a 1-5 scale.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `personality.dimensions.directness` | integer (1-5) | Yes | — | How blunt vs. diplomatic the agent is |
| `personality.dimensions.warmth` | integer (1-5) | Yes | — | How friendly vs. clinical the agent's tone is |
| `personality.dimensions.verbosity` | integer (1-5) | Yes | — | How much detail the agent provides (1 = terse, 5 = thorough) |
| `personality.dimensions.proactivity` | integer (1-5) | Yes | — | How often the agent acts without being asked |
| `personality.dimensions.caution` | integer (1-5) | Yes | — | How risk-averse the agent is |
| `personality.dimensions.formality` | integer (1-5) | Yes | — | How formal vs. casual the agent communicates |
| `personality.dimensions.analyticalDepth` | integer (1-5) | Yes | — | How deeply the agent analyzes before responding |

#### Planned: Capabilities and Personas

> **Status: Design only.** The fields below (`capabilities[]`, `persona`) do not exist in the current schema. The current schema uses `toolbelt.tools[]`, `skill_bundle.included[]`, and `personality.dimensions` directly. This section documents the planned compiler catalog. See `docs/ARCHITECTURE.md` § "Compile-Time vs. Runtime" for the full model.

Personality composition is a compile-time problem. OpenClaw never sees capabilities or personas — it gets flat, resolved config. These are ClawHQ compiler concepts.

**Capability** — What the agent can do. A named tool+skill+integration bundle with operational doctrine:

```typescript
interface Capability {
  id: string                    // "inbox-manager"
  name: string                  // "Inbox Manager"
  description: string           // one-line description
  tools: string[]               // ["fm", "email", "contacts"]
  skills: string[]              // ["scanner-triage"]
  integrations: string[]        // ["fastmail", "icloud"]
  soul_fragments: string[]      // prose injected into SOUL.md — operational
                                // doctrine for this domain, NOT personality
  suggested_crons: CronDef[]    // defaults, user can override
}
```

Capability does NOT carry personality or autonomy. Those are agent-level concerns. `soul_fragments` is domain-specific behavioral guidance (e.g., a trader capability's fragment: "singles mentality, never execute trades directly"), not personality style.

**Persona** — How the agent talks. A curated prose bundle, not an MBTI code:

```typescript
interface Persona {
  id: string                    // "stoic-operator"
  name: string                  // "Stoic Operator"
  description: string
  soul_template: string         // SOUL.md skeleton with {{slots}} for capability fragments
  voice_examples: string[]      // 3-5 concrete example responses showing tone
  dimensions: Dimensions        // the 7 slider defaults
  anti_patterns: string[]       // "never use exclamation marks"
}
```

ClawHQ ships 8-12 curated personas. Users can also start blank and write their own SOUL.md — the persona is a starting point, not a constraint. `voice_examples` are the key differentiator from abstract sliders: concrete samples of how this persona actually responds.

**Blueprint with catalog references:**

```yaml
# Planned schema — not yet implemented
persona: stoic-operator
capabilities:
  - inbox-manager
  - trader
  - meal-planner
extra_tools: [weather]          # escape hatch, outside any capability
dimension_overrides:
  warmth: 3                     # fine-tune persona defaults
soul_overrides: |               # free-text appended to SOUL.md
  Always greet with the user's name.
```

**Compile step:** persona.soul_template + capability.soul_fragments → assembled SOUL.md → dimension overrides applied → flat runtime config emitted. No intermediate concepts survive into `config.yaml` or `SOUL.md`.

### `security_posture`

Controls container hardening, egress filtering, and identity file protection.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `security_posture.posture` | enum | Yes | — | `"standard"`, `"hardened"`, or `"paranoid"` — maps to container hardening level |
| `security_posture.egress` | enum | Yes | — | `"allowlist-only"` (strict domain filter) or `"restricted"` (HTTPS only) |
| `security_posture.egress_domains[]` | string[] | Yes | — | Domains the agent is allowed to reach (e.g., `"imap.gmail.com"`, `"api.todoist.com"`) |
| `security_posture.identity_mount` | enum | Yes | — | `"read-only"` — identity files are mounted read-only to prevent self-modification |

### `monitoring`

Configures health monitoring and alerting behavior.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `monitoring.heartbeat_frequency` | string | Yes | — | How often the agent checks in (e.g., `"10min"`, `"30min"`, `"60min"`) |
| `monitoring.checks[]` | string[] | Yes | — | Categories to monitor (e.g., `"email"`, `"calendar"`, `"research"`) |
| `monitoring.quiet_hours` | string | Yes | — | Time range when monitoring is suppressed, format `HH:MM-HH:MM` (e.g., `"23:00-06:00"`) |
| `monitoring.alert_on[]` | string[] | Yes | — | Conditions that trigger alerts (e.g., `"credential_expiry"`, `"memory_bloat"`, `"skill_failure"`) |

### `memory_policy`

Controls the three-tier memory system: hot (recent), warm (summarized), cold (archived).

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `memory_policy.hot_max` | string | Yes | — | Maximum hot memory size (e.g., `"100KB"`, `"200KB"`) |
| `memory_policy.hot_retention` | string | Yes | — | How long hot memory is kept before summarization (e.g., `"7d"`, `"14d"`, `"30d"`) |
| `memory_policy.warm_retention` | string | Yes | — | How long warm (summarized) memory is kept (e.g., `"60d"`, `"90d"`, `"180d"`) |
| `memory_policy.cold_retention` | string | Yes | — | How long cold (archived) memory is kept (e.g., `"180d"`, `"365d"`, `"730d"`) |
| `memory_policy.summarization` | enum | Yes | — | Summarization aggressiveness: `"aggressive"`, `"balanced"`, or `"conservative"` |

### `cron_config`

Defines the agent's scheduled jobs. Values are cron expressions or time strings. An empty string `""` disables the job.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `cron_config.heartbeat` | string | Yes | — | Heartbeat cron expression, supports `"waking"` keyword to respect active hours (e.g., `"*/10 waking"`) |
| `cron_config.work_session` | string | Yes | — | Work session trigger, cron expression or `""` to disable |
| `cron_config.morning_brief` | string | Yes | — | Morning briefing time (e.g., `"08:00"`, `"06:30"`) or `""` to disable |

### `autonomy_model`

Controls what the agent does independently vs. what requires user approval.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `autonomy_model.default` | enum | Yes | — | Baseline autonomy level: `"low"`, `"medium"`, or `"high"` |
| `autonomy_model.requires_approval[]` | string[] | Yes | — | Actions that always require explicit user approval (e.g., `"sending_messages"`, `"calendar_changes"`, `"large_purchases"`) |

### `model_routing_strategy`

Controls which models handle which tasks — local-first by default, with optional cloud escalation.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `model_routing_strategy.default_provider` | enum | Yes | — | `"local"` (Ollama) or `"cloud"` — local is always the recommended default |
| `model_routing_strategy.local_model_preference` | string | Yes | — | Preferred local model (e.g., `"llama3:8b"`, `"llama3:70b"`) |
| `model_routing_strategy.cloud_escalation_categories[]` | string[] | Yes | — | Task categories that may escalate to cloud (e.g., `"deep_research"`, `"long_form_writing"`, `"complex_analysis"`) |
| `model_routing_strategy.quality_threshold` | enum | Yes | — | When to escalate: `"low"` (rarely), `"medium"` (when local struggles), `"high"` (eagerly) |

### `integration_requirements`

Declares which integrations the blueprint needs, organized by priority.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `integration_requirements.required[]` | string[] | Yes | — | Integrations the blueprint cannot function without (e.g., `"messaging"`, `"email"`) |
| `integration_requirements.recommended[]` | string[] | Yes | — | Integrations that significantly improve the agent (e.g., `"calendar"`, `"web_search"`) |
| `integration_requirements.optional[]` | string[] | Yes | — | Integrations for additional capabilities (e.g., `"todoist"`, `"finance_api"`) |

### `channels`

Configures which messaging platforms the agent supports.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `channels.supported[]` | string[] | Yes | — | Platforms the blueprint supports (e.g., `"telegram"`, `"slack"`, `"discord"`, `"whatsapp"`, `"signal"`) |
| `channels.default` | string | Yes | — | Default messaging platform (e.g., `"telegram"`) |

### `skill_bundle`

Declares which skills are included with and recommended for the blueprint.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `skill_bundle.included[]` | string[] | Yes | — | Skills installed by default (e.g., `"email-digest"`, `"morning-brief"`) |
| `skill_bundle.recommended[]` | string[] | Yes | — | Skills suggested during setup (e.g., `"schedule-guard"`, `"auto-reply"`) |

### `toolbelt`

Defines the agent's workspace tools and skills — what the agent can do.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `toolbelt.role` | string | Yes | — | Role description for the agent's capabilities |
| `toolbelt.description` | string | Yes | — | Summary of the agent's operational capabilities |

#### `toolbelt.tools[]`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `toolbelt.tools[].name` | string | Yes | — | Tool identifier (e.g., `"email"`, `"calendar"`, `"quote"`) |
| `toolbelt.tools[].category` | string | Yes | — | Classification (e.g., `"communication"`, `"productivity"`, `"research"`) |
| `toolbelt.tools[].required` | boolean | Yes | — | Whether the tool is required (`true`) or optional (`false`) |
| `toolbelt.tools[].description` | string | Yes | — | What the tool does |

#### `toolbelt.skills[]`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `toolbelt.skills[].name` | string | Yes | — | Skill identifier (e.g., `"email-digest"`, `"morning-brief"`) |
| `toolbelt.skills[].required` | boolean | Yes | — | Whether the skill is required (`true`) or optional (`false`) |
| `toolbelt.skills[].description` | string | Yes | — | What the skill does autonomously |

### Example Blueprint (Minimal)

```yaml
name: "My Custom Agent"
version: "1.0.0"

use_case_mapping:
  replaces: "Manual task management"
  tagline: "Autonomous task triage and daily planning"
  description: "Manages your task list, prioritizes daily work, and sends a morning plan."
  day_in_the_life: "You wake up to a prioritized task list with time estimates..."

customization_questions:
  - id: "work_style"
    prompt: "How do you prefer to work?"
    type: select
    options: ["Deep focus blocks", "Frequent context switching", "Mixed"]

personality:
  tone: "direct"
  style: "concise, action-oriented"
  relationship: "productivity assistant"
  boundaries: "Never modify files without approval. Never send messages autonomously."
  dimensions:
    directness: 4
    warmth: 3
    verbosity: 2
    proactivity: 4
    caution: 3
    formality: 2
    analyticalDepth: 3

security_posture:
  posture: hardened
  egress: allowlist-only
  egress_domains:
    - "api.todoist.com"
    - "smtp.gmail.com"
  identity_mount: read-only

monitoring:
  heartbeat_frequency: "30min"
  checks: ["tasks", "calendar"]
  quiet_hours: "23:00-06:00"
  alert_on: ["credential_expiry", "skill_failure"]

memory_policy:
  hot_max: "100KB"
  hot_retention: "14d"
  warm_retention: "90d"
  cold_retention: "365d"
  summarization: balanced

cron_config:
  heartbeat: "*/30 waking"
  work_session: ""
  morning_brief: "07:30"

autonomy_model:
  default: medium
  requires_approval:
    - sending_messages
    - calendar_changes

model_routing_strategy:
  default_provider: local
  local_model_preference: "llama3:8b"
  cloud_escalation_categories:
    - deep_research
  quality_threshold: medium

integration_requirements:
  required: ["messaging"]
  recommended: ["calendar", "todoist"]
  optional: ["web_search"]

channels:
  supported: ["telegram", "discord"]
  default: "telegram"

skill_bundle:
  included: ["morning-brief"]
  recommended: ["schedule-guard"]

toolbelt:
  role: "Task management assistant"
  description: "Manages tasks, calendar, and daily planning"
  tools:
    - name: tasks
      category: productivity
      required: true
      description: "Task list management via Todoist API"
    - name: calendar
      category: productivity
      required: false
      description: "Calendar access via CalDAV"
  skills:
    - name: morning-brief
      required: true
      description: "Daily morning briefing with prioritized task list"
```

---

## Skill Schema

A skill is a declarative capability definition — not code. It consists of two files in `configs/skills/<skill-name>/`:

- **`config.yaml`** — Machine-readable configuration: schedule, model, dependencies, approval, boundaries.
- **`SKILL.md`** — Human-readable behavior specification: what the skill does step-by-step.

### config.yaml Fields

#### Top-Level

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | Yes | — | Skill identifier, matches the directory name (e.g., `"email-digest"`) |
| `version` | string | Yes | — | Semantic version (e.g., `"1.0.0"`) |
| `description` | string | Yes | — | One-line description of the skill's purpose |

#### `schedule`

Controls when the skill triggers.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `schedule.cron` | string | Yes | — | Standard 5-field cron expression (e.g., `"*/15 * * * *"` for every 15 minutes, `"0 8 * * *"` for daily at 8am). **Avoid stepping syntax like `5/15`** — use `3-58/15` instead (see LM-09). |
| `schedule.active_hours.start` | integer | Yes | — | Earliest hour the skill can run (0-23, 24-hour format) |
| `schedule.active_hours.end` | integer | Yes | — | Latest hour the skill can run (0-23, 24-hour format) |

#### `model`

Specifies model requirements for skill execution.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `model.provider` | enum | Yes | — | `"local"` (Ollama) or `"cloud"` — local is always the default |
| `model.minimum` | string | Yes | — | Minimum model capability (e.g., `"llama3:8b"`) |
| `model.cloud_escalation` | boolean | Yes | — | Whether the skill may escalate to cloud models for quality. `false` = local-only. |

#### `dependencies`

Declares what tools and other skills this skill requires.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `dependencies.tools[]` | string[] | Yes | — | Workspace tools the skill uses (e.g., `["email", "calendar"]`). Must be installed in the agent's toolbelt. |
| `dependencies.skills[]` | string[] | Yes | `[]` | Other skills this skill depends on. Typically empty. |

#### `approval`

Controls whether skill actions require user consent before execution.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `approval.required` | boolean | Yes | — | Whether proposed actions are queued for user review |
| `approval.category` | string | Yes | — | Approval queue category (e.g., `"send_email"`, `"notification"`, `"calendar_change"`, `"meal_plan"`) |
| `approval.auto_approve` | boolean | Yes | — | Whether ops can auto-approve. Typically `false` when `required` is `true`. |

#### `boundaries`

Architectural constraints enforced at runtime — not advisory. Each flag maps to a hard runtime restriction.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `boundaries.network_access` | boolean | Yes | — | Can the skill make external API requests? If `false`, external calls are blocked by the egress firewall's per-skill rules. |
| `boundaries.file_write` | boolean | Yes | — | Can the skill write to workspace files? If `false`, the skill has read-only access. |
| `boundaries.account_changes` | boolean | Yes | — | Can the skill modify account state (archive emails, delete events, move folders)? |
| `boundaries.auto_send` | boolean | Yes | — | Can the skill send messages or emails? If `false`, send actions are intercepted and routed to the approval queue. |

### Example config.yaml

```yaml
name: email-digest
version: "1.0.0"
description: "Inbox triage — categorize emails, draft responses, surface urgent items"

schedule:
  cron: "*/15 * * * *"
  active_hours:
    start: 6
    end: 23

model:
  provider: local
  minimum: "llama3:8b"
  cloud_escalation: true

dependencies:
  tools:
    - email
    - calendar
  skills: []

approval:
  required: true
  category: send_email
  auto_approve: false

boundaries:
  network_access: true
  file_write: true
  account_changes: false
  auto_send: false
```

---

## SKILL.md Authoring Format

SKILL.md is a Markdown file that describes the skill's behavior in human-readable form. The agent reads this file at runtime and follows the steps using its existing tools. SKILL.md files live alongside config.yaml in the skill directory.

### Required Sections

| Section | Format | Description |
|---------|--------|-------------|
| **Title** (H1) | `# Skill Name` | Skill name as a top-level heading |
| **Intro paragraph** | Plain text | 1-2 sentences describing the skill's purpose and when it runs |
| **## Behavior** | Numbered list | Step-by-step execution flow (4-6 steps). Each step describes one action the agent takes. |
| **## Boundaries** | Bullet list | 3-5 constraints the skill must respect (maps to config.yaml boundaries) |
| **## Schedule** | Plain text | Describes when and how often the skill runs, and what triggers it |
| **## Execution** | Plain text | Explains that this is a declarative skill — the agent follows these instructions using its tools |
| **### Prompts** | File list | Lists prompt template paths in `prompts/` directory used by each step |
| **## Model Requirements** | Bullet list | Provider, minimum model, and cloud escalation policy |

### Conditional Sections

| Section | When to Include | Description |
|---------|----------------|-------------|
| **## Approval Integration** | When `approval.required: true` | Describes the approval category, what metadata is attached, and how actions are queued for user review |

### Example SKILL.md

```markdown
# Email Digest

Triages your inbox every 15 minutes during waking hours. Categorizes emails by
urgency, drafts responses for routine items, and surfaces anything that needs
your attention.

## Behavior

1. **Fetch unread emails** — Use the `email` tool to retrieve all unread messages
   since the last run.
2. **Categorize by urgency** — Sort each email into: urgent (needs reply today),
   routine (can batch), informational (read-only), or spam.
3. **Check calendar context** — Use the `calendar` tool to see today's schedule.
   Flag emails from people you're meeting today.
4. **Draft responses** — For routine emails, draft concise responses matching the
   user's communication style.
5. **Compose digest** — Summarize urgent items at the top, routine drafts in the
   middle, informational at the bottom.
6. **Queue for approval** — Send drafted responses to the approval queue. Deliver
   the digest summary to the user's messaging channel.

## Boundaries

- Never send emails without user approval (auto_send: false)
- Never archive, delete, or move emails (account_changes: false)
- Network access is required to fetch emails (network_access: true)
- May write categorization notes to workspace (file_write: true)

## Schedule

Runs every 15 minutes during active hours (6am-11pm). Constrained by
`schedule.active_hours` — will not fire outside the configured window.

## Execution

This is a declarative skill. The agent reads these instructions and executes
each step using its workspace tools. The cron scheduler triggers the skill;
the agent follows the behavior steps in order.

### Prompts

- `prompts/categorize.md` — Email urgency categorization
- `prompts/draft-response.md` — Response drafting with style matching
- `prompts/digest-summary.md` — Digest composition and formatting

## Approval Integration

Category: `send_email`

All drafted responses are queued with:
- Subject line and recipient
- Draft text
- Urgency category
- Original email snippet for context

The user reviews and approves each draft via their messaging channel.

## Model Requirements

- **Provider:** local (Ollama)
- **Minimum:** llama3:8b
- **Cloud escalation:** Allowed for complex categorization or nuanced drafting
```

---

## The 14 Landmine Rules

Every config forged by ClawHQ passes these 14 validation rules. Each rule prevents a silent failure mode discovered in production — no error messages, no warnings, just a broken agent. The config generator (`src/design/configure/generate.ts`) prevents all 14 by construction. The validator (`src/config/validate.ts`) enforces them continuously.

| # | Rule | What Goes Wrong Without It | Safe Default ClawHQ Enforces |
|---|------|---------------------------|------------------------------|
| **LM-01** | `dangerouslyDisableDeviceAuth: true` must be set | Device signature invalid loop — agent becomes inaccessible. The Gateway requires device authentication by default; inside a Docker container with no persistent device identity, this causes an infinite rejection loop. | Set to `true` in every forged `openclaw.json` |
| **LM-02** | `allowedOrigins` must include the expected origin | Control UI returns CORS errors — can't manage the agent via the web interface. OpenClaw's onboard wizard can strip this field during config rewrites. | Array populated with the correct origin during config generation; validated on every doctor run |
| **LM-03** | `trustedProxies` must include Docker bridge gateway IP | Gateway rejects all requests that pass through Docker's NAT. Requests from the host appear to come from the Docker bridge IP, which must be trusted. | Docker bridge gateway IP (typically `172.17.0.1`) added automatically |
| **LM-04** | `tools.exec.host` must be `"gateway"` | Setting to `"node"` fails (no companion app in container), `"sandbox"` fails (no Docker-in-Docker). Tool execution becomes silently unavailable. | Set to `"gateway"` in every forged config |
| **LM-05** | `tools.exec.security` must be `"full"` | Tool execution silently restricted — the agent appears to have tools but they don't work. Other values impose restrictions that break expected behavior. | Set to `"full"` in every forged config |
| **LM-06** | Container user must be UID 1000 | Permission errors on mounted volumes. OpenClaw runs as UID 1000 inside the container; mismatched ownership causes silent read/write failures. | `user: "1000:1000"` in generated `docker-compose.yml` |
| **LM-07** | ICC must be disabled on the agent network | Containers on the same Docker network can communicate — a security breach. If another container is compromised, it can reach the agent. | Docker network created with ICC disabled; verified by doctor |
| **LM-08** | Identity files must not exceed `bootstrapMaxChars` | Files over 20,000 characters are silently truncated — the agent loses personality context, boundaries, or operating procedures without any warning. | Token budget enforcement during identity file generation (default: 20,000 chars per file, 150,000 chars aggregate) |
| **LM-09** | Cron expressions must use valid stepping syntax | `5/15` is invalid cron syntax — must be `3-58/15`. Invalid expressions cause jobs to silently not run. No error, no warning, just missed schedules. | Regex validation on all cron expressions during generation |
| **LM-10** | External Docker networks must be pre-created | `docker compose up` fails if referenced external networks don't exist. The error message is cryptic and doesn't point to the actual cause. | Networks created before compose; verified by preflight checks |
| **LM-11** | `.env` must contain all required variables | Container starts successfully but integrations silently fail. Missing API keys or tokens cause tools to return empty results with no error indication. | Cross-reference of compose env vars against `.env` during generation; doctor validates continuously |
| **LM-12** | Config and credentials must be read-only mounts | Without read-only mount flags, the agent can modify its own `openclaw.json` or `credentials.json` — a self-modification vector that can bypass security constraints. | Volume mount flags set to `ro` for config and credentials in generated `docker-compose.yml` |
| **LM-13** | Firewall must be reapplied after network recreate | After every `docker compose down`, Docker destroys and recreates the bridge interface, invalidating the `CLAWHQ_FWD` iptables chain. The agent runs without egress filtering until manually reapplied. | Automatic firewall reapplication in the deploy toolchain; doctor verifies chain exists |
| **LM-14** | `fs.workspaceOnly` must match the security posture | Too restrictive: agent can't read media files or tool outputs. Too permissive: agent can read the host filesystem outside its workspace. | Value set to match the blueprint's `security_posture.posture` level |

---

## Model Routing

ClawHQ uses a local-first model routing strategy. Local models (Ollama) handle all tasks by default. Cloud models are opt-in, per-task-category.

### How It Works

1. **Default provider** — Set in the blueprint's `model_routing_strategy.default_provider`. Always `"local"` unless the blueprint explicitly requires cloud.
2. **Local model preference** — The preferred Ollama model (e.g., `"llama3:8b"`, `"llama3:70b"`). ClawHQ detects available Ollama models during `clawhq init` and recommends routing.
3. **Cloud escalation** — Specific task categories can escalate to cloud when local models struggle. Controlled per-blueprint via `cloud_escalation_categories[]` and per-skill via `model.cloud_escalation`.
4. **Quality threshold** — Controls escalation sensitivity: `"low"` (rarely escalate), `"medium"` (escalate when local quality is insufficient), `"high"` (eagerly use cloud).

### Per-Skill Model Configuration

Each skill has its own model block in `config.yaml`:

```yaml
model:
  provider: local           # Default to local
  minimum: "llama3:8b"      # Minimum capable model
  cloud_escalation: false   # true = cloud allowed for this skill
```

Skills with `cloud_escalation: false` will never use cloud models regardless of the blueprint's routing strategy. This ensures sensitive skills (e.g., email processing) stay local.

### OpenClaw Provider Configuration

At the `openclaw.json` level, model routing is configured as:

- **`agents.defaults.model.primary`** — The default model for all agent tasks
- **`agents.defaults.model.fallbacks`** — Fallback chain if the primary is unavailable
- **`models.providers.<name>.apiKey`** — API keys for cloud providers (stored via SecretRef)

Built-in providers: `anthropic`, `openai`, `google`, `deepseek`, `mistral`, `openrouter`, `xai`, `minimax`, `ollama`.

---

## Integration Patterns

Integrations connect the agent to external services. Each integration produces credentials, egress domains, and tool configurations.

### Email (IMAP/SMTP)

Required credentials:
- **IMAP host** — e.g., `imap.gmail.com`
- **SMTP host** — e.g., `smtp.gmail.com`
- **Username** — email address
- **Password** — app-specific password (Gmail requires App Passwords with 2FA enabled; regular passwords are rejected)

Egress domains added: IMAP host, SMTP host.

Generated tool: `email` — CLI wrapper for reading, searching, and sending email via Himalaya.

### Calendar (CalDAV)

Required credentials:
- **CalDAV URL** — e.g., `https://caldav.icloud.com`
- **Username** — account identifier
- **Password** — app-specific password

Egress domains added: CalDAV server hostname.

Generated tool: `calendar` — CLI wrapper for reading and modifying calendar events.

### Task Management (Todoist)

Required credentials:
- **API token** — from Todoist settings

Egress domains added: `api.todoist.com`.

Generated tool: `tasks` — CLI wrapper for task CRUD operations.

### Messaging Channels

Each messaging channel is configured in `openclaw.json` under `channels.<name>`:

| Channel | Key Configuration |
|---------|-------------------|
| **Telegram** | `botToken` (from @BotFather), user ID for allowlist |
| **Discord** | `applicationId`, `guildId`, bot token |
| **Slack** | `botToken`, `appToken`, `signingSecret` |
| **WhatsApp** | Phone number, QR code pairing |
| **Signal** | Phone number registration |

DM policy for all channels: `"pairing"` (default, requires verification code), `"allowlist"`, `"open"` (not recommended), or `"disabled"`.

### Web Search

Required credentials:
- **API key** — from the search provider (e.g., Tavily, Brave Search)

Egress domains added: search API hostname.

Generated tool: `web-search` — CLI wrapper for web search queries.

### Adding Custom Integrations

To add a new integration to a custom blueprint:

1. Add the service to `integration_requirements` (required, recommended, or optional)
2. Add the service's domains to `security_posture.egress_domains`
3. Add the corresponding tool to `toolbelt.tools[]`
4. Ensure credential environment variables are documented for `.env`

---

## Generated Directory Structure

When ClawHQ forges an agent from a blueprint, it generates the following directory structure at `~/.clawhq/`:

```
~/.clawhq/
├── clawhq.yaml                    # Meta-config (version, install method, cloud token)
│
├── engine/                        # OpenClaw runtime
│   ├── openclaw.json              # Runtime config — all 14 landmine rules enforced
│   ├── .env                       # Secrets: API keys, tokens (mode 0600)
│   ├── docker-compose.yml         # Hardened container config
│   ├── Dockerfile                 # Stage 2 custom layer (tools, binaries)
│   └── credentials.json           # Integration credentials (mode 0600)
│
├── workspace/                     # Agent's world (mounted into container)
│   ├── identity/                  # Who the agent is (read-only mount)
│   │   ├── SOUL.md               # Character, tone, boundaries
│   │   ├── AGENTS.md             # Operating procedures
│   │   ├── IDENTITY.md           # Name, emoji, presentation
│   │   ├── HEARTBEAT.md          # Periodic check-in checklist
│   │   └── TOOLS.md              # Tool usage notes
│   ├── tools/                     # CLI wrappers (bash/python3)
│   │   ├── email                 # Email operations via Himalaya
│   │   ├── calendar              # Calendar via CalDAV
│   │   ├── tasks                 # Task management via API
│   │   └── web-search            # Web search via provider API
│   ├── skills/                    # Autonomous capability definitions
│   │   └── <skill-name>/
│   │       ├── SKILL.md          # Behavior specification
│   │       ├── config.yaml       # Skill configuration
│   │       └── prompts/          # Step-specific prompt templates
│   └── memory/                    # Three-tier memory
│       ├── hot/                   # Recent context
│       ├── warm/                  # Summarized history
│       └── cold/                  # Archived records
│
├── cron/
│   └── jobs.json                  # Scheduled jobs (OpenClaw-native cron format)
│
├── security/
│   └── posture.yaml               # Container hardening level (standard/hardened/paranoid)
│
├── ops/
│   ├── doctor/                    # Diagnostic results
│   ├── monitor/                   # Health monitoring state
│   ├── backup/snapshots/          # Encrypted backup archives
│   ├── updater/rollback/          # Pre-update container images
│   ├── audit/                     # Tool execution, secret lifecycle, egress logs
│   └── firewall/
│       └── allowlist.yaml         # Per-integration domain allowlist
│
└── cloud/                         # Cloud connection state (optional)
```

### File Permissions

| File | Mode | Rationale |
|------|------|-----------|
| `engine/.env` | `0600` | Contains API keys and tokens |
| `engine/credentials.json` | `0600` | Contains integration credentials |
| `workspace/identity/*` | Read-only mount | Prevents agent self-modification |
| `engine/openclaw.json` | Read-only mount | Prevents agent config tampering |
