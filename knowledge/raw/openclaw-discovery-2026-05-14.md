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

**Removed or renamed (5):**
- `identity` — gone from top level (likely moved under `agents.*` or `ui.*`)
- `memorySearch` — almost certainly renamed to `memory`
- `compaction` — likely folded into `session.*` or `memory.*`
- `contextPruning` — likely folded into `session.*` or `memory.*`
- `sandbox` — gone from top level despite `sandbox` CLI subcommand still existing

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
- Confirm renames: `memorySearch` → `memory`, where `identity`,
  `compaction`, `contextPruning`, `sandbox` moved
