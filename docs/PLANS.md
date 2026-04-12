# ClawHQ — Engineering Plans

Status as of 2026-04-11. Each plan is independent and sprint-ready.

---

## PLAN-01: Multi-Account Email via Provider System

### Problem
Email is currently one-provider-per-agent. Users need multiple accounts (personal + agent inbox). The composition model assumes `providers: { email: gmail }` — one domain, one provider. Multi-account breaks this assumption.

### Design
Extend the provider domain model to support multiple providers per domain:

```yaml
# clawhq.yaml
composition:
  providers:
    email: fastmail-jmap           # primary (Simon's inbox)
    email-agent: icloud-mail       # secondary (Clawdius's own inbox)
```

**Layer 1 (ClawHQ platform):**
- Add `icloud-mail` provider to `src/design/catalog/providers.ts` (IMAP, imap.mail.me.com)
- `fastmail-jmap` provider already exists
- email-fastmail.py is already a static tool asset
- Need himalaya config generation for IMAP providers

**Layer 2 (Composition):**
- Compiler resolves multi-domain providers: `email` + `email-agent` both map to email tools
- Each provider gets its own env var prefix: `FASTMAIL_*`, `ICLOUD_*`
- Each gets its own proxy route if applicable
- Each gets its own egress domains in the allowlist

**Layer 3 (User config):**
- `clawhq integrate add fastmail-jmap` stores FASTMAIL_API_TOKEN
- `clawhq integrate add icloud-mail` stores ICLOUD_IMAP_* credentials
- `clawhq apply` regenerates tools and proxy routes for both

### Key changes
- `src/design/catalog/providers.ts` — add icloud-mail provider
- `src/design/catalog/compiler.ts` — support `email-*` multi-domain providers
- Himalaya config generation — new capability, generates config.toml from provider env vars
- `src/design/tools/email.ts` — tool needs `--account` flag to select provider

### Verification
- `clawhq integrate add icloud-mail -d /path` prompts for credentials
- `clawhq apply` produces two email tools (fastmail + icloud)
- Both work from inside the container

---

## PLAN-02: Cron Job Persistence Across Apply

### Problem
`clawhq apply` overwrites `cron/jobs.json` with compiled output. OpenClaw hot-reloads the file. Custom cron jobs added by the agent or user (via OpenClaw UI) are lost on every apply.

### Design
Two categories of cron jobs:
1. **Profile jobs** — from `cron_defaults` in the profile YAML. Compiled by ClawHQ.
2. **User jobs** — added via OpenClaw UI, agent skills, or manual config. NOT managed by ClawHQ.

**Solution:** The compiler generates profile jobs into `cron/jobs-clawhq.json`. A merge step combines this with existing `cron/jobs.json`, preserving user jobs that aren't in the profile.

### Key changes
- `src/design/catalog/compiler.ts` — write to `cron/jobs-clawhq.json` instead of `cron/jobs.json`
- `src/evolve/apply/index.ts` — merge step: read existing `jobs.json`, merge with compiled `jobs-clawhq.json`, write result to `jobs.json`
- Merge rule: profile job IDs overwrite, user job IDs are preserved

### Verification
- Add a custom cron job via OpenClaw UI
- Run `clawhq apply`
- Custom job still exists in `cron/jobs.json`

---

## PLAN-03: Egress Firewall Without ipset

### Problem
The egress firewall requires `ipset` to create domain-based ACCEPT rules. Without ipset, the firewall creates DROP rules with no ACCEPT rules, blocking ALL egress. Current workaround: `security.firewallDisabled: true` in clawhq.yaml.

### Design
Replace ipset-based filtering with individual iptables rules per resolved IP. Less efficient (more rules) but works without additional packages.

### Key changes
- `src/build/launcher/firewall.ts` — when ipset unavailable, fall back to per-IP iptables rules
- Each domain resolves to 1-3 IPs → 1-3 ACCEPT rules per domain per port
- Refresh on a timer (IPs change) using existing `startIpsetRefresh` logic adapted for per-IP rules

### Verification
- Remove ipset from system
- `clawhq up` applies firewall with per-IP rules
- Container can reach allowed domains, blocked domains timeout

---

## PLAN-04: Blueprint → Composition Migration

### Problem
Two compilation paths exist. The blueprint path (`generateBundle`) and composition path (`compile`) produce different outputs. The composition path is the future but blueprints still exist for backward compatibility.

### Design
Make blueprints resolve to compositions:

```
Blueprint YAML → resolve to { profile, personality, providers } → compile()
```

Each blueprint maps to:
- A profile ID (the tool/skill/cron configuration)
- A personality ID (the communication style)  
- Default provider selections
- Customization questions (remain blueprint-specific)

### Key changes
- `src/design/blueprints/loader.ts` — add `resolveToComposition(blueprint): CompositionConfig`
- `src/cli/commands/design.ts` — `--blueprint` flag resolves to composition then compiles
- Remove `generateBundle()`, `bundleToFiles()`, `validateBundle()` after migration
- Keep blueprint validation (70+ checks) as a standalone validation step

### Verification
- `clawhq init --blueprint email-manager` produces identical output to composition path
- All existing blueprint tests pass
- `generateBundle` can be removed without breaking anything

---

## PLAN-05: Static Tool Asset Testing

### Problem
Static tool assets (configs/tools/) are shell/python scripts with no automated testing. A broken tool deploys silently. The sanitizer, proxy routes, and tool help all need verification.

### Design
Add a `tool-audit` test that:
1. Loads each static tool asset
2. Verifies it's executable (shebang line)
3. Verifies `--help` or `help` subcommand works
4. Verifies proxy-first pattern (CRED_PROXY_URL check) where applicable
5. Verifies sanitizer integration (_sanitize function present)
6. Verifies no hardcoded personal references (simon, clawdius, etc.)

### Key changes
- `src/design/tools/tools.test.ts` — add static asset audit tests
- Iterate all dirs in `configs/tools/`
- Verify conventions

### Verification
- All static tools pass the audit
- Adding a new static tool without the sanitizer function fails the test

---

## PLAN-06: clawhq doctor Integration Test

### Problem
The doctor has 30 checks but no integration test against a real deployment. The unit tests use mocked fixtures. A real `clawhq doctor -d /path` against a running deployment would catch the issues we found (wrong container inspected, stale iptables, etc.).

### Design
Add a `doctor.integration.test.ts` that:
1. Spins up a minimal test deployment (docker compose up)
2. Runs `runDoctor()` against it
3. Verifies all checks pass or have expected warnings
4. Tears down

This is a slow test (30+ seconds) — tagged for CI, not default `vitest run`.

### Verification
- Test passes against a clean deployment
- Test catches the "wrong container inspected" bug we fixed

---

## Priority Order

1. **PLAN-02** (cron persistence) — prevents data loss on every apply, small scope
2. **PLAN-01** (multi-account email) — unblocks Clawdius email, user-facing
3. **PLAN-03** (firewall without ipset) — security, medium scope
4. **PLAN-05** (static tool testing) — quality, small scope
5. **PLAN-04** (blueprint migration) — tech debt, large scope
6. **PLAN-06** (doctor integration test) — quality, medium scope
