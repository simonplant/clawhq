/**
 * Security posture definitions for container hardening.
 *
 * Four postures from development-friendly to maximum lockdown.
 * Standard is the default — users get hardened containers without
 * knowing what cap_drop means.
 *
 * See docs/OPENCLAW-REFERENCE.md § "Container Hardening Matrix" for spec.
 */

import { CONTAINER_USER } from "../../config/defaults.js";

import type { BuildSecurityPosture, PostureConfig } from "./types.js";

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
