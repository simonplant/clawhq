/**
 * Remote update engine — push config, version, and skill updates to
 * cloud-deployed agents via SSH.
 *
 * Reads the SSH keypair from the deploy state file (no manual key management).
 * Three update modes:
 * - config:  push updated blueprint vars to the remote agent
 * - version: pull latest clawhq, rebuild Docker image, restart
 * - skill:   install/remove/update a skill on the remote agent
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import { findInstance } from "./registry.js";
import type {
  DeployUpdateOptions,
  DeployUpdateProgressCallback,
  DeployUpdateResult,
  DeployUpdateStepName,
} from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** SSH connection timeout in seconds. */
const SSH_CONNECT_TIMEOUT = 30;

/** SSH user for cloud-init provisioned instances. */
const SSH_USER = "root";

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Update a cloud-deployed agent via SSH.
 *
 * Resolves the instance from the registry, reads the SSH key path,
 * connects to the remote, and executes the appropriate clawhq command.
 */
export async function updateInstance(options: DeployUpdateOptions): Promise<DeployUpdateResult> {
  const report = progress(options.onProgress);

  // Step 1: Resolve instance from registry
  report("resolve", "running", `Looking up instance ${options.instanceId}…`);

  const instance = findInstance(options.deployDir, options.instanceId);
  if (!instance) {
    const msg = `Instance not found: ${options.instanceId}. Run "clawhq deploy list" to see provisioned instances.`;
    report("resolve", "failed", msg);
    return { success: false, error: msg };
  }

  if (instance.status !== "active" && instance.status !== "unhealthy") {
    const msg = `Instance "${instance.name}" is in "${instance.status}" state — update requires an active or unhealthy instance.`;
    report("resolve", "failed", msg);
    return { success: false, error: msg };
  }

  // Verify SSH key exists
  if (!instance.sshKeyPath) {
    const msg = `Instance "${instance.name}" has no SSH key path in the deploy state. Cannot connect for update.`;
    report("resolve", "failed", msg);
    return { success: false, error: msg };
  }

  if (!existsSync(instance.sshKeyPath)) {
    const msg = `SSH key not found at ${instance.sshKeyPath}. The key may have been deleted. Reprovision to restore access.`;
    report("resolve", "failed", msg);
    return { success: false, error: msg };
  }

  report("resolve", "done", `Instance "${instance.name}" at ${instance.ipAddress}`);

  // Step 2: Build remote command
  const remoteCommand = buildRemoteCommand(options);
  if (!remoteCommand) {
    const msg = `Invalid update mode or missing arguments. Use --config, --version, or --skill install <source>.`;
    report("execute", "failed", msg);
    return { success: false, error: msg };
  }

  // Step 3: Execute via SSH
  report("connect", "running", `Connecting to ${instance.ipAddress} via SSH…`);

  const result = await executeSsh({
    host: instance.ipAddress,
    keyPath: instance.sshKeyPath,
    command: remoteCommand,
    signal: options.signal,
  });

  if (result.success) {
    report("connect", "done", `Connected to ${instance.ipAddress}`);
    report("execute", "done", `Update complete`);
  } else {
    report("execute", "failed", result.error ?? "SSH command failed");
  }

  return result;
}

// ── Command Builders ─────────────────────────────────────────────────────────

/** Build the remote shell command for the given update mode. */
function buildRemoteCommand(options: DeployUpdateOptions): string | undefined {
  switch (options.mode) {
    case "config":
      // Push updated config: re-run clawhq build to regenerate and restart
      return "clawhq build && clawhq restart";

    case "version":
      // Pull latest, rebuild, restart
      return "clawhq update --yes";

    case "skill":
      if (!options.skillArgs) return undefined;
      // Shell-escape each arg to prevent command injection on the remote
      const escapedArgs = options.skillArgs
        .split(" ")
        .filter(Boolean)
        .map(shellEscape)
        .join(" ");
      return `clawhq skill ${escapedArgs}`;

    default:
      return undefined;
  }
}

// ── SSH Execution ────────────────────────────────────────────────────────────

interface SshExecOptions {
  readonly host: string;
  readonly keyPath: string;
  readonly command: string;
  readonly signal?: AbortSignal;
}

/** Execute a command on a remote host via SSH. */
function executeSsh(options: SshExecOptions): Promise<DeployUpdateResult> {
  return new Promise((resolve) => {
    const args = [
      "-i", options.keyPath,
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", `ConnectTimeout=${SSH_CONNECT_TIMEOUT}`,
      "-o", "BatchMode=yes",
      `${SSH_USER}@${options.host}`,
      options.command,
    ];

    const proc = spawn("ssh", args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal: options.signal,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      resolve({
        success: false,
        error: `SSH connection failed: ${err.message}`,
      });
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() || undefined });
      } else {
        const detail = stderr.trim() || stdout.trim() || `exit code ${code}`;
        resolve({
          success: false,
          output: stdout.trim() || undefined,
          error: `Remote command failed: ${detail}`,
        });
      }
    });
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Shell-escape a string for safe interpolation into a remote shell command. */
function shellEscape(arg: string): string {
  // Wrap in single quotes, escaping embedded single quotes
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function progress(callback?: DeployUpdateProgressCallback) {
  return (
    step: DeployUpdateStepName,
    status: "running" | "done" | "failed",
    message: string,
  ): void => {
    if (callback) {
      callback({ step, status, message });
    }
  };
}
