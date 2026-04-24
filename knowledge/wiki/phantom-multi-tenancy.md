---
title: Phantom multi-tenancy
category: Decisions
status: active
date: 2026-04-23
tags: [clawhq, architecture, multi-tenancy, gap, boundaries]
---

# Phantom multi-tenancy

ClawHQ has data structures for managing multiple OpenClaw instances on one
host, but no lifecycle command consumes them. Registration works; operation
does not. This is the "phantom" — multi-tenancy appears to exist at the
registry layer but vanishes the moment you try to `doctor`, `log`, `backup`,
or `update` a specific agent.

## What works

- **Fleet registry** (`src/cloud/fleet/types.ts:24-28`) tracks multiple
  agents by name and `deployDir`.
- **Registration CLI** (`src/cli/commands/cloud.ts:202-233`): `clawhq cloud
  fleet register/list/unregister/doctor` reads and writes the registry.
- **Fleet doctor function** exists (`src/cloud/fleet/doctor.ts`:
  `runFleetDoctor()`), aggregating health across registered agents.
- **Cloud provisioning registry** (`~/.clawhq/cloud/instances.json`) tracks
  remote VMs across providers.
- **Initialization in separate directories** — `clawhq init` in
  `~/agent1/` and `~/agent2/` successfully creates two independent
  `clawhq.yaml` files.

## What doesn't work

- **No lifecycle command takes `--agent`**. `doctor`, `logs`, `backup`,
  `update`, `monitor`, `session` all default to the single deployment
  directory discovered by `resolveDefaultDeployDir()` in `src/cli/index.ts:54-88`.
- **No lifecycle command takes `--fleet`**. `runFleetDoctor()` exists but
  is only exposed as `clawhq cloud fleet doctor`, not as `clawhq doctor
  --fleet`. Two parallel command hierarchies never cross-wire.
- **Container name fallback is singleton-shaped**. `src/build/docker/container.ts:14`
  hardcodes `const FALLBACK = "engine-openclaw-1"`. If Docker label
  discovery fails and two local deployments both use compose project
  `engine` with service `openclaw`, container resolution races.
- **Ops state lives in the agent's deployment tree**. `ops/doctor/`,
  `ops/monitor/`, `ops/backup/snapshots/`, `ops/audit/`, `ops/firewall/`,
  `ops/updater/rollback/` all sit at `${deployDir}/ops/`. These are Layer 2
  (ClawHQ runtime state) by [[ownership-layers]], but they live inside
  Layer 4 (agent runtime).
- **Systemd timer scripts hardcode a single deploy dir**. Generated scripts
  (`src/operate/automation/scripts.ts:47-85`) bake in `DEPLOY_DIR` as an
  env var with no fleet iteration.
- **Credentials paths are singleton-scoped**. `src/cli/commands/operate.ts:54-77`
  loads `.env` from a single `${deployDir}/engine/.env` — no per-instance
  credential scoping at the ClawHQ layer.

## The scenario that breaks

```bash
$ cd ~/agent1 && clawhq init                    # OK — creates clawhq.yaml
$ cd ~/agent2 && clawhq init                    # OK — creates clawhq.yaml
$ clawhq cloud fleet register a1 ~/agent1       # OK — registered
$ clawhq cloud fleet register a2 ~/agent2       # OK — registered
$ clawhq cloud fleet list                       # OK — shows both

$ clawhq doctor                                 # AMBIGUOUS — walks up from cwd
$ clawhq logs -f                                # UNSCOPED — which agent?
$ clawhq backup create                          # UNSCOPED — which workspace?
$ clawhq up                                     # RACE — both containers named
                                                #   engine-openclaw-1
```

First breakage: `src/cli/index.ts:63-81` walks up from cwd looking for a
single `clawhq.yaml`. It returns the first match; there is no loop over the
fleet registry, no error on ambiguity, no selector argument.

## What is not broken

- **No "Clawdius" leaks in code**. Every hit for `clawdius` in source is a
  comment describing a past incident or canonical example; none are
  structural. The code itself is instance-name-agnostic. The singleton
  assumption is about *count*, not *name*.
- **Compilation is clean**. `src/design/catalog/compiler.ts` writes to a
  deployDir passed in, not a hardcoded path. The compiler can target any
  directory.
- **Workspace and engine are separated within a deployment**.
  `${deployDir}/engine/` vs `${deployDir}/workspace/` is a real boundary —
  the blur is between "ClawHQ ops state" and "agent workspace," not
  between agent engine and agent content.

## Fix sequence

See backlog items FEAT-186.5 through FEAT-191 for the prioritized work:

0. **FEAT-186.5** — Unified instance registry at `~/.clawhq/instances.json`
   (see [[instance-registry]]). Precursor — every later step looks up by
   stable instance-id.
1. **FEAT-187** — `--agent <name>` on every lifecycle command; ambiguity
   becomes an error, not a silent default.
2. **FEAT-188** — Wire the fleet registry into lifecycle commands
   (`--fleet` flag iterates; cross-wire `clawhq doctor --fleet`).
3. **FEAT-189** — Instance-scoped Docker container naming; kill the
   `engine-openclaw-1` fallback.
4. **FEAT-190** — Move ClawHQ ops state out of `${deployDir}/` into
   `~/.clawhq/instances/<id>/ops/` (Layer 2).
5. **FEAT-191** — Separate identity templates (Layer 2) from compiled
   identity files (Layer 4).

## Related

- [[ownership-layers]] — the five-layer model this page measures against
- [[instance-registry]] — unified Layer 2 registry that unblocks the fix chain
- [[lifecycle-management-gap]] — broader market gap; this page is the
  specific shape of the internal gap
- [[blueprint-system]] — compilation is clean; this gap is not there
