/**
 * Centralized path constants for ClawHQ.
 *
 * Defines the OpenClaw container-internal path (where OpenClaw expects its
 * files inside the Docker container) and the default host-side deployment
 * directory. All modules should import from here rather than hardcoding paths.
 */

import { homedir } from "node:os";
import { join } from "node:path";

// ── Container-Internal Paths ─────────────────────────────────────────────────

/**
 * OpenClaw's base directory inside the Docker container.
 *
 * This is where the OpenClaw engine expects its configuration, workspace,
 * and cron files. Volume mounts map from the host deployment directory
 * to these container paths.
 *
 * Tight coupling to OpenClaw (AD-03): this path is dictated by OpenClaw's
 * container layout. If OpenClaw changes it, update this single constant.
 */
export const OPENCLAW_CONTAINER_ROOT = "/home/node/.openclaw";

/** OpenClaw container path for the runtime config file. */
export const OPENCLAW_CONTAINER_CONFIG = `${OPENCLAW_CONTAINER_ROOT}/openclaw.json`;

/** OpenClaw container path for credentials. */
export const OPENCLAW_CONTAINER_CREDENTIALS = `${OPENCLAW_CONTAINER_ROOT}/credentials.json`;

/** OpenClaw container path for the workspace directory. */
export const OPENCLAW_CONTAINER_WORKSPACE = `${OPENCLAW_CONTAINER_ROOT}/workspace`;

/** OpenClaw container path for cron jobs. */
export const OPENCLAW_CONTAINER_CRON = `${OPENCLAW_CONTAINER_ROOT}/cron`;

// ── Host-Side Paths ──────────────────────────────────────────────────────────

/** Default deployment directory on the host. */
export const DEFAULT_DEPLOY_DIR = join(
  process.env.HOME ?? homedir(),
  ".clawhq",
);

/**
 * Legacy deployment directory used by older installations.
 * Migration command detects this and moves to DEFAULT_DEPLOY_DIR.
 */
export const LEGACY_DEPLOY_DIR = join(
  process.env.HOME ?? homedir(),
  ".openclaw",
);
