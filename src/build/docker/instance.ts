/**
 * Instance identity derived from the deployment directory.
 *
 * Multi-instance isolation (FEAT-110): every deployment directory is a
 * separate agent instance. To avoid conflicts when multiple instances run on
 * the same host, all Docker resources (network, container, image tag) are
 * namespaced by a slug derived from the deploy dir path.
 *
 * Rules:
 *  - default deploy dir (~/.clawhq) → slug "default" → network "clawhq_default_net"
 *  - ~/.clawhq-work           → slug "work"    → network "clawhq_work_net"
 *  - /opt/agents/alice        → slug "alice"   → network "clawhq_alice_net"
 *  - anything with chars outside [a-z0-9_] → replaced with "_"
 *
 * The slug is max 32 chars so Docker resource names stay within 64 chars.
 */

import { basename } from "node:path";
import { homedir } from "node:os";

import { DEFAULT_DEPLOY_DIR } from "../../config/paths.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** All Docker resource names for a single deploy directory. */
export interface InstanceNames {
  /** Short identifier for this deployment (e.g. "default", "work"). */
  readonly slug: string;
  /** Docker network name (e.g. "clawhq_default_net"). */
  readonly networkName: string;
  /** Docker Compose project name (e.g. "clawhq_default"). */
  readonly projectName: string;
  /** Docker container name (e.g. "clawhq_default_openclaw"). */
  readonly containerName: string;
  /** Stage-1 base image tag (e.g. "openclaw:local_default"). */
  readonly stage1Tag: string;
  /** Stage-2 custom image tag (e.g. "openclaw:custom_default"). */
  readonly stage2Tag: string;
}

// ── Main API ─────────────────────────────────────────────────────────────────

/**
 * Derive Docker resource names for a deployment directory.
 *
 * Idempotent — same deployDir always produces same names.
 */
export function getInstanceNames(deployDir: string): InstanceNames {
  const slug = deriveSlug(deployDir);
  return {
    slug,
    networkName: `clawhq_${slug}_net`,
    projectName: `clawhq_${slug}`,
    containerName: `clawhq_${slug}_openclaw`,
    stage1Tag: `openclaw:local_${slug}`,
    stage2Tag: `openclaw:custom_${slug}`,
  };
}

// ── Internal ─────────────────────────────────────────────────────────────────

/**
 * Derive a stable, Docker-safe slug from a deployment directory path.
 *
 * Strategy:
 *  1. If the path IS the default deploy dir → "default"
 *  2. Otherwise → sanitised basename of the path
 */
function deriveSlug(deployDir: string): string {
  // Normalise: strip trailing slash, expand ~ shorthand
  const normalised = deployDir.replace(/\/+$/, "").replace(/^~/, homedir());

  const defaultNormalised = DEFAULT_DEPLOY_DIR.replace(/\/+$/, "").replace(/^~/, homedir());

  if (normalised === defaultNormalised) {
    return "default";
  }

  const name = basename(normalised) || "default";
  return sanitiseSlug(name);
}

/**
 * Sanitise a string for use in Docker resource names.
 *
 * - Lowercase
 * - Replace any char outside [a-z0-9] with "_"
 * - Collapse consecutive underscores
 * - Strip leading/trailing underscores
 * - Truncate to 32 chars
 * - Fall back to "default" if result is empty
 */
function sanitiseSlug(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);

  return slug || "default";
}
