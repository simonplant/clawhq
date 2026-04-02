# memory-maintenance

MEMORY.md hygiene skill. Every 3 days, reviews the memory file for stale entries, contradicted facts, and noise that's accumulated. Proposes a cleaned version for approval before writing. Never deletes silently.

## Behavior

1. Read memory — Load the current MEMORY.md.
2. Review entries — Identify: stale (outdated, superseded), noise (low-value observations, duplicates), and contradicted (newer information invalidates older entry).
3. Propose changes — List entries to remove and entries to update. Show before/after.
4. Gate — Present the proposed changes for approval. Label it: `memory-maintenance: [date]`.
5. Apply — Once approved, write the updated MEMORY.md.

## Review Criteria

**Stale**: Entry references a situation that no longer exists (old address, resolved issue, past date)
**Noise**: Entry is a one-time observation that hasn't proven useful for patterns
**Contradicted**: A newer entry says the opposite
**Promote**: Recent daily log entries with a clear pattern → promote to MEMORY.md

## Boundaries

- MEMORY.md changes are approval-gated. Never modify silently.
- Only touches MEMORY.md — never modifies daily logs, USER.md, or SOUL.md.
- Runs every 3 days, not daily. Memory rot is slow; so is the fix.

## Schedule

Every 3 days at 2:00 AM via blueprint cron config.

## Execution

Declarative skill. Trigger: "Run skill: memory-maintenance". Load this SKILL.md, execute prompts.

### Prompts

- prompts/review.md — Memory entry review and change proposal

## Model Requirements

- Provider: Cloud preferred for context-aware review
- Minimum model: llama3:8b
