/**
 * posture.yaml writer — human-reviewable security posture file.
 *
 * Generates a YAML file at ~/.clawhq/security/posture.yaml reflecting
 * the active container hardening settings. The Tinkerer persona wants
 * to see what posture they're running — this makes it visible and reviewable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { getPostureConfig } from "./posture.js";
import type { BuildSecurityPosture, PostureConfig } from "./types.js";

// ── Constants ───────────────────────────────────────────────────────────────

const POSTURE_DIR = "security";
const POSTURE_FILE = "posture.yaml";

// ── Path helpers ────────────────────────────────────────────────────────────

/** Resolve the posture.yaml path for a deployment directory. */
export function posturePath(deployDir: string): string {
  return join(deployDir, POSTURE_DIR, POSTURE_FILE);
}

// ── YAML generation ─────────────────────────────────────────────────────────

/**
 * Generate human-readable YAML content from a PostureConfig.
 *
 * Hand-built YAML (no dependency) — simple enough to be reliable.
 */
export function generatePostureYaml(config: PostureConfig): string {
  const lines: string[] = [
    "# ClawHQ Security Posture",
    "# Generated automatically — do not edit manually.",
    `# Last updated: ${new Date().toISOString()}`,
    "",
    `posture: ${config.posture}`,
    "",
    "# Container hardening",
    "container:",
    `  capabilities_dropped: [${config.capDrop.join(", ")}]`,
    `  security_options: [${config.securityOpt.join(", ")}]`,
    `  read_only_rootfs: ${config.readOnlyRootfs}`,
    `  user: "${config.user}"`,
    `  icc_disabled: ${config.iccDisabled}`,
    "",
    "# Resource limits",
    "resources:",
  ];

  if (config.resources.cpus === 0) {
    lines.push("  cpus: unlimited");
  } else {
    lines.push(`  cpus: ${config.resources.cpus}`);
  }

  if (config.resources.memoryMb === 0) {
    lines.push("  memory_mb: unlimited");
  } else {
    lines.push(`  memory_mb: ${config.resources.memoryMb}`);
  }

  if (config.resources.pidsLimit === 0) {
    lines.push("  pids_limit: unlimited");
  } else {
    lines.push(`  pids_limit: ${config.resources.pidsLimit}`);
  }

  lines.push(
    "",
    "# Temporary filesystem",
    "tmpfs:",
    `  size_mb: ${config.tmpfs.sizeMb}`,
    `  options: "${config.tmpfs.options}"`,
    "",
  );

  return lines.join("\n");
}

// ── Write ───────────────────────────────────────────────────────────────────

/**
 * Write the posture.yaml file for the active security posture.
 *
 * Creates the security/ directory if needed. Overwrites any existing file.
 */
export function writePostureYaml(
  deployDir: string,
  posture: BuildSecurityPosture,
): void {
  const config = getPostureConfig(posture);
  const content = generatePostureYaml(config);
  const path = posturePath(deployDir);
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(path, content, "utf-8");
}

/**
 * Read the current posture from posture.yaml (if it exists).
 *
 * Returns the posture level string, or null if the file doesn't exist.
 * Uses simple line parsing — no YAML library needed.
 */
export function readCurrentPosture(deployDir: string): BuildSecurityPosture | null {
  const path = posturePath(deployDir);
  if (!existsSync(path)) return null;

  const content = readFileSync(path, "utf-8");

  for (const line of content.split("\n")) {
    const match = line.match(/^posture:\s*(\S+)/);
    if (match) {
      return match[1] as BuildSecurityPosture;
    }
  }

  return null;
}
