---
source_id: openclaw-discovery-2026-05-14
source_type: discovery
ingested: 2026-05-14
openclaw_version: "v2026.5.7"
container: openclaw-9cb388f3
image: openclaw:custom
status: active
---

# OpenClaw discovery — 2026-05-14

First run of [[/openclaw-sync]]. Inspecting the running engine for drift
against the v2026.4.12 seed reference.

## Engine observed

- **Version:** `v2026.5.7` (per `/app/package.json`)
- **Container:** `openclaw-9cb388f3` (warren instance, life-ops blueprint)
- **Image:** `openclaw:custom` (ClawHQ two-stage build, not upstream)
- **Install path:** `/app` — binary at `/usr/local/bin/openclaw`
- **Process:** `node dist/index.js gateway --bind lan --port 18789` (PID 7)
- **Uptime:** 23h, healthy

## Probes attempted

| Probe | Result |
|---|---|
| `docker ps --filter "name=openclaw"` | ✅ One container, healthy |
| `~/.clawhq/instances.json` | ✅ 5 instances registered (1 running, 4 init-reset scratch) |
| `docker exec <c> cat /app/package.json` | ✅ Version + upstream URL `github.com/openclaw/openclaw` |
| `openclaw --version` | ✅ `OpenClaw 2026.5.7` |
| `openclaw --help` | ✅ 40+ subcommands enumerated |
| `openclaw config schema` | ✅ 53,315-line JSON Schema, 42 top-level keys (not committed; regenerable) |
| `openclaw config validate` | ✅ subcommand exists |
| `grep openclaw-sync knowledge/log.md` | none — first run |

## Top-level schema keys (v2026.5.7)

All `object` unless noted. Total: 42 (including `$schema`).

```
accessGroups  acp  agents  approvals  audio  auth  bindings (array)
broadcast  browser  canvasHost  channels  cli  commands  commitments
crestodian  cron  diagnostics  discovery  env  gateway  hooks
logging  mcp  media  memory  messages  meta  models  nodeHost
plugins  proxy  secrets  session  skills  surfaces  talk  tools
ui  update  web  wizard
```

## Schema delta vs documented (v2026.4.12 → v2026.5.7)

**Added (21):** `accessGroups, acp, approvals, audio, bindings, broadcast,
canvasHost, cli, commands, commitments, crestodian, mcp, media, memory,
messages, nodeHost, proxy, surfaces, talk, web, wizard`

**Removed or renamed (5)** — provenance resolved by `jq`-walking the schema.
Pattern: three top-level config sections (`memorySearch`, `compaction`,
`contextPruning`) were demoted to `agents.defaults.*` so multi-agent setups
can override them per agent. Two (`identity`, `sandbox`) were split across
multiple new homes.

- `identity` → split: `agents.list[].identity.{name, theme, emoji, avatar}`
  (per-agent) + `ui.assistant.{name, avatar}` (UI-level). `name` replaces
  the old `displayName`.
- `memorySearch` → **demoted** to `agents.defaults.memorySearch.*`. Same
  provider/model/extraPaths/fallback preserved + new fields (cache,
  chunking, multimodal, qmd, sources, sync). The new top-level
  `memory.*` is unrelated (engine backend `builtin`/`qmd`, citation mode).
- `compaction` → **demoted** to `agents.defaults.compaction.*`. Fields
  renamed: `reserveTokensFloor` → `reserveTokens`. New: `mode`
  (default/safeguard), `provider` (pluggable summarizer),
  `keepRecentTokens`.
- `contextPruning` → **demoted** to `agents.defaults.contextPruning.*`.
  `mode, ttl, keepLastAssistants` preserved + new pruning controls
  (`hardClear*`, `softTrim*`, `tools`, `minPrunableToolChars`).
- `sandbox` → split: per-tool sandbox membership at
  `tools.sandbox.tools[]`; runtime config under
  `agents.defaults.agentRuntime.*`. CLI subcommand still exists.

### ClawHQ source-side hits (open bug)

`grep -rn` against the v2026.5.7 schema-relevant identifiers in `src/`:

| File:line | What it does | Action |
|---|---|---|
| `src/config/types.ts:149,197` | Declares top-level `memorySearch?` | Move under `agents.defaults` |
| `src/design/configure/generate.ts:237` | Emits top-level `memorySearch:` | Move to `agents.defaults.memorySearch` |
| `src/design/catalog/compiler.ts:1255` | Emits top-level `memorySearch:` | Same |
| `src/cli/commands/config.ts:8` | Comment already references `agents.defaults.compaction.reserveTokensFloor` | Comment correct (field name now `reserveTokens`); no code change |

The warren instance survives only because its `openclaw.json` was written
by an older ClawHQ build before the upstream demotion. A fresh
`clawhq init` against a v2026.5.7 engine will produce a config that
Gateway refuses to load.

**Unchanged (20):** `agents, auth, browser, channels, cron, diagnostics,
discovery, env, gateway, hooks, logging, meta, models, plugins, secrets,
session, skills, tools, ui, update`

## CLI surface drift

New top-level subcommands observed in `openclaw --help` not present in the
seed reference: `acp`, `approvals`, `capability` (alias `infer`),
`commitments`, `migrate`, `models`, `nodes` (plural — gateway-owned node
pairing), `pairing`, `proxy`, `sandbox`, `webhooks`, plus global flags
`--container <name>` and `--profile <name>`.

## External references discovered

- **Upstream repo:** `https://github.com/openclaw/openclaw`
- **Docs:** `https://docs.openclaw.ai/cli`

Both unrecorded in CLAUDE.md or the wiki. Worth adding to a future
ingest — they unlock `gh api` and web-fetch flows for the next sync.

## Reproducibility

```sh
docker exec openclaw-9cb388f3 cat /app/package.json | jq -r .version
docker exec openclaw-9cb388f3 openclaw config schema > schema.json
jq -r '.properties | keys[]' schema.json | sort
```

## Pending

- `docs/OPENCLAW-REFERENCE.md` rewrite (gated to major-version review per
  skill workflow — file as backlog item)
- New-section ingest: `acp`, `approvals`, `commitments`, `mcp`,
  `nodeHost`, `crestodian` — each warrants its own wiki page
- Bulk frontmatter migration: add `openclaw_version` to the other 44
  `openclaw/*`-tagged pages (deferred to incremental verification)
- ~~Confirm renames~~ — resolved 2026-05-14 (see Removed/renamed table
  above). `memorySearch`, `compaction`, `contextPruning` are genuinely
  gone (not renamed). `identity` and `sandbox` are split.
- Clawhq blueprint compiler audit: search `src/design/` for any code
  emitting `identity.*`, `memorySearch.*`, `compaction.*`,
  `contextPruning.*`, or top-level `sandbox.*` keys — those will fail
  Gateway validation on v2026.5.7 since unknown keys reject the config.
