# Log

## [2026-04-22] migrate | Import 48 pages from prior subject/type wiki into native llm-wiki flat layout

**Source:** `raw/research/` (pre-migration wiki, preserved for reference)
**Primary source:** `raw/openclaw-reference-v2026-4-14.md`
**Pages created:** 48

Imported 48 pages from a prior custom-schema wiki (subject × type hierarchy:
openclaw / clawhq / cross × concept / component / architecture / configuration /
operation / security / landmine / pattern / finding / comparison) into the flat
llm-wiki `product` schema. Category mapping:

- concept, security, landmine, pattern → **Decisions** (26)
- component, architecture, configuration, operation → **Features** (18)
- finding → **Metrics** (3)
- comparison → **Competitors** (1)
- (no Personas yet)

Path-style cross-references (`[[subject/type/slug]]`) rewritten to slug-based
(`[[slug]]`). Frontmatter rewritten to product template shape: title, category,
status, date, tags (subject + type folded into tags for recovery).

Prior wiki tree retained under `raw/research/` for provenance — do not treat
as authoritative; `wiki/` is the source of truth going forward.

Known lint: 5 orphans (pages no one cross-links), 1 false-positive on the
Sources entry in index.md (lint only checks wiki/, but ingest writes Sources
entries that reference raw/).

## [2026-04-23] init | Wiki created

Initialized LLM Wiki instance.

## [2026-04-23] query | Email audit → stress-tested proposal → filed [[provider-profile-layer]] as deferred

Ran an end-to-end email audit across ClawHQ source + Clawdius runtime state.
Found:

- Dual compile surfaces: legacy `src/design/configure/generate.ts::generateBundle`
  (now seeds-only) vs canonical `src/design/catalog/compiler.ts::compile`
  (invoked by `clawhq apply` via `src/evolve/apply/index.ts:23`).
- Himalaya config generator IS wired (contradicting the 2026-04-16 memory
  note). File present on Clawdius at `workspace/config/himalaya/config.toml`
  but with empty `email = ""` / `backend.login = ""` because wizard didn't
  collect slot-2 credentials.
- Five gaps: wizard slot iteration (bug), no `probeEmail`, wizard ignores
  provider catalog, no cadence customization, approval name drift.

Initial proposal: promote `providers.ts` to a first-class provider-profile
layer. Stress-tested with thinking-toolkit (attack/defence/verdict + hidden
assumptions). Verdict: over-architecting. The five gaps don't share a root
cause; the most concrete gap is a loop bug, not a structural problem.
Four IMAP providers of identical shape don't justify a type abstraction.

**Filed [[provider-profile-layer]] as a deferred Decision** — captures the
proposal, the reasoning against, and the three conditions under which it
becomes right (OAuth/JMAP/Bridge provider, wizard branching > 100 lines,
diverging probes). Prevents the proposal being re-surfaced without the
preconditions being met.

**Corrected [[email-integration]]** — the "Known gap (2026-04-16)" section
claimed the himalaya config generator was missing. That was stale. Replaced
with the five real gaps plus a link to [[provider-profile-layer]] so the
next reader sees why the obvious layering response isn't the right call.

**Updated memory** `project_clawdius_toolfix_20260416` to mark the
himalaya-config-generator gap resolved and record the slot-iteration bug
and missing probe as the current state.

## [2026-04-23] query | Architectural boundary audit → filed [[ownership-layers]] + [[phantom-multi-tenancy]]

**Question:** Simon asked for a deep review of boundaries in the ClawHQ
codebase. Concerns: (1) multiple layers of code/config blurred, (2) no
first-class concept of multi-tenancy (ClawHQ managing N OpenClaw instances
locally), (3) confused ownership between ClawHQ, claw instances, and
instance-specific configuration.

**Scope:** Full repo audit via Explore subagent. Mapped five ownership
layers (ClawHQ code / ClawHQ runtime state / OpenClaw upstream / managed
agent / fleet) and checked where each lives today.

**Findings:**

- **Phantom multi-tenancy.** `FleetRegistry` exists (`src/cloud/fleet/`),
  `clawhq cloud fleet register/list/doctor` works, but no lifecycle command
  (doctor, logs, backup, update, monitor, session) takes `--agent <name>`
  or `--fleet`. `resolveDefaultDeployDir()` in `src/cli/index.ts:54-88`
  walks up from cwd and returns the first `clawhq.yaml` — two local
  deployments silently shadow each other.
- **Container name fallback hardcoded singleton.** `src/build/docker/container.ts:14`
  — `const FALLBACK = "engine-openclaw-1"`. If Docker label discovery
  fails and two deployments use compose project `engine`, resolution races.
- **Ops state mixed with agent workspace.** `${deployDir}/ops/{doctor,monitor,backup,audit,firewall,updater}`
  holds Layer 2 (ClawHQ runtime metadata) inside Layer 4 (agent filesystem).
  Backups of `deployDir/` conflate agent content with ops state.
- **Identity templates not separated from compiled files.** Compiler
  generates `workspace/SOUL.md`, `workspace/AGENTS.md` etc directly — no
  `~/.clawhq/templates/identity/` source store.
- **No "Clawdius" leaks in code.** All `grep -i clawdius` hits are comments
  or incident references, not structural dependencies. The code is
  instance-name-agnostic; the singleton assumption is about *count*, not
  *name*.

**Filed [[ownership-layers]]** (Decisions) — canonical five-layer model
with rules and how-to-apply guidance. Linked from the new **Ownership
Layers** section in `CLAUDE.md` so every session sees it.

**Filed [[phantom-multi-tenancy]]** (Decisions) — concrete gap with
file:line evidence, the scenario that breaks, what is not broken, and a
pointer to the fix sequence.

**Backlog:** FEAT-186 (pre-existing ungroomed umbrella) groomed with audit
detail. Added children FEAT-187 (--agent arg) → FEAT-188 (fleet wiring) →
FEAT-189 (container naming) → FEAT-190 (ops relocation) → FEAT-191
(identity template split).

**Memory:** filed `project_phantom_multi_tenancy` pointing at both wiki
pages and the backlog chain.

## [2026-04-23] query | Instance registry design → filed [[instance-registry]] + FEAT-186.5

**Question:** "Do we need a walking skeleton for the multi-tenancy
restructuring?" and "How does other software handle multi-tenancy
configuration management?"

**Outcome:** Skeleton rejected — the architecture is clear enough. The
real missing piece is a stable instance-id and a unified registry that
every lifecycle command can resolve through. Prior art (kubectl, docker,
aws cli, gcloud, podman-machine) all converge on the same shape: one flat
registry keyed by id, name as alias, current-pointer + per-command
override, ambiguity errors.

**Filed [[instance-registry]]** (Decisions) — unified `~/.clawhq/instances.json`
design. Tagged-union `location` field carries either local `deployDir` or
cloud `providerInstanceId` + IP + region. Resolution order: `--agent` >
`CLAWHQ_AGENT` > `current` > cwd-walk > single-default > error. Replaces
today's split between `fleet.json` (local) and `cloud/instances.json`
(cloud).

**Backlog:** added FEAT-186.5 as precursor to FEAT-187 (foundation — types,
read/write, paths). Repointed FEAT-187 `dependsOn` at FEAT-186.5 so the
chain is 186.5 → 187 → (188, 189, 190) → 191.

**Code:** scaffolded `src/cloud/instances/` with `types.ts`, `registry.ts`,
and tests. Legacy `fleet.json` + `cloud/instances.json` still the active
readers — new module coexists; migration lands with FEAT-187.

## [2026-04-23] query | Shipped FEAT-186.5 + FEAT-187 (unified registry + --agent flag)

Four commits landed (4a4230a → b67b573 → 83d0240 → ef2d0e3 → 851ec4c):

- **Slice A (b67b573)** — resolver module: `src/cloud/instances/resolver.ts`
  with precedence `--agent > CLAWHQ_AGENT > ~/.clawhq/current > cwd-walk >
  single-default > error`. Env/cwd/root all injectable.
- **Slice B (83d0240)** — migration: one-shot idempotent fold of legacy
  `cloud/fleet.json` + `cloud/instances.json` into the unified
  `instances.json`. Cloud entries preserve uuid; fleet entries mint fresh.
  Collisions resolved with `-local-<6hex>` suffix on the fleet entry;
  legacy files moved to `.migrated.bak`.
- **Slice C (ef2d0e3)** — mint-on-init: `clawhq init` mints a uuid,
  embeds it in `clawhq.yaml` as `instanceId`, and registers the
  deployment. Handles `--reset` by dropping stale entries for the same
  deployDir. Name falls back to `clawhqConfig.instanceName ||
  basename(deployDir)` with `-2` suffixing on collision.
- **Slice D (851ec4c)** — CLI wiring: `src/cli/resolve-deploy-dir.ts`
  resolves argv/env/cwd/registry → deployDir. Registered `--agent` as
  a global option on the program. CLI bootstrap runs migration
  idempotently. Ambiguous invocations (multi-registered, no selector)
  print a helpful error listing registered names and exit 1.

**Tests:** 2128 total (up 55 from the start of this sprint); all green.

**Smoke-verified:**
- Two registered agents, no --agent → error with list of names, exit 1
- `--agent clawdius` → resolves to that instance's deployDir

**Backlog:** FEAT-186.5 and FEAT-187 marked done. FEAT-188 / 189 / 190
are now unblocked (all depend on FEAT-187); FEAT-191 chains after
FEAT-190.

## [2026-04-23] query | Email default behaviour + permissions → filed as [[email-integration]]

Synthesized answer from [[integration-layer]], the Email Manager blueprint in
`docs/OPENCLAW-REFERENCE.md`, [[credential-health-probes]], and
[[egress-firewall]]. No single page covered email end-to-end despite it being
a first-class integration category.

Filed a new Features page `[[email-integration]]` covering tool surface
(himalaya + `workspace/email` wrapper, commands, providers), permissions
(autonomy gates on `sending_messages`, first-contact rule, approve-action
routing, read-only identity mount), network posture (allowlist egress, port-
aware rules), health & lifecycle (probe + 15-min triage + `email-digest`
skill), and adjacent landmines.

Page records the known gap: `himalaya` config generator is not yet produced
by `clawhq apply` on Clawdius (from 2026-04-16 toolfix triage). Tool,
permissions, and egress layers are wired — compile step is not.
