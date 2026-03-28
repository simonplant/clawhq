# ClawHQ Blueprint Specification

**Version:** 1.0.0
**Status:** Draft
**Updated:** 2026-03-28

---

## Overview

A **blueprint** is a complete agent design expressed as a single YAML file. It describes everything ClawHQ needs to forge a hardened, running OpenClaw agent: identity, personality, tools, skills, cron schedules, security posture, autonomy rules, memory policy, model routing, integrations, and messaging channels.

Blueprints are the primary interface between agent designers and the ClawHQ platform. A developer can create a valid blueprint from this specification alone, without reading ClawHQ source code.

### Design Principles

- **Complete** — A blueprint is self-contained. It defines every dimension of the agent.
- **Declarative** — Blueprints describe *what* the agent should be, not *how* to configure it. ClawHQ compiles the blueprint into flat runtime config.
- **Secure by default** — Security constraints are enforced at the schema level. Identity files are always read-only. Dangerous defaults don't exist.
- **Validated** — Every blueprint passes 70+ structural and security checks before compilation. Invalid blueprints are rejected with actionable error messages.

### File Format

- **Encoding:** UTF-8
- **Syntax:** YAML 1.2
- **Extension:** `.yaml`
- **Maximum size:** 256 KB

### Versioning

This specification follows [Semantic Versioning](https://semver.org/):

- **Major** — Breaking changes (removed fields, changed semantics, stricter constraints)
- **Minor** — Additions (new optional fields, new enum values)
- **Patch** — Clarifications and editorial fixes

Blueprint files also carry their own `version` field (see [Metadata](#metadata)), which tracks the blueprint's revision independently of the spec version.

---

## Schema Reference

A blueprint is a YAML mapping with two top-level metadata fields and 12 required sections. One additional section (`customization_questions`) is optional.

### Metadata

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Human-readable blueprint name. Must be non-empty. |
| `version` | string | Yes | Blueprint revision in semver format (`MAJOR.MINOR.PATCH`). |

```yaml
name: Email Manager
version: "1.0.0"
```

---

### `use_case_mapping`

Describes what the blueprint replaces and how it positions itself to users.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `replaces` | string | Yes | What product or workflow this agent replaces. |
| `tagline` | string | Yes | Short (one-line) description for listings. |
| `description` | string | Yes | Long-form description of the agent's purpose. |
| `day_in_the_life` | string | Yes | Narrative example of a typical day using this agent. |

```yaml
use_case_mapping:
  replaces: Gmail / Outlook / Apple Mail (manual triage)
  tagline: "Inbox zero, email triage, calendar-aware digests, task extraction"
  description: >
    Purpose-built email operations agent. Triages your inbox every 15 minutes,
    extracts action items into tasks, and delivers a morning digest.
  day_in_the_life: >
    8:00am digest: "Morning. 52 emails overnight — 7 need you, 12 auto-replied,
    rest archived." Every 15 minutes the agent checks your inbox, triages new
    mail, and updates your task list.
```

---

### `personality`

Defines the agent's communication style, tone, and behavioral boundaries.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tone` | string | Yes | Primary communication tone (e.g., `"direct"`, `"analytical"`, `"warm"`). |
| `style` | string | Yes | Behavioral style description. |
| `relationship` | string | Yes | How the agent relates to the user (e.g., `"email operations manager"`). |
| `boundaries` | string | Yes | Behavioral boundaries the agent must respect. |
| `dimensions` | object | No | Slider-based personality dimensions (see below). |

#### Personality Dimensions

When present, `dimensions` must define all 7 axes. Each value is an integer from 1 to 5.

| Dimension | Scale | 1 | 5 |
|-----------|-------|---|---|
| `directness` | 1-5 | Diplomatic | Blunt |
| `warmth` | 1-5 | Clinical | Nurturing |
| `verbosity` | 1-5 | Minimal | Exhaustive |
| `proactivity` | 1-5 | Reactive | Autonomous |
| `caution` | 1-5 | Bold | Conservative |
| `formality` | 1-5 | Casual | Corporate |
| `analyticalDepth` | 1-5 | Action-oriented | Scholarly |

**Constraint:** If `dimensions` is present, all 7 dimensions must be provided. Partial dimensions are rejected.

**Personality tensions** (warnings, never blocking):

| ID | Condition | Description |
|----|-----------|-------------|
| T-01 | proactivity >= 4 AND caution >= 4 | Paralysis — agent wants to act but is too cautious |
| T-02 | warmth >= 4 AND directness >= 4 | Whiplash — warm tone with blunt delivery |
| T-03 | verbosity <= 2 AND analyticalDepth >= 4 | Compression — deep analysis forced into minimal output |
| T-04 | formality >= 4 AND warmth >= 4 | Stiff warmth — formal tone with nurturing intent |
| T-05 | proactivity >= 4 AND directness <= 2 | Buried actions — proactive but diplomatically indirect |
| T-06 | caution <= 2 AND formality >= 4 | Bold corporate — risky decisions in corporate voice |
| T-07 | verbosity >= 4 AND directness >= 4 | Verbose blunt — long-winded and blunt |

```yaml
personality:
  tone: direct
  style: "efficient, no fluff, protective of attention"
  relationship: email operations manager
  boundaries: "never sends without approval on first contact"
  dimensions:
    directness: 5
    warmth: 2
    verbosity: 2
    proactivity: 4
    caution: 3
    formality: 3
    analyticalDepth: 2
```

---

### `security_posture`

Controls the agent's security configuration. Security constraints are enforced at the schema level — not opt-in.

| Field | Type | Required | Allowed Values | Description |
|-------|------|----------|----------------|-------------|
| `posture` | string | Yes | `"standard"`, `"hardened"`, `"paranoid"` | Overall security level. |
| `egress` | string | Yes | `"default"`, `"restricted"`, `"allowlist-only"` | Network egress policy. |
| `egress_domains` | string[] | Yes | — | Domains the agent may contact. Empty array means no external access. |
| `identity_mount` | string | Yes | `"read-only"` | **Must always be `"read-only"`.** Agents cannot modify their own identity. |

**Security levels:**

| Posture | Description |
|---------|-------------|
| `standard` | Basic security. Triggers a validation warning recommending upgrade. |
| `hardened` | Production default. Container hardening, restricted egress, credential isolation. |
| `paranoid` | Maximum security. Allowlist-only egress, minimal attack surface. |

**Egress policies:**

| Policy | Description |
|--------|-------------|
| `default` | Unrestricted outbound. Triggers warning when posture is `hardened` or `paranoid`. |
| `restricted` | Known-service egress only. |
| `allowlist-only` | Only `egress_domains` are reachable. Everything else is blocked. |

**Enforced constraints:**
- `identity_mount` must be `"read-only"` — this is a security baseline, not a configuration choice.
- `egress: "default"` with `posture: "hardened"` or `"paranoid"` produces a validation warning.
- `posture: "standard"` produces a validation warning recommending `"hardened"` or `"paranoid"`.

```yaml
security_posture:
  posture: hardened
  egress: allowlist-only
  egress_domains:
    - imap.gmail.com
    - smtp.gmail.com
    - api.todoist.com
  identity_mount: read-only
```

---

### `monitoring`

Health monitoring configuration.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `heartbeat_frequency` | string | Yes | How often the agent reports health (e.g., `"10min"`, `"60min"`). |
| `checks` | string[] | Yes | Integration checks to run (e.g., `["email", "calendar"]`). |
| `quiet_hours` | string | Yes | Time range when alerts are suppressed. Format: `HH:MM-HH:MM`. |
| `alert_on` | string[] | Yes | Events that trigger alerts (e.g., `["credential_expiry", "memory_bloat"]`). |

```yaml
monitoring:
  heartbeat_frequency: "10min"
  checks:
    - email
    - calendar
    - tasks
  quiet_hours: "23:00-06:00"
  alert_on:
    - credential_expiry
    - memory_bloat
    - cron_failure
```

---

### `memory_policy`

Controls the agent's three-tier memory system (hot, warm, cold).

| Field | Type | Required | Allowed Values | Description |
|-------|------|----------|----------------|-------------|
| `hot_max` | string | Yes | Size with unit (e.g., `"120KB"`) | Maximum size of the hot (working) memory tier. |
| `hot_retention` | string | Yes | Duration with suffix (e.g., `"7d"`) | How long items stay in hot memory. |
| `warm_retention` | string | Yes | Duration with suffix (e.g., `"90d"`) | How long items stay in warm (summarized) memory. |
| `cold_retention` | string | Yes | Duration with suffix (e.g., `"365d"`) | How long items stay in cold (archived) memory. |
| `summarization` | string | Yes | `"aggressive"`, `"balanced"`, `"conservative"` | How aggressively memories are summarized when moving between tiers. |

**Format constraints:**
- Size values: number followed by unit — `KB` or `MB` (e.g., `"120KB"`, `"1MB"`).
- Duration values: number followed by suffix — `d` (days), `w` (weeks), `m` (months), `y` (years) (e.g., `"7d"`, `"90d"`, `"365d"`).

```yaml
memory_policy:
  hot_max: "120KB"
  hot_retention: "7d"
  warm_retention: "90d"
  cold_retention: "365d"
  summarization: balanced
```

---

### `cron_config`

Scheduled task configuration. All fields are required but may be empty strings to disable.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `heartbeat` | string | Yes | Health check schedule (e.g., `"*/10 waking"`). Empty string disables. |
| `work_session` | string | Yes | Work session schedule (e.g., `"*/15 waking"`). Empty string disables. |
| `morning_brief` | string | Yes | Morning briefing time (e.g., `"08:00"`). Empty string disables. |

The `waking` keyword restricts execution to outside quiet hours. For example, `"*/10 waking"` means every 10 minutes during waking hours.

```yaml
cron_config:
  heartbeat: "*/10 waking"
  work_session: "*/15 waking"
  morning_brief: "08:00"
```

---

### `autonomy_model`

Controls what the agent does autonomously vs. what requires user approval.

| Field | Type | Required | Allowed Values | Description |
|-------|------|----------|----------------|-------------|
| `default` | string | Yes | `"low"`, `"medium"`, `"high"` | Default autonomy level. |
| `requires_approval` | string[] | Yes | — | Actions that always require explicit user approval. |

**Autonomy levels:**

| Level | Description |
|-------|-------------|
| `low` | Agent waits for instructions. Minimal proactive behavior. |
| `medium` | Agent handles routine tasks autonomously. Escalates exceptions. |
| `high` | Agent acts proactively. Only escalates sensitive or high-risk actions. |

```yaml
autonomy_model:
  default: medium
  requires_approval:
    - sending_messages
    - account_changes
    - public_posts
```

---

### `model_routing_strategy`

Controls how the agent routes tasks between local and cloud AI models.

| Field | Type | Required | Allowed Values | Description |
|-------|------|----------|----------------|-------------|
| `default_provider` | string | Yes | `"local"`, `"cloud"` | Default model provider. |
| `local_model_preference` | string | Yes | — | Preferred local model (e.g., `"llama3:8b"`, `"llama3:70b"`). |
| `cloud_escalation_categories` | string[] | Yes | — | Task categories that escalate to cloud models. |
| `quality_threshold` | string | Yes | `"low"`, `"medium"`, `"high"` | Minimum quality bar for local model output before escalating. |

```yaml
model_routing_strategy:
  default_provider: local
  local_model_preference: "llama3:8b"
  cloud_escalation_categories:
    - long_form_writing
    - complex_triage
  quality_threshold: medium
```

---

### `integration_requirements`

Declares which integrations the blueprint needs, organized by priority.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `required` | string[] | Yes | Integrations the agent cannot function without. |
| `recommended` | string[] | Yes | Integrations that significantly improve the agent. |
| `optional` | string[] | Yes | Nice-to-have integrations. |

**Validation:** `"messaging"` should appear in `required` or `recommended` — every agent needs a communication channel. This is a warning, not a blocking error.

```yaml
integration_requirements:
  required:
    - messaging
    - email
  recommended:
    - calendar
    - tasks
  optional:
    - research
```

---

### `channels`

Messaging channel configuration.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `supported` | string[] | Yes | Channels the blueprint supports (e.g., `["telegram", "discord"]`). |
| `default` | string | Yes | Default channel. **Must be present in `supported`.** |

**Cross-field constraint:** `default` must be one of the values in `supported`. A mismatch is a validation error.

```yaml
channels:
  supported:
    - telegram
    - whatsapp
    - signal
    - discord
  default: telegram
```

---

### `skill_bundle`

Skills included with and recommended for the blueprint.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `included` | string[] | Yes | Skills that ship with the blueprint. |
| `recommended` | string[] | Yes | Skills the user should consider adding. |

**Cross-field constraint:** Every skill in `included` should have a matching entry in `toolbelt.skills`. A mismatch produces a validation warning.

```yaml
skill_bundle:
  included:
    - email-digest
    - morning-brief
  recommended:
    - auto-reply
    - calendar-sync
```

---

### `toolbelt`

The agent's tools and skills — the concrete capabilities it can execute.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | string | Yes | Short description of the toolbelt's role. |
| `description` | string | Yes | What the toolbelt enables. |
| `tools` | ToolEntry[] | Yes | List of tools (see below). |
| `skills` | SkillEntry[] | Yes | List of skills (see below). |

#### ToolEntry

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Tool identifier. Must be unique within the toolbelt. |
| `category` | string | Yes | Tool category (e.g., `"email"`, `"calendar"`, `"core"`). |
| `required` | boolean | Yes | Whether this tool is required for the blueprint to function. |
| `description` | string | Yes | What the tool does. |

#### SkillEntry

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Skill identifier. Must be unique within the toolbelt. |
| `required` | boolean | Yes | Whether this skill is required for the blueprint to function. |
| `description` | string | Yes | What the skill does. |

**Validation constraints:**
- At least one tool should be marked `required: true` (warning).
- Tool names must be unique across the toolbelt (error).
- Skill names must be unique across the toolbelt (error).

```yaml
toolbelt:
  role: "Email operations manager"
  description: "Inbox triage, calendar-aware digests, task extraction"
  tools:
    - name: email
      category: email
      required: true
      description: "Email reading, triage, and drafting via himalaya"
    - name: ical
      category: calendar
      required: true
      description: "Calendar awareness via CalDAV"
    - name: tasks
      category: core
      required: true
      description: "Local work queue for task execution"
  skills:
    - name: email-digest
      required: true
      description: "Periodic inbox digest with triage summary"
    - name: morning-brief
      required: true
      description: "Daily morning briefing with inbox and calendar preview"
```

---

### `customization_questions` (optional)

Blueprint-specific questions asked during setup. Maximum 3 questions per blueprint.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier for this question (used as answer key). |
| `prompt` | string | Yes | The question shown to the user. |
| `type` | string | Yes | `"select"` (multiple choice) or `"input"` (free text). |
| `options` | string[] | Conditional | Available choices. **Required when `type` is `"select"`.** Must not be empty. Forbidden when `type` is `"input"`. |
| `default` | string | No | Default answer value. |

**Validation constraints:**
- Maximum 3 questions per blueprint.
- Question `id` values must be unique.
- When `type` is `"select"`, `options` must be a non-empty string array.
- When `type` is `"input"`, `options` must not be present.

```yaml
customization_questions:
  - id: communication_style
    prompt: "How should your agent communicate?"
    type: select
    options:
      - "Brief and direct"
      - "Warm and conversational"
      - "Professional and formal"
  - id: priority_contacts
    prompt: "Who are your VIP contacts? (comma-separated)"
    type: input
    default: ""
```

---

## Validation Rules

ClawHQ runs 70+ validation checks against every blueprint. Checks are classified as **errors** (block compilation) or **warnings** (informational, never block).

### Structural Checks (errors)

| Check | Rule |
|-------|------|
| `blueprint.name` | Must be a non-empty string. |
| `blueprint.version` | Must be a non-empty string. |
| Required sections | All 12 sections must be present and be YAML mappings. |
| String fields | All documented string fields must be non-empty strings. |
| Enum fields | Must match one of the allowed values exactly. |
| Array fields | Must be arrays of strings where documented. |
| `security_posture.identity_mount` | Must be `"read-only"`. No other value is accepted. |
| `channels.default` | Must appear in `channels.supported`. |
| `personality.dimensions` | If present, all 7 dimensions required; each must be integer 1-5. |
| `customization_questions` | Max 3; unique IDs; `options` required for `"select"` type. |
| `toolbelt.tools[*]` | Each must have `name`, `category`, `description` (strings) and `required` (boolean). |
| `toolbelt.skills[*]` | Each must have `name`, `description` (strings) and `required` (boolean). |
| Tool/skill name uniqueness | No duplicate names within `toolbelt.tools` or `toolbelt.skills`. |

### Format Checks (warnings)

| Check | Rule |
|-------|------|
| `version` format | Should follow semver (`MAJOR.MINOR.PATCH`). |
| `quiet_hours` format | Should be `HH:MM-HH:MM`. |
| `hot_max` unit | Should include size unit (`KB` or `MB`). |
| Retention durations | `hot_retention`, `warm_retention`, `cold_retention` should include duration suffix (`d`, `w`, `m`, `y`). |

### Security Checks (warnings)

| Check | Rule |
|-------|------|
| Posture minimum | `"standard"` posture triggers recommendation to use `"hardened"` or `"paranoid"`. |
| Egress/posture match | `"default"` egress with `"hardened"` or `"paranoid"` posture triggers warning. |

### Cross-Section Consistency (warnings)

| Check | Rule |
|-------|------|
| Messaging integration | `"messaging"` should be in `required` or `recommended` integrations. |
| Included skills in toolbelt | Every `skill_bundle.included` skill should have a `toolbelt.skills` entry. |
| Required tool exists | At least one tool should be `required: true`. |

---

## Security Constraints

These constraints are enforced by the ClawHQ compiler and cannot be overridden by blueprint authors.

### Identity Protection

- `identity_mount` must be `"read-only"` — agents cannot modify their own personality, instructions, or identity files at runtime.

### Always-On Security Boundaries

Regardless of personality or autonomy settings, every agent enforces:

1. Never modify identity files, personality, or instructions
2. Never share credentials, API keys, tokens, or passwords
3. Never execute destructive commands without explicit approval
4. Never impersonate the user without explicit approval
5. Never bypass security controls or audit logging
6. Never access unapproved egress destinations
7. Never generate unlawful, hostile, or harmful content
8. Never assist in harming users or third parties
9. Always maintain audit trail for tool executions
10. Always require approval before first contact with new parties

### Credential Handling

- Credentials are never stored in blueprint files.
- At runtime, `credentials.json` is stored with mode `0600` (owner read/write only).
- `.env` files are stored with mode `0600`.
- Credentials are never written into OpenClaw config files.

### Container Hardening

When compiled, blueprints produce containers with:
- `cap_drop: ALL` — all Linux capabilities dropped
- Read-only root filesystem
- Non-root execution (UID 1000)
- Inter-container communication (ICC) disabled
- Egress firewall via dedicated iptables chain

---

## Worked Examples

### Example 1: Minimal Blueprint

The smallest valid blueprint. Uses a single research tool with maximum security.

```yaml
name: Minimal Research
version: "1.0.0"

use_case_mapping:
  replaces: Manual web research
  tagline: "Simple research assistant"
  description: "A minimal agent that performs web research on demand."
  day_in_the_life: "You ask a question. The agent researches and responds."

personality:
  tone: neutral
  style: "concise, factual"
  relationship: research assistant
  boundaries: "only responds when asked, never initiates contact"

security_posture:
  posture: paranoid
  egress: allowlist-only
  egress_domains:
    - api.tavily.com
  identity_mount: read-only

monitoring:
  heartbeat_frequency: "60min"
  checks:
    - research
  quiet_hours: "22:00-08:00"
  alert_on:
    - credential_expiry

memory_policy:
  hot_max: "50KB"
  hot_retention: "7d"
  warm_retention: "30d"
  cold_retention: "90d"
  summarization: aggressive

cron_config:
  heartbeat: "*/60 waking"
  work_session: ""
  morning_brief: ""

autonomy_model:
  default: low
  requires_approval:
    - sending_messages

model_routing_strategy:
  default_provider: local
  local_model_preference: "llama3:8b"
  cloud_escalation_categories: []
  quality_threshold: low

integration_requirements:
  required:
    - messaging
  recommended: []
  optional:
    - research

channels:
  supported:
    - telegram
  default: telegram

skill_bundle:
  included: []
  recommended: []

toolbelt:
  role: "Research assistant"
  description: "Web research on demand"
  tools:
    - name: tavily
      category: research
      required: true
      description: "Web research via Tavily API"
    - name: tasks
      category: core
      required: true
      description: "Local work queue"
  skills: []
```

### Example 2: Email Manager (Medium Complexity)

A production-ready email operations agent with customization questions, personality dimensions, and multiple tools.

```yaml
name: Email Manager
version: "1.0.0"

use_case_mapping:
  replaces: Gmail / Outlook / Apple Mail (manual triage)
  tagline: "Inbox zero, email triage, calendar-aware digests, task extraction"
  description: >
    Purpose-built email operations agent. Triages your inbox every 15 minutes,
    extracts action items into tasks, guards your calendar, and delivers a
    morning digest so you start the day informed — not overwhelmed.
  day_in_the_life: >
    8:00am digest: "Morning. 52 emails overnight — 7 need you, 12 auto-replied,
    rest archived. 4 meetings today; your 10-12 focus block is protected."
    Every 15 minutes the agent checks your inbox and triages new mail.

customization_questions:
  - id: communication_style
    prompt: "How should your agent communicate?"
    type: select
    options:
      - "Brief and direct — bullet points, no fluff"
      - "Warm and conversational — friendly, approachable"
      - "Professional and formal — polished, corporate tone"
  - id: triage_priority
    prompt: "What type of emails should always be flagged as high priority?"
    type: input
    default: "Emails from my manager, clients, or containing 'urgent'"
  - id: auto_reply_comfort
    prompt: "How comfortable are you with auto-replies?"
    type: select
    options:
      - "Never auto-reply — always ask me first"
      - "Auto-reply to routine messages only"
      - "Auto-reply freely — I trust the agent's judgment"

personality:
  tone: direct
  style: "efficient, no fluff, protective of attention"
  relationship: email operations manager
  boundaries: "never sends without approval on first contact, protects focus blocks"
  dimensions:
    directness: 5
    warmth: 2
    verbosity: 2
    proactivity: 4
    caution: 3
    formality: 3
    analyticalDepth: 2

security_posture:
  posture: hardened
  egress: allowlist-only
  egress_domains:
    - imap.gmail.com
    - smtp.gmail.com
    - caldav.icloud.com
    - api.todoist.com
  identity_mount: read-only

monitoring:
  heartbeat_frequency: "10min"
  checks:
    - email
    - calendar
    - tasks
  quiet_hours: "23:00-06:00"
  alert_on:
    - credential_expiry
    - memory_bloat
    - cron_failure
    - integration_degraded

memory_policy:
  hot_max: "120KB"
  hot_retention: "7d"
  warm_retention: "90d"
  cold_retention: "365d"
  summarization: balanced

cron_config:
  heartbeat: "*/10 waking"
  work_session: "*/15 waking"
  morning_brief: "08:00"

autonomy_model:
  default: medium
  requires_approval:
    - sending_messages
    - account_changes
    - public_posts

model_routing_strategy:
  default_provider: local
  local_model_preference: "llama3:8b"
  cloud_escalation_categories:
    - long_form_writing
    - complex_triage
  quality_threshold: medium

integration_requirements:
  required:
    - messaging
    - email
  recommended:
    - calendar
    - tasks
  optional:
    - research

channels:
  supported:
    - telegram
    - whatsapp
    - signal
    - discord
  default: telegram

skill_bundle:
  included:
    - email-digest
    - morning-brief
  recommended:
    - auto-reply
    - calendar-sync

toolbelt:
  role: "Email operations manager"
  description: "Inbox triage, calendar-aware digests, task extraction, morning briefs"
  tools:
    - name: email
      category: email
      required: true
      description: "Email reading, triage, and drafting via himalaya"
    - name: ical
      category: calendar
      required: true
      description: "Calendar awareness via CalDAV — schedule conflicts, focus blocks"
    - name: todoist
      category: tasks
      required: false
      description: "Task extraction and tracking via Todoist API"
    - name: tasks
      category: core
      required: true
      description: "Local work queue for autonomous task execution"
  skills:
    - name: email-digest
      required: true
      description: "Periodic inbox digest — triage summary, action items"
    - name: morning-brief
      required: true
      description: "Daily morning briefing — inbox status, calendar preview"
    - name: auto-reply
      required: false
      description: "Autonomous replies to routine emails with approval gates"
```

### Example 3: Replace My PA (Full Complexity)

A full-featured personal assistant with high tool count, multiple required integrations, and proactive autonomy.

```yaml
name: Replace my PA
version: "1.0.0"

use_case_mapping:
  replaces: Personal Assistant
  tagline: "Calendar, email triage, task management — professional assistant"
  description: >
    Professional assistant that manages your calendar, triages email,
    tracks tasks, and preps for meetings. Handles routine autonomously,
    escalates exceptions.
  day_in_the_life: >
    Your agent auto-schedules focus blocks around your meetings, notices a
    conflict John mentioned in email and proposes a reschedule, triages 40
    emails down to 6 that need you, and adds prep time before your client call.
    End of day: tasks completed, emails handled, tomorrow's prep list.

customization_questions:
  - id: work_style
    prompt: "How should your assistant communicate?"
    type: select
    options:
      - "Formal — polished, corporate tone"
      - "Professional but casual — friendly yet competent"
      - "Relaxed — informal, conversational"
  - id: scheduling_preference
    prompt: "How should the agent handle scheduling conflicts?"
    type: select
    options:
      - "Always ask — never reschedule without approval"
      - "Suggest options — propose solutions, I confirm"
      - "Handle it — reschedule routine meetings autonomously"
  - id: priority_contacts
    prompt: "Who are your VIP contacts? (names or roles, comma-separated)"
    type: input
    default: ""

personality:
  tone: professional
  style: "efficient, anticipatory, handles routine, flags exceptions"
  relationship: professional aide
  boundaries: "respects work boundaries, escalates sensitive decisions"
  dimensions:
    directness: 3
    warmth: 3
    verbosity: 3
    proactivity: 3
    caution: 3
    formality: 4
    analyticalDepth: 3

security_posture:
  posture: hardened
  egress: restricted
  egress_domains:
    - imap.gmail.com
    - smtp.gmail.com
    - caldav.icloud.com
    - api.todoist.com
  identity_mount: read-only

monitoring:
  heartbeat_frequency: "10min"
  checks:
    - email
    - calendar
    - tasks
  quiet_hours: "22:00-06:00"
  alert_on:
    - credential_expiry
    - memory_bloat
    - cron_failure
    - integration_degraded

memory_policy:
  hot_max: "100KB"
  hot_retention: "7d"
  warm_retention: "90d"
  cold_retention: "365d"
  summarization: balanced

cron_config:
  heartbeat: "*/10 waking"
  work_session: "*/15 waking"
  morning_brief: "07:30"

autonomy_model:
  default: medium
  requires_approval:
    - sending_emails
    - creating_events
    - large_purchases
    - public_posts

model_routing_strategy:
  default_provider: local
  local_model_preference: "llama3:8b"
  cloud_escalation_categories:
    - email_drafting
    - meeting_prep
  quality_threshold: medium

integration_requirements:
  required:
    - messaging
    - email
    - calendar
  recommended:
    - tasks
  optional:
    - notes
    - code

channels:
  supported:
    - telegram
    - whatsapp
    - slack
  default: telegram

skill_bundle:
  included:
    - morning-brief
    - construct
  recommended:
    - email-triage
    - calendar-sync
    - meeting-prep

toolbelt:
  role: "Professional assistant"
  description: "Calendar, email triage, task management, meeting prep"
  tools:
    - name: email
      category: email
      required: true
      description: "Email reading, triage, and draft replies via himalaya"
    - name: ical
      category: calendar
      required: true
      description: "Calendar management, conflict detection, scheduling via CalDAV"
    - name: todoist
      category: tasks
      required: true
      description: "Task management and tracking via Todoist API"
    - name: todoist-sync
      category: tasks
      required: true
      description: "Task polling and due-date alerts for proactive reminders"
    - name: tasks
      category: core
      required: true
      description: "Local work queue for autonomous task execution"
  skills:
    - name: morning-brief
      required: true
      description: "Daily briefing with agenda, email summary, and action items"
    - name: construct
      required: false
      description: "Self-improvement framework for capability growth"
```

---

## Validation Command

Validate any blueprint YAML file against this specification:

```bash
clawhq blueprint validate <file>
```

**Output:** Reports all errors (blocking) and warnings (informational). Exit code 0 if valid, 1 if errors found.

**Example:**

```
$ clawhq blueprint validate my-agent.yaml

Validating: my-agent.yaml

  ✓ 68 checks passed
  ⚠ 2 warnings
    - security.posture_minimum: Security posture is "standard" — consider "hardened" or "paranoid"
    - cross.messaging_integration: Messaging should be in required or recommended integrations

Blueprint is valid (2 warnings).
```

---

## Changelog

### 1.0.0 (2026-03-28)

- Initial specification release
- 12 required sections + 1 optional section
- 70+ validation checks
- 3 worked examples (minimal, medium, full)
- Security constraints documented
- `clawhq blueprint validate` command
