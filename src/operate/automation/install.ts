/**
 * Ops automation installer — deploys generated scripts as systemd timers/services.
 *
 * `clawhq ops install` copies scripts and unit files from the deployment
 * directory to systemd paths and enables timers.
 */

import { execFile } from "node:child_process";
import { access, constants, copyFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { DOCTOR_EXEC_TIMEOUT_MS } from "../../config/defaults.js";
import { opsPath } from "../../config/ops-paths.js";

import type { OpsInstallOptions, OpsInstallResult } from "./types.js";

const execFileAsync = promisify(execFile);

const SYSTEMD_UNIT_DIR = "/etc/systemd/system";

/**
 * Install ops automation scripts as systemd timers/services.
 *
 * 1. Copies .service and .timer files from ops/automation/systemd/ to /etc/systemd/system/
 * 2. Runs systemctl daemon-reload
 * 3. Enables and starts all timers
 */
export async function installOpsAutomation(
  options: OpsInstallOptions,
): Promise<OpsInstallResult> {
  const { deployDir, signal } = options;
  const unitDir = opsPath(deployDir, "automation", "systemd");
  const installed: string[] = [];
  const enabled: string[] = [];

  try {
    // Verify automation directory exists
    try {
      await access(unitDir, constants.R_OK);
    } catch {
      return {
        success: false,
        installed: [],
        enabled: [],
        error: `Ops automation directory not found at ${unitDir} — run clawhq init first`,
      };
    }

    // Find all .service and .timer files
    const entries = await readdir(unitDir);
    const unitFiles = entries.filter(
      (f) => f.endsWith(".service") || f.endsWith(".timer"),
    );

    if (unitFiles.length === 0) {
      return {
        success: false,
        installed: [],
        enabled: [],
        error: "No systemd unit files found — run clawhq init to generate them",
      };
    }

    // Copy unit files to systemd directory
    for (const file of unitFiles) {
      const src = join(unitDir, file);
      const dest = join(SYSTEMD_UNIT_DIR, file);
      await copyFile(src, dest);
      installed.push(file);
    }

    // Reload systemd
    await execFileAsync("systemctl", ["daemon-reload"], {
      timeout: DOCTOR_EXEC_TIMEOUT_MS,
      signal,
    });

    // Enable and start timers
    const timers = unitFiles.filter((f) => f.endsWith(".timer"));
    for (const timer of timers) {
      await execFileAsync("systemctl", ["enable", "--now", timer], {
        timeout: DOCTOR_EXEC_TIMEOUT_MS,
        signal,
      });
      enabled.push(timer);
    }

    return { success: true, installed, enabled };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      installed,
      enabled,
      error: `Ops install failed: ${msg}`,
    };
  }
}

/**
 * Check if a systemd timer is active.
 */
export async function isTimerActive(
  timerName: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "systemctl",
      ["is-active", timerName],
      { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal },
    );
    return stdout.trim() === "active";
  } catch {
    return false;
  }
}

/**
 * Get the last run timestamp for a systemd timer's service.
 */
export async function getTimerLastRun(
  serviceName: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "systemctl",
      ["show", serviceName, "--property=ExecMainExitTimestamp", "--value"],
      { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal },
    );
    const ts = stdout.trim();
    return ts || null;
  } catch {
    return null;
  }
}
