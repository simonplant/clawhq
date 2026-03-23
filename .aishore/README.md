# aishore — Quick Guide

AI sprint runner for Claude Code. Tell it what must be true, it builds it right.

Full docs: https://github.com/simonplant/aishore

## Setup

```bash
.aishore/aishore init           # Interactive setup wizard
.aishore/aishore init --yes     # Non-interactive (accept detected defaults)
```

**Set your validation command** in `.aishore/config.yaml` — sprints won't verify without it:

```yaml
validation:
  command: "npm test && npm run lint"   # Your stack's test/lint command
```

Other config: `models.primary`, `models.fast`, `agent.timeout`, `maturity.enabled`, `scope.mode`. Env vars override config (e.g., `AISHORE_VALIDATE_CMD`).

## The Intent-Driven Model

Every backlog item needs a **commander's intent** — a non-negotiable directive that defines what must be true when done. This is the single most important field. Without it (or with <20 chars), items **cannot enter a sprint**.

Write intent like an order, not a description:
- **Good:** "Ops must know instantly if the service is alive or dead. No false positives."
- **Bad:** "Add health check endpoint" ← that's implementation, not outcome

The developer agent follows intent when the spec is ambiguous or steps seem wrong. The validator checks intent was actually fulfilled, not just that AC passed mechanically.

## Create Backlog Items

```bash
# AI-populate from PRODUCT.md (non-interactive)
.aishore/aishore backlog populate

# Interactive
.aishore/aishore backlog add

# With flags
.aishore/aishore backlog add --title "Add health check" \
  --intent "Ops must know instantly if the service is alive or dead." \
  --priority must --type feat --desc "GET /health returns 200"

# With testable acceptance criteria
.aishore/aishore backlog add --title "Rate limiting" \
  --intent "API stays responsive under load. Abusers throttled, legit users unaffected." \
  --ac "Returns 429 when limit exceeded" --ac-verify "curl -s -o /dev/null -w '%{http_code}' localhost:3000/api | grep 429"
```

Key flags: `--title`, `--intent`, `--type feat|bug`, `--desc`, `--priority must|should|could|future`, `--category`, `--step "..."` (repeatable), `--ac "..."`, `--ac-verify "cmd"` (must follow `--ac`), `--depends-on ID`, `--ready`

Edit: `.aishore/aishore backlog edit <ID> --intent "..." --priority must --step "..." --clear-steps --ac "..." --clear-ac --ready`

## What Makes an Item Sprint-Ready

All gates must pass (check with `backlog check <ID>`):

1. **Intent** — ≥20 chars, written as a directive
2. **Steps** — clear enough for implementation
3. **Acceptance criteria** — verifiable
4. **No blockers** — dependencies resolved
5. **readyForSprint: true** — set by grooming or `--ready` flag

## Groom

Grooming adds steps, acceptance criteria, and marks items ready:

```bash
.aishore/aishore groom              # Tech Lead: grooms bugs, marks items ready
.aishore/aishore groom --backlog    # Product Owner: aligns feature priorities
```

Grooming doesn't guarantee readiness — check with `backlog check <ID>` if items aren't being picked.

## Run Sprints

```bash
.aishore/aishore run                # Run 1 sprint
.aishore/aishore run 5              # Run 5 back-to-back
.aishore/aishore run FEAT-001       # Run specific item
.aishore/aishore run --retries 2    # Retry on failure
.aishore/aishore run --refine       # AI-refine spec when retries exhausted, then retry once more
.aishore/aishore run --quick        # Skip maturity protocol (fast iteration)
.aishore/aishore run --no-merge     # Keep branches for PR review
.aishore/aishore run --dry-run      # Preview without executing
```

**What happens:** Each item gets a feature branch (`aishore/<ID>`). The developer agent implements through 3 phases (implement → critique → harden), your validation command runs, then the validator agent checks AC + intent. On success: merge, push, archive. On failure: branch deleted, clean state restored. Your uncommitted changes are stashed before and restored after.

**Pre-flight:** Validation runs on your current codebase first. If it fails before the developer even starts, the sprint aborts — fix your baseline.

### Autonomous Mode

```bash
.aishore/aishore auto done          # Drain entire backlog
.aishore/aishore auto p0            # Must items only
.aishore/aishore auto p1            # Must + should
.aishore/aishore auto p2            # Must + should + could
.aishore/aishore auto done --retries 2 --max-failures 3
.aishore/aishore auto done --auto-review   # Run architecture review on completion
```

Auto mode grooms when ready items drop below threshold, tracks failures across items, and stops after N consecutive failures (circuit breaker, default 5).

## Review

After sprints complete, the Architect agent can review accumulated changes:

```bash
.aishore/aishore review                        # Architecture review (read-only)
.aishore/aishore review --update-docs          # Review and update ARCHITECTURE.md / PRODUCT.md
.aishore/aishore review --since abc123f        # Review changes since a specific commit
```

## Monitor & Maintain

```bash
.aishore/aishore status             # Backlog overview and sprint readiness
.aishore/aishore metrics            # Sprint velocity, pass rates, trends
.aishore/aishore metrics --json     # Machine-readable metrics
.aishore/aishore clean              # Remove done items from backlogs
.aishore/aishore clean --dry-run    # Preview what would be removed
```

## Update

```bash
.aishore/aishore update             # Checksum-verified update
.aishore/aishore update --dry-run   # Check without applying
.aishore/aishore update --force     # Re-download even if already on latest
```

Only `.aishore/` is replaced. Your `backlog/` and `config.yaml` are never touched.

## Troubleshooting

**Items not being picked?**
- Missing or short intent (<20 chars) → `backlog edit <ID> --intent "..."`
- Not marked ready → `groom` or `backlog edit <ID> --ready`
- Dependency blocking → check `dependsOn` field, resolve or remove
- Run `backlog check <ID>` to see which gates fail

**Sprint failing?**
- Pre-flight fails = your baseline is broken. Run validation command manually and fix.
- Use `--retries 2 --refine` to let AI iterate on the spec
- Scope violations (if `scope.mode: strict`): developer changed files outside allowed globs

**Stuck state?**
- `rm .aishore/data/status/result.json` — clears completion signal
- `rm .aishore/data/status/.aishore.lock` — clears concurrency lock
- "Another aishore process is running" but isn't → delete the lock file above

**Reinstall (preserves backlog):**
```bash
rm -rf .aishore && curl -sSL https://raw.githubusercontent.com/simonplant/aishore/main/install.sh | bash
.aishore/aishore init
```

**Quick reference:** `.aishore/aishore help`
