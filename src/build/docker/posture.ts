/**
 * Security posture definitions for container hardening.
 *
 * Four postures from development-friendly to maximum lockdown.
 * Standard is the default — users get hardened containers without
 * knowing what cap_drop means.
 *
 * See docs/OPENCLAW-REFERENCE.md § "Container Hardening Matrix" for spec.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { CONTAINER_USER } from "../../config/defaults.js";

import type { BuildSecurityPosture, PostureConfig } from "./types.js";

const execFileAsync = promisify(execFile);

// ── Posture Definitions ─────────────────────────────────────────────────────

const POSTURES: Record<BuildSecurityPosture, PostureConfig> = {
  // Dev/testing — caps dropped but otherwise permissive
  minimal: {
    posture: "minimal",
    capDrop: ["ALL"],
    securityOpt: ["no-new-privileges"],
    readOnlyRootfs: false,
    user: CONTAINER_USER,
    iccDisabled: false,
    resources: { cpus: 0, memoryMb: 0, pidsLimit: 0 },
    tmpfs: { sizeMb: 512, options: "nosuid" },
    autoFirewall: false,
    immutableIdentity: false,
    airGap: false,
    healthcheckIntervalSecs: 30,
  },
  // Default production — gVisor, egress firewall, immutable identity
  hardened: {
    posture: "hardened",
    capDrop: ["ALL"],
    securityOpt: ["no-new-privileges"],
    readOnlyRootfs: true,
    user: CONTAINER_USER,
    iccDisabled: true,
    resources: { cpus: 4, memoryMb: 4096, pidsLimit: 512 },
    tmpfs: { sizeMb: 256, options: "nosuid" },
    runtime: "runsc",
    autoFirewall: true,
    immutableIdentity: true,
    airGap: false,
    healthcheckIntervalSecs: 30,
  },
  // Active threat response — everything hardened + aggressive monitoring,
  // full audit trail, noexec tmpfs, air-gapped egress, rapid healthchecks,
  // alert on any suspicious pattern
  "under-attack": {
    posture: "under-attack",
    capDrop: ["ALL"],
    securityOpt: ["no-new-privileges"],
    readOnlyRootfs: true,
    user: CONTAINER_USER,
    iccDisabled: true,
    resources: { cpus: 4, memoryMb: 4096, pidsLimit: 512 },
    tmpfs: { sizeMb: 256, options: "noexec,nosuid,nodev" },
    runtime: "runsc",
    autoFirewall: true,
    immutableIdentity: true,
    airGap: true,
    healthcheckIntervalSecs: 10,
  },
};

// ── Public API ──────────────────────────────────────────────────────────────

/** Get the posture configuration for a given security level. */
export function getPostureConfig(posture: BuildSecurityPosture): PostureConfig {
  return POSTURES[posture];
}

/** The default security posture applied without user configuration. */
export const DEFAULT_POSTURE: BuildSecurityPosture = "hardened";

/** All available posture levels, ordered from least to most restrictive. */
export const POSTURE_LEVELS: readonly BuildSecurityPosture[] = [
  "minimal",
  "hardened",
  "under-attack",
];

// ── Host-Aware Posture Resolution ─────────────────────────────────────────

/**
 * A way in which the requested posture can't be fully applied on this host.
 * Surfaced by apply/deploy so the user learns when their security intent
 * has been silently downgraded — a "hardened" claim with gVisor missing is
 * not actually hardened.
 */
export interface PostureDegradation {
  readonly kind: "runtime-unavailable";
  /** OCI runtime name that was requested (e.g. "runsc"). */
  readonly requested: string;
  /** Human-readable reason (e.g. "runsc binary not found in PATH"). */
  readonly reason: string;
  /** Suggested remediation surfaced to the user. */
  readonly remediation: string;
}

/** Result of probing the host and reconciling with the requested posture. */
export interface ResolvedPosture {
  /** The posture definition as written — preserved so manifests record intent. */
  readonly config: PostureConfig;
  /** Whether `config.runtime` is actually usable on this host. */
  readonly runtimeAvailable: boolean;
  /** Ways in which the posture could not be fully applied. */
  readonly degradations: readonly PostureDegradation[];
}

/** Injection point for host capability probes — swapped in tests. */
export interface PostureHostProbes {
  /** Returns true if gVisor (`runsc`) is installed and executable. */
  readonly runscAvailable: (signal?: AbortSignal) => Promise<boolean>;
}

const defaultProbes: PostureHostProbes = {
  runscAvailable: async (signal?: AbortSignal) => {
    try {
      await execFileAsync("runsc", ["--version"], { timeout: 5000, signal });
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * Resolve a posture for the current host.
 *
 * Probes host capabilities once (just runsc for now) and returns a
 * `ResolvedPosture` whose flags and degradations are the single source of
 * truth for downstream compose generation, preflight checks, and
 * user-visible warnings. Callers must use this — not `getPostureConfig` —
 * any time a real deployment decision is being made, so the security claim
 * in the compose file matches what will actually run.
 *
 * The underlying `PostureConfig` is returned unchanged; "degradation" is
 * expressed in sibling fields (`runtimeAvailable`, `degradations`) rather
 * than by mutating the intent. Compose-gen consumes `runtimeAvailable` to
 * decide whether to emit the `runtime:` directive.
 */
export async function resolvePosture(
  raw: BuildSecurityPosture,
  signal?: AbortSignal,
  probes: PostureHostProbes = defaultProbes,
): Promise<ResolvedPosture> {
  const config = getPostureConfig(raw);
  const degradations: PostureDegradation[] = [];

  let runtimeAvailable = true;
  if (config.runtime === "runsc") {
    runtimeAvailable = await probes.runscAvailable(signal);
    if (!runtimeAvailable) {
      degradations.push({
        kind: "runtime-unavailable",
        requested: "runsc",
        reason: "gVisor (runsc) is not installed on this host",
        remediation:
          "Install gVisor (https://gvisor.dev/docs/user_guide/install/) or switch posture to `minimal` in clawhq.yaml",
      });
    }
  }

  return { config, runtimeAvailable, degradations };
}

/**
 * Format posture degradations as user-facing warning lines.
 *
 * Shared formatter so apply, up, and doctor all surface degradations the
 * same way. Returns one line per degradation, prefixed with `⚠ `.
 */
export function formatPostureDegradations(
  degradations: readonly PostureDegradation[],
): string[] {
  return degradations.map((d) => `⚠ ${d.reason} — ${d.remediation}`);
}
