# aishore — Intent-Driven AI Sprint Runner

Drop-in sprint orchestration for Claude Code. Reliably develops software aligned to commander's intent and quality standards. Each item carries a non-negotiable directive, and every implementation goes through a maturity protocol (implement → critique → harden) before validation.

## Getting Started

```bash
.aishore/aishore init               # Setup wizard (creates backlog/, config, etc.)
.aishore/aishore backlog add        # Add your first item
.aishore/aishore groom              # Groom items (marks them ready)
.aishore/aishore run                # Run a sprint
```

## Backlog Management

All backlog operations use the `backlog` subcommand. Items live in `backlog/backlog.json` (features) and `backlog/bugs.json` (bugs/tech debt). You never need to edit these files directly.

### List items

```bash
.aishore/aishore backlog list                    # All items
.aishore/aishore backlog list --type feat         # Features only
.aishore/aishore backlog list --type bug          # Bugs only
.aishore/aishore backlog list --status todo       # Filter by status (todo, in-progress, done)
.aishore/aishore backlog list --ready             # Sprint-ready items only
.aishore/aishore backlog list --type bug --ready  # Combine filters
```

### Add items

**Interactive** (prompts for each field):
```bash
.aishore/aishore backlog add
```

**With flags** (non-interactive):
```bash
.aishore/aishore backlog add --title "Add user login" \
  --intent "Users must authenticate securely or be told exactly why they can't." \
  --desc "OAuth2 flow with Google provider" --priority must
.aishore/aishore backlog add --title "Fix timeout" --type bug --priority must --ready
.aishore/aishore backlog add --title "Nice to have" --priority could --category "UX"
```

| Flag | Description | Default |
|------|-------------|---------|
| `--title "..."` | Item title (required) | — |
| `--intent "..."` | Commander's intent — what must be true when done (**required for sprint**) | — |
| `--type feat\|bug` | Feature or bug | `feat` |
| `--desc "..."` | Description | *(none)* |
| `--priority must\|should\|could\|future` | Priority level | `should` |
| `--category "..."` | Category tag | *(none)* |
| `--ready` | Mark as sprint-ready immediately | `false` |
| `--ac "text"` | Add acceptance criterion (repeatable) | *(none)* |
| `--ac-verify "cmd"` | Attach verification command to preceding `--ac` | *(none)* |

IDs are auto-generated: `FEAT-001`, `FEAT-002`, ... or `BUG-001`, `BUG-002`, ...

> **Note:** Items without a commander's intent (or with intent shorter than 20 characters) will not be picked for sprints. You can add items without intent for tracking, but they must have intent before they can execute.

### Show item detail

```bash
.aishore/aishore backlog show FEAT-001
```

Displays all fields: title, status, priority, description, steps, acceptance criteria, dependencies, grooming notes, and completion date.

### Edit items

```bash
.aishore/aishore backlog edit FEAT-001 --priority must
.aishore/aishore backlog edit FEAT-001 --title "New title" --desc "Updated description"
.aishore/aishore backlog edit BUG-003 --status done
.aishore/aishore backlog edit FEAT-002 --ready                  # Mark sprint-ready
.aishore/aishore backlog edit FEAT-002 --no-ready               # Unmark
.aishore/aishore backlog edit FEAT-001 --groomed-at --groomed-notes "Reviewed, good to go"
```

| Flag | Description |
|------|-------------|
| `--title "..."` | Change title |
| `--intent "..."` | Set commander's intent |
| `--desc "..."` | Change description |
| `--priority must\|should\|could\|future` | Change priority |
| `--status todo\|in-progress\|done` | Change status |
| `--category "..."` | Change category |
| `--ready` | Mark as sprint-ready |
| `--no-ready` | Unmark from sprint-ready |
| `--groomed-at [YYYY-MM-DD]` | Set groomed date (defaults to today) |
| `--groomed-notes "..."` | Set grooming notes |

Multiple flags can be combined in a single edit command.

### Remove items

```bash
.aishore/aishore backlog rm FEAT-001           # Prompts for confirmation
.aishore/aishore backlog rm FEAT-001 --force   # Skip confirmation
```

## Sprint Execution

```bash
.aishore/aishore run                # Run 1 sprint (branch, commit, merge, push)
.aishore/aishore run 5              # Run 5 sprints (each on its own branch)
.aishore/aishore run FEAT-001       # Run specific item
.aishore/aishore run --dry-run      # Preview what would run without executing
.aishore/aishore run --no-merge 3   # Keep feature branches for PR review
.aishore/aishore run --retries 2    # Allow 2 retries on validation failure
.aishore/aishore run --refine       # Refine spec on exhausted retries
.aishore/aishore run --quick        # Skip maturity protocol (fast iteration)
```

**Flow:** Pick Item → Create Branch (`aishore/<ID>`) → Developer Agent (with maturity protocol) → Validation Command → Validator Agent → Merge → Push → Archive

**Maturity protocol:** By default, the developer agent runs a 3-phase cycle within a single session: Implement → Critique → Harden. This keeps quality iteration inside the session where context is hot. Use `--quick` to skip for fast iteration.

Each sprint item runs on its own feature branch. The developer agent commits directly. On success, the branch is merged back with `--no-ff`, pushed, and latest is pulled before the next item. Use `--no-merge` to keep branches for PR review instead.

Items must have `readyForSprint: true` to be auto-picked. Use `groom` or `backlog edit <ID> --ready` to mark items ready.

## Grooming

```bash
.aishore/aishore groom              # Tech Lead grooms bugs (adds steps, AC, marks ready)
.aishore/aishore groom --backlog    # Product Owner grooms features
```

Grooming agents review items, add implementation steps and acceptance criteria, set priorities, and mark items ready for sprint.

## Other Commands

```bash
.aishore/aishore review                        # Architecture review
.aishore/aishore review --update-docs          # Review and update ARCHITECTURE.md/PRODUCT.md
.aishore/aishore review --since <commit>       # Review changes since commit
.aishore/aishore metrics                       # Sprint metrics
.aishore/aishore metrics --json                # Metrics as JSON
.aishore/aishore status                        # Backlog overview and sprint readiness
.aishore/aishore clean                         # Remove done items from backlogs
.aishore/aishore clean --dry-run               # Show what would be removed
.aishore/aishore update                        # Update from upstream (checksum-verified)
.aishore/aishore update --dry-run              # Check for updates without applying
.aishore/aishore update --force                # Update even if already on latest
.aishore/aishore update --force --no-verify    # Skip checksum verification
.aishore/aishore checksums                     # Regenerate checksums after editing .aishore/ files
.aishore/aishore help                          # Full command reference
```

## Item Schema

Each backlog item has these fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Auto-generated (`FEAT-001`, `BUG-001`) |
| `title` | string | Short descriptive title |
| `intent` | string | Commander's intent — the non-negotiable directive that defines what must be true when done |
| `description` | string | Full description — what to build, context, scope boundaries |
| `priority` | string | `must`, `should`, `could`, or `future` |
| `category` | string | Organizational tag |
| `steps` | array | Implementation steps (added by grooming) |
| `acceptanceCriteria` | array | Verifiable acceptance criteria (added by grooming) |
| `status` | string | `todo`, `in-progress`, or `done` |
| `readyForSprint` | boolean | Whether item is ready for sprint execution |
| `passes` | boolean | Set automatically after successful sprint |
| `scope` | array | Glob patterns for scope checking (e.g., `["src/**", "tests/**"]`) |
| `dependsOn` | array | IDs of items this depends on |
| `groomedAt` | string | Date of last grooming (YYYY-MM-DD) |
| `groomingNotes` | string | Notes from grooming |
| `completedAt` | string | Completion timestamp (set automatically) |
| `failCount` | number | Number of failed sprint attempts (auto-set) |
| `lastFailAt` | string | Timestamp of last failure (auto-set) |
| `lastFailReason` | string | Reason for last failure (auto-set) |

## Project Structure

```
your-project/
├── backlog/                 # YOUR CONTENT (version controlled)
│   ├── backlog.json         # Feature backlog
│   ├── bugs.json            # Bug/tech-debt backlog
│   ├── sprint.json          # Current sprint state
│   ├── DEFINITIONS.md       # DoR, DoD, priority/size definitions
│   └── archive/
│       └── sprints.jsonl    # Completed sprint history
└── .aishore/                # TOOL (updated via `update` command)
    ├── aishore              # Self-contained CLI
    ├── VERSION              # Version (single source of truth)
    ├── checksums.sha256     # SHA-256 checksums for update verification
    ├── config.yaml          # Optional overrides
    ├── agents/              # Agent prompts
    └── data/                # Runtime (logs, status)
```

Your backlogs (`backlog/`) are separate from the tool (`.aishore/`). Updates never touch your content.

## Configuration

Edit `.aishore/config.yaml` to override defaults, or use environment variables:

| Setting | Config key | Env var | Default |
|---------|-----------|---------|---------|
| Validation command | `validation.command` | `AISHORE_VALIDATE_CMD` | *(none)* |
| Validation timeout | `validation.timeout` | `AISHORE_VALIDATE_TIMEOUT` | `120` |
| Primary model | `models.primary` | `AISHORE_MODEL_PRIMARY` | `claude-opus-4-6` |
| Fast model | `models.fast` | `AISHORE_MODEL_FAST` | `claude-sonnet-4-6` |
| Agent timeout | `agent.timeout` | `AISHORE_AGENT_TIMEOUT` | `3600` |
| Notify command | `notifications.on_complete` | `AISHORE_NOTIFY_CMD` | *(none)* |
| Maturity protocol | `maturity.enabled` | `AISHORE_MATURITY` | `true` |

**Precedence:** env vars > config.yaml > built-in defaults.

## Updating

```bash
.aishore/aishore update             # Checksum-verified update
.aishore/aishore update --dry-run   # Check for updates without applying
.aishore/aishore update --force     # Update even if already on latest version
.aishore/aishore update --force --no-verify  # Skip checksum verification
```
