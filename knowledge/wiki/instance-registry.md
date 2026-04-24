---
title: Instance registry
category: Decisions
status: planned
date: 2026-04-23
tags: [clawhq, architecture, multi-tenancy, registry, layer-2]
---

# Instance registry

Unified local registry of every OpenClaw instance ClawHQ manages — local
deployments and cloud VMs in one file, keyed by stable uuid, with a
user-friendly name as a secondary index. Anchors Layer 2 (ClawHQ runtime
state) in the [[ownership-layers]] model and unblocks the fix chain in
[[phantom-multi-tenancy]].

## Context

Today ClawHQ splits "knowledge of what it manages" across two files:

- **`~/.clawhq/cloud/fleet.json`** — `FleetAgent` records for local
  deployments (`src/cloud/fleet/types.ts:15-22`). Key: human-chosen name.
  No id. `deployDir` is the only pointer.
- **`~/.clawhq/cloud/instances.json`** — `ProvisionedInstance` records for
  cloud VMs only (`src/cloud/provisioning/types.ts:287-312`). Has uuid,
  status, provider details.

Two registries, same concept, different shape. No lifecycle command reads
either — they only power `clawhq cloud fleet *` and `clawhq cloud provision`.
The singleton CLI resolver (`src/cli/index.ts:54-88`) walks up from cwd and
picks the first `clawhq.yaml` it finds.

## Prior art

Every CLI that manages multiple things-of-the-same-kind converges on the
same shape: **one flat registry, id-keyed, with a current-pointer and a
per-command override flag.**

| Tool | Registry | Id key | Override |
|------|----------|--------|----------|
| kubectl | `~/.kube/config` | context name | `--context` |
| docker | `~/.docker/contexts/meta/` | content-hash | `--context` / `DOCKER_CONTEXT` |
| aws cli | `~/.aws/config` | profile name | `--profile` / `AWS_PROFILE` |
| gcloud | `~/.config/gcloud/configurations/` | config name | `CLOUDSDK_ACTIVE_CONFIG_NAME` |
| podman machine | `~/.config/containers/podman/machine/` | machine name | `--name` |

Invariants:

- **One registry file**, not split by "kind" (local vs cloud).
- **Id is stable; name is aliasable**. Renames don't break references.
- **Ambiguity is an error** (podman-machine refuses to act when multi and no `--name`).
- **Per-command override > env > active pointer > single-default**.
- **Registry is a projection** — ground truth lives with the thing itself
  (`clawhq.yaml` on disk), registry is the fast index.

## Decision

Create a single machine-global registry at `~/.clawhq/instances.json`.
Fold `fleet.json` and `cloud/instances.json` into it. Mint a uuid per
instance at `clawhq init`. Store it in the instance's `clawhq.yaml` as
`instanceId`. The registry is a projection; `clawhq.yaml` is the truth.

### Record shape

```ts
interface Instance {
  readonly id: string;                // uuid, minted at clawhq init
  readonly name: string;              // unique human label
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: InstanceStatus;    // advisory, not authoritative
  readonly blueprint?: string;
  readonly location: InstanceLocation;
}

type InstanceStatus =
  | "initialized"   // clawhq.yaml exists, not built
  | "built"         // images built, not running
  | "running"       // container up
  | "stopped"       // container exists but down
  | "unhealthy"     // last health check failed
  | "destroyed";    // explicitly destroyed

type InstanceLocation =
  | { readonly kind: "local"; readonly deployDir: string }
  | {
      readonly kind: "cloud";
      readonly provider: CloudProvider;
      readonly providerInstanceId: string;
      readonly ipAddress: string;
      readonly region: string;
      readonly size: string;
      readonly sshKeyPath?: string;
      readonly sshHostKey?: string;
    };
```

### Resolution order (FEAT-187)

```
--agent <name|id-prefix>              (flag)
  → CLAWHQ_AGENT=<name|id-prefix>     (env var)
  → ~/.clawhq/current                 (pointer file)
  → cwd walk-up finds clawhq.yaml     (reverse-lookup instanceId → registry)
  → registry has exactly one entry    (single-tenant backwards-compat)
  → error, list registered instances
```

### Paths

```
~/.clawhq/
├── instances.json              # the registry
├── current                     # text file: <instanceId> or empty
└── instances/<instanceId>/     # Layer 2 per-instance ops state (per FEAT-190)
    └── ops/
```

### What does NOT go in the registry

- Credentials — stay in `${deployDir}/engine/.env`, mode 0600
- Workspace content — Layer 4, never in Layer 2 metadata
- Blueprint YAML — reproduced from `clawhq.yaml` + blueprint library
- Compiled outputs — re-derivable from blueprint at `clawhq apply`
- Any secret of any kind

### State is advisory

`status: "running"` means "last we checked." Every lifecycle command
reconciles against Docker before acting. `clawhq doctor` or a new
`clawhq instance reconcile` heals stale entries.

## Options considered

**A. Extend `FleetAgent` to include id and status.** Rejected — leaves
two registries and doesn't solve the cloud/local split.

**B. Extend `ProvisionedInstance` with an optional local-location variant.**
Rejected — the existing type is cloud-shaped at the root (provider,
providerInstanceId, ipAddress are required). Tagged union on `location`
is cleaner than optional-everything.

**C. New unified registry; deprecate `fleet.json` + `cloud/instances.json`
via migration.** Chosen — clean types, one read path, aligns with prior
art.

## Consequences

**Positive:**

- One call to resolve "which agent am I operating on" across the whole CLI.
- FEAT-187 (`--agent` arg) becomes a thin lookup; FEAT-188 (`--fleet` iteration)
  is a trivial `listInstances()` loop.
- Cloud and local instances share lifecycle commands. `clawhq doctor --agent foo`
  works whether `foo` is a local container or a DO droplet.
- FEAT-190 (ops state relocation) has a natural home: `~/.clawhq/instances/<id>/ops/`
  where `<id>` is the registry id.

**Negative:**

- Tagged union on `location` — callers that only care about local or cloud
  must discriminate. Acceptable; most callers want the instance, not the kind.
- Migration is one-shot and must be idempotent. Legacy `fleet.json` and
  `cloud/instances.json` retained as `.bak` for one version cycle.
- `clawhq.yaml` gains a top-level `instanceId` field. Schema change is
  additive and optional (missing id = minted on next `clawhq apply`).

## Fix sequence implication

FEAT-186.5 (this design, foundation code) precedes FEAT-187. Updated
dependsOn chain:

```
FEAT-186.5 (instance registry foundation)
  → FEAT-187 (--agent arg, uses registry)
    → FEAT-188 (--fleet flag)
    → FEAT-189 (container naming uses instanceId)
    → FEAT-190 (ops relocation to ~/.clawhq/instances/<id>/)
      → FEAT-191 (identity template split)
```

## Related

- [[phantom-multi-tenancy]] — the gap this unblocks
- [[ownership-layers]] — registry is canonical Layer 2
- [[blueprint-system]] — `clawhq.yaml` gets a new `instanceId` field
