/**
 * Security posture definitions for container hardening.
 *
 * Four postures from development-friendly to maximum lockdown.
 * Standard is the default — users get hardened containers without
 * knowing what cap_drop means.
 *
 * See docs/OPENCLAW-REFERENCE.md § "Container Hardening Matrix" for spec.
 */

import type { BuildSecurityPosture, PostureConfig } from "./types.js";

// ── Posture Definitions ─────────────────────────────────────────────────────

const POSTURES: Record<BuildSecurityPosture, PostureConfig> = {
  minimal: {
    posture: "minimal",
    capDrop: ["ALL"],
    securityOpt: ["no-new-privileges"],
    readOnlyRootfs: false,
    user: "1000:1000",
    iccDisabled: false,
    resources: { cpus: 0, memoryMb: 0, pidsLimit: 0 },
    tmpfs: { sizeMb: 512, options: "noexec,nosuid" },
  },
  standard: {
    posture: "standard",
    capDrop: ["ALL"],
    securityOpt: ["no-new-privileges"],
    readOnlyRootfs: true,
    user: "1000:1000",
    iccDisabled: true,
    resources: { cpus: 4, memoryMb: 4096, pidsLimit: 512 },
    tmpfs: { sizeMb: 256, options: "noexec,nosuid" },
  },
  hardened: {
    posture: "hardened",
    capDrop: ["ALL"],
    securityOpt: ["no-new-privileges"],
    readOnlyRootfs: true,
    user: "1000:1000",
    iccDisabled: true,
    resources: { cpus: 2, memoryMb: 2048, pidsLimit: 256 },
    tmpfs: { sizeMb: 128, options: "noexec,nosuid" },
  },
  paranoid: {
    posture: "paranoid",
    capDrop: ["ALL"],
    securityOpt: ["no-new-privileges"],
    readOnlyRootfs: true,
    user: "1000:1000",
    iccDisabled: true,
    resources: { cpus: 1, memoryMb: 1024, pidsLimit: 128 },
    tmpfs: { sizeMb: 64, options: "noexec,nosuid" },
  },
};

// ── Public API ──────────────────────────────────────────────────────────────

/** Get the posture configuration for a given security level. */
export function getPostureConfig(posture: BuildSecurityPosture): PostureConfig {
  return POSTURES[posture];
}

/** The default security posture applied without user configuration. */
export const DEFAULT_POSTURE: BuildSecurityPosture = "standard";

/** All available posture levels, ordered from least to most restrictive. */
export const POSTURE_LEVELS: readonly BuildSecurityPosture[] = [
  "minimal",
  "standard",
  "hardened",
  "paranoid",
];
