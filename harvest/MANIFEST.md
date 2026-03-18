# Harvest Manifest

> Archived 2026-03-17. Full codebase snapshot before clean rebuild.
> Extract: `tar xzf codebase-2026-03-17.tar.gz`

## Quality Grades (from code audit)

### SHIP — Pull back as-is (19 files)

| Module | Files | Why |
|--------|-------|-----|
| `gateway/` | websocket.ts, health.ts | Battle-tested RPC client. Custom errors, AbortSignal, memory-safe. |
| `build/launcher/` | deploy.ts, preflight.ts | Full deploy orchestration. 6 preflight checks with fix guidance. |
| `secure/firewall/` | firewall.ts, iptables.ts | Real iptables wrapper. Idempotent apply, air-gap support, verification. |
| `build/docker/` | build.ts, hardening.ts | Two-stage caching, 4 posture levels, manifest verification. |
| `secure/secrets/` | scanner.ts, env.ts | Comprehensive patterns, atomic writes, git history scan. |
| `secure/credentials/` | index.ts | Clean probe-based architecture. |
| `operate/backup/` | backup.ts, restore.ts | SHA-256 integrity, temp dir isolation, post-restore doctor. |
| `operate/doctor/` | runner.ts | 11 checks, try-catch per check. |
| `config/` | schema.ts, validator.ts, loader.ts | All 14 landmine rules. Clean types. Precedence merging. |
| `design/configure/` | wizard.ts, writer.ts | Full wizard. Atomic writes with temp+rename, 0600 perms. |

### HARVEST — Good bones, pull back with cleanup (4 files)

| File | Issues to fix |
|------|---------------|
| `design/configure/generate.ts` | Hardcoded `~/.openclaw`, weak cron parsing, missing null checks |
| `design/blueprints/mapper.ts` | No input validation, slug collision, unclear responsibilities |
| `evolve/skills/lifecycle.ts` | URL support is NOT_IMPLEMENTED trap, naive path handling |
| `evolve/skills/vet.ts` | Patterns too aggressive, every real skill would fail |

### Worth referencing (not audited individually, but working)

- `cli/` — 40 command files, all wired and tested
- `operate/alerts/` — Predictive health with trend analysis
- `operate/repair/` — Docker/gateway/firewall self-healing
- `operate/status/` — 4-section dashboard collector
- `operate/updater/` — Version check, changelog, rollback
- `evolve/memory/` — Hot/warm/cold tiers with transitions
- `evolve/autonomy/` — Recommendation engine
- `evolve/learning/` — Preference accumulation
- `evolve/trace/` — Decision explanation with Ollama
- `evolve/migrate/` — ChatGPT + Google Assistant import
- `design/inference/` — Ollama-powered smart init
- `design/connect/` — Telegram + WhatsApp channel setup
- `design/governance/` — Identity budget + staleness checks
- `design/roles/` — 6 role presets
- `design/provider/` — LLM provider add/remove/test
- `cloud/fleet/` — Multi-agent discovery + dashboard
- `server/` — Hono web server with SSE/WS
- `ui/` — Dashboard pages (doctor, logs, deploy, approvals, skills, init wizard)

## Blueprint YAML Templates (configs/templates/)

6 working templates: Family Hub, Founder's Ops, Replace ChatGPT Plus,
Replace Google Assistant, Replace my PA, Research Co-pilot.

Full YAML schema with validation in `design/blueprints/loader.ts`.

## Test Coverage

132 test files, 1745 tests passing at time of archive.
