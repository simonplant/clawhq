# ClawHQ Build Brief — Clean Restart

> For the developer agent driving aishore sprints.
> Read this before your first sprint. Reference it when you get stuck.

## What You're Building

ClawHQ forges purpose-built agents from blueprints. A user picks a blueprint ("Email Manager", "Stock Trading Assistant"), customizes it, and ClawHQ produces a hardened, running OpenClaw agent with a messaging UI. Read `docs/PRODUCT.md` for the full vision, `docs/ARCHITECTURE.md` for the technical design.

## Current State

**The repo is a clean scaffold.** `src/` has the 6-module directory structure and one file (`cli/index.ts`). Everything else was archived.

**There is a harvest archive** at `harvest/codebase-2026-03-17.tar.gz` containing a prior implementation (90K LOC, 1745 passing tests). A quality audit graded every critical module — see `harvest/MANIFEST.md`. Most modules are production-ready (SHIP grade). Some need cleanup (HARVEST grade).

**The backlog** (`backlog/backlog.json`) has 42 items derived from the core docs. 30 of them reference specific harvest files you should pull back instead of writing from scratch.

## How to Use the Harvest

When a backlog item's `groomingNotes` says "HARVEST: secure/firewall/firewall.ts (SHIP 95%)", do this:

1. Extract: `tar xzf harvest/codebase-2026-03-17.tar.gz src/secure/firewall/`
2. Read the extracted code
3. Adapt it — fix any issues noted in the grooming notes (hardcoded paths, missing null checks, etc.)
4. Write tests if the harvest didn't include them (it usually did)
5. Wire it into the current codebase (imports, CLI registration, etc.)

When grooming notes say "HARVEST 60% — patterns too aggressive", treat it as reference material, not copy-paste. Read it, understand the approach, then write a better version.

When there's no harvest reference ("NEW — no harvest"), build from scratch using the docs as spec.

## Sprint Rules

### 1. Foundation First

Items CQ-001, CQ-002, and CQ-013 must land before anything else. They establish:
- Config types + 14 landmine validator (everything depends on these types)
- Gateway WebSocket client (all OpenClaw communication goes through this)
- CLI entry point + UX helpers (every command registers here)

### 2. One Item, One Sprint, One Commit

Each sprint implements exactly one backlog item. Don't scope-creep. If you discover something missing, file it as a note in the commit message — don't build it.

### 3. Respect Dependencies

If a backlog item has `dependsOn`, those items must be `done` first. Don't stub dependencies — wait for them to be built properly.

### 4. Every Sprint Must Pass

Before committing:
```bash
npx tsc --noEmit          # Zero type errors
npm test                  # All tests pass (vitest)
node dist/cli/index.js    # CLI boots (after npm run build)
```

If any of these fail, fix them before marking done. Don't skip validation.

### 5. Import Paths Are Relative

No path aliases. No barrel re-exports across module boundaries. Imports use relative paths (`../../config/schema.js`). This keeps the dependency graph explicit and prevents circular imports.

### 6. Tests Live Next to Code

`foo.ts` → `foo.test.ts` in the same directory. Use vitest. Mock external dependencies (Docker, iptables, filesystem) — never call real system commands in tests.

### 7. Follow Existing Conventions

Read `CLAUDE.md` for terminology, architectural decisions, and constraints. Key rules:
- **Flat CLI** — `clawhq doctor`, never `clawhq operate doctor`
- **Tight coupling to OpenClaw** — use its schema directly, no abstraction layer
- **Blueprint not template** — use canonical terminology
- **SOUL.md not IDENTITY.md** — for the agent's personality file

## Handling Structural Issues

If you encounter a pattern that's wrong or missing across multiple files (wrong import convention, missing error handling pattern, inconsistent types), fix it in the current sprint's scope and note the pattern fix in your commit message. Don't create separate "refactor" sprints for things you can fix as you go.

If the issue is outside your sprint's scope (e.g., a bug in a different module), add it to `backlog/bugs.json`:

```bash
.aishore/aishore backlog add --type bug --title "Description" --priority must --ready
```

## Driving Progress

You are responsible for backlog completion. After each sprint:
- If you hit a blocker that's not in the backlog, add it
- If a dependency is missing that should exist, add it
- If the sprint order in `backlog/backlog.json` `_sprint_order` needs adjustment based on what you learned, note it in your commit

The goal is a working `clawhq quickstart` that takes a user from zero to running agent in under 5 minutes. Every sprint should move toward that.

## Quick Reference

| What | Where |
|------|-------|
| Product vision | `docs/PRODUCT.md` |
| Technical architecture | `docs/ARCHITECTURE.md` |
| OpenClaw internals | `docs/OPENCLAW-REFERENCE.md` |
| Project conventions | `CLAUDE.md` |
| Backlog | `backlog/backlog.json` |
| Harvest archive | `harvest/codebase-2026-03-17.tar.gz` |
| Harvest quality grades | `harvest/MANIFEST.md` |
| Blueprint YAML examples | `configs/templates/*.yaml` |
| Sprint state | `backlog/sprint.json` |
