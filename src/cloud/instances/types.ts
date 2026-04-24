/**
 * Types for the unified instance registry — every OpenClaw instance ClawHQ
 * manages, local or cloud, in one Layer 2 record.
 *
 * See knowledge/wiki/instance-registry.md for the design rationale, prior-art
 * comparison (kubectl, docker, aws cli, gcloud, podman-machine), and the
 * `--agent` resolution order this registry powers.
 *
 * This module coexists with the legacy registries (src/cloud/fleet/ for local,
 * src/cloud/provisioning/ for cloud). Migration folds those into this one and
 * is scheduled for FEAT-187; nothing reads this registry from lifecycle
 * commands yet.
 */

import type { CloudProvider } from "../provisioning/types.js";

// ── Status ──────────────────────────────────────────────────────────────────

/**
 * Advisory status — what we last observed. Never trusted by lifecycle
 * commands without reconciling against Docker / the provider first.
 */
export type InstanceStatus =
  | "initialized"   // clawhq.yaml exists, not yet built
  | "built"         // images built, not running
  | "running"       // container up (or cloud VM active)
  | "stopped"       // container exists but down
  | "unhealthy"     // last health check failed
  | "destroyed";    // explicitly destroyed via clawhq destroy

// ── Location ────────────────────────────────────────────────────────────────

/** An instance running locally — a deployDir on this host. */
export interface LocalInstanceLocation {
  readonly kind: "local";
  /** Absolute path to the deployment directory (`${deployDir}/engine/`, etc.). */
  readonly deployDir: string;
}

/** An instance running on a cloud provider VM. */
export interface CloudInstanceLocation {
  readonly kind: "cloud";
  readonly provider: CloudProvider;
  /** Provider-specific instance id (DO droplet id, EC2 instance id, …). */
  readonly providerInstanceId: string;
  readonly ipAddress: string;
  readonly region: string;
  readonly size: string;
  /** Path to the SSH private key for this instance (mode 0600). */
  readonly sshKeyPath?: string;
  /** Remote host public key, captured on first successful SSH. */
  readonly sshHostKey?: string;
}

export type InstanceLocation = LocalInstanceLocation | CloudInstanceLocation;

// ── Instance ────────────────────────────────────────────────────────────────

/** One entry in the unified instance registry. */
export interface Instance {
  /** Stable uuid, minted at `clawhq init`. Primary key. */
  readonly id: string;
  /** Human-friendly label, unique across the registry. Used for `--agent <name>`. */
  readonly name: string;
  /** ISO 8601 timestamp of creation. */
  readonly createdAt: string;
  /** ISO 8601 timestamp of last update to this record. */
  readonly updatedAt: string;
  /** Advisory — reconcile before acting on it. */
  readonly status: InstanceStatus;
  /** Blueprint slug (e.g. "email-manager"). Optional — legacy entries may lack it. */
  readonly blueprint?: string;
  /** Tagged union: local deployDir or cloud VM coordinates. */
  readonly location: InstanceLocation;
}

// ── Registry ────────────────────────────────────────────────────────────────

/** Persisted shape of `~/.clawhq/instances.json`. */
export interface InstancesRegistry {
  readonly version: 1;
  readonly instances: readonly Instance[];
}

// ── Operation input types ───────────────────────────────────────────────────

/** Input for adding a new instance. The registry supplies id + timestamps. */
export interface AddInstanceOptions {
  /** Optional explicit id (migration path only — fresh instances let the registry mint). */
  readonly id?: string;
  readonly name: string;
  readonly status: InstanceStatus;
  readonly blueprint?: string;
  readonly location: InstanceLocation;
}

/** Fields that may be updated on an existing instance. */
export interface UpdateInstanceOptions {
  readonly name?: string;
  readonly status?: InstanceStatus;
  readonly blueprint?: string;
  readonly location?: InstanceLocation;
}

// ── Errors ──────────────────────────────────────────────────────────────────

/** Thrown when an `addInstance` call would collide on `name` with an existing entry. */
export class DuplicateInstanceNameError extends Error {
  constructor(readonly name: string) {
    super(`[instances] an instance named "${name}" is already registered`);
    this.name = "DuplicateInstanceNameError";
  }
}

/** Thrown when an id prefix matches more than one instance. */
export class AmbiguousInstancePrefixError extends Error {
  constructor(readonly prefix: string, readonly matchCount: number) {
    super(
      `[instances] id prefix "${prefix}" matches ${matchCount} instances; provide a longer prefix or the full id`,
    );
    this.name = "AmbiguousInstancePrefixError";
  }
}
