/**
 * Trust mode switching and cloud disconnect (kill switch).
 *
 * Manages the trust-mode.json state file and provides the kill switch
 * (`clawhq cloud disconnect`) that disconnects immediately with no prompt.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { TrustMode } from "../../config/types.js";
import type { DisconnectResult, SwitchModeResult, TrustModeState } from "../types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const TRUST_MODE_FILE = "trust-mode.json";

// ── Path helpers ─────────────────────────────────────────────────────────────

/** Resolve trust-mode.json path for a deployment directory. */
export function trustModePath(deployDir: string): string {
  return join(deployDir, "cloud", TRUST_MODE_FILE);
}

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * Read the current trust mode state.
 *
 * Returns the default state (paranoid, disconnected) if the file doesn't exist.
 */
export function readTrustModeState(deployDir: string): TrustModeState {
  const path = trustModePath(deployDir);
  if (!existsSync(path)) {
    return {
      version: 1,
      mode: "paranoid",
      connected: false,
      changedAt: new Date().toISOString(),
    };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as TrustModeState;
  } catch (err) {
    console.warn("[cloud] Failed to read trust mode state:", err);
    return {
      version: 1,
      mode: "paranoid",
      connected: false,
      changedAt: new Date().toISOString(),
    };
  }
}

// ── Write ────────────────────────────────────────────────────────────────────

/**
 * Write trust mode state atomically.
 */
function writeTrustModeState(deployDir: string, state: TrustModeState): void {
  const path = trustModePath(deployDir);
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(state, null, 2) + "\n";
  const tmpName = `.trust-mode.tmp.${randomBytes(6).toString("hex")}`;
  const tmpPath = join(dir, tmpName);

  try {
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, path);
  } catch (err) {
    throw new Error(
      `[cloud] Failed to write trust mode state: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ── Switch ───────────────────────────────────────────────────────────────────

/**
 * Switch to a new trust mode.
 *
 * Validates the transition and updates the state file.
 * Switching to paranoid automatically disconnects from cloud.
 */
export function switchTrustMode(
  deployDir: string,
  newMode: TrustMode,
): SwitchModeResult {
  const current = readTrustModeState(deployDir);
  const previousMode = current.mode;

  if (previousMode === newMode) {
    return { success: true, previousMode, currentMode: newMode };
  }

  const now = new Date().toISOString();
  const updated: TrustModeState = {
    version: 1,
    mode: newMode,
    // Paranoid mode forces disconnect
    connected: newMode === "paranoid" ? false : current.connected,
    changedAt: now,
    connectedAt: current.connectedAt,
    disconnectedAt: newMode === "paranoid" ? now : current.disconnectedAt,
  };

  writeTrustModeState(deployDir, updated);
  return { success: true, previousMode, currentMode: newMode };
}

// ── Connect ──────────────────────────────────────────────────────────────────

/**
 * Mark cloud as connected.
 *
 * Fails if trust mode is paranoid (cloud is disabled in paranoid mode).
 */
export function connectCloud(
  deployDir: string,
  _token: string,
): { success: boolean; error?: string } {
  const current = readTrustModeState(deployDir);

  if (current.mode === "paranoid") {
    return {
      success: false,
      error: "Cannot connect to cloud in paranoid mode. Switch to zero-trust or managed first.",
    };
  }

  const now = new Date().toISOString();
  const updated: TrustModeState = {
    ...current,
    connected: true,
    connectedAt: now,
  };

  writeTrustModeState(deployDir, updated);

  // Store cloud token in clawhq.yaml cloud section
  // Token storage is handled by the caller (CLI layer)
  return { success: true };
}

// ── Disconnect (Kill Switch) ─────────────────────────────────────────────────

/**
 * Disconnect from cloud immediately. No confirmation prompt.
 *
 * This is the kill switch — `clawhq cloud disconnect`.
 * Agent keeps running with full functionality.
 */
export function disconnectCloud(deployDir: string): DisconnectResult {
  const current = readTrustModeState(deployDir);
  const wasConnected = current.connected;

  if (!wasConnected) {
    return { success: true, wasConnected: false };
  }

  const now = new Date().toISOString();
  const updated: TrustModeState = {
    ...current,
    connected: false,
    disconnectedAt: now,
  };

  writeTrustModeState(deployDir, updated);
  return { success: true, wasConnected: true };
}
