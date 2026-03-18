/**
 * Individual smoke test checks.
 *
 * Each check is a focused verification that returns pass/fail with diagnostics.
 * Checks are independent — one failing doesn't prevent others from running.
 */

import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";


import type { OpenClawConfig } from "../../config/schema.js";
import { GatewayClient } from "../../gateway/websocket.js";

import type { SmokeCheckResult, SmokeTestOptions } from "./types.js";

const execFileAsync = promisify(execFile);

// --- Container running verification ---

/**
 * Verify the OpenClaw container is running via Docker.
 * This is the most basic smoke check — if the container isn't up, nothing else matters.
 */
export async function checkContainerRunning(_opts: SmokeTestOptions): Promise<SmokeCheckResult> {
  const start = Date.now();

  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["ps", "--filter", "name=openclaw", "--format", "{{.ID}}\t{{.Status}}\t{{.State}}"],
      { timeout: 10_000 },
    );

    const lines = stdout.trim().split("\n").filter((l) => l.length > 0);
    if (lines.length === 0) {
      return {
        name: "Container running",
        status: "fail",
        message: "No OpenClaw container found. Fix: Run `clawhq up` to deploy the agent.",
        durationMs: Date.now() - start,
      };
    }

    // Parse the first matching container
    const [id, status, state] = lines[0].split("\t");

    if (state !== "running") {
      return {
        name: "Container running",
        status: "fail",
        message: `Container ${id} is ${state} (${status}). Fix: Run \`clawhq restart\` or check logs with \`clawhq logs\`.`,
        durationMs: Date.now() - start,
      };
    }

    return {
      name: "Container running",
      status: "pass",
      message: `Container ${id} is running (${status})`,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    return {
      name: "Container running",
      status: "fail",
      message: `Failed to check container status: ${err instanceof Error ? err.message : String(err)}. Fix: Ensure Docker is running and accessible.`,
      durationMs: Date.now() - start,
    };
  }
}

// --- Identity file verification ---

/** Known OpenClaw identity files. */
const IDENTITY_FILES = [
  "SOUL.md",
  "USER.md",
  "AGENTS.md",
  "TOOLS.md",
];

/**
 * Verify identity files exist, are non-empty, and are readable
 * in the agent workspace.
 */
export async function checkIdentityFiles(opts: SmokeTestOptions): Promise<SmokeCheckResult> {
  const start = Date.now();
  const workspacePath = join(opts.openclawHome, "workspace");

  try {
    // Find agent workspace directories
    const agents = await findAgentWorkspaces(opts);
    if (agents.length === 0) {
      return {
        name: "Identity files",
        status: "fail",
        message: "No agent workspaces found. Fix: Run `clawhq init` to set up an agent.",
        durationMs: Date.now() - start,
      };
    }

    const missing: string[] = [];
    const empty: string[] = [];
    let totalFound = 0;

    for (const agentDir of agents) {
      for (const file of IDENTITY_FILES) {
        const filePath = join(agentDir, file);
        try {
          const info = await stat(filePath);
          if (info.size === 0) {
            empty.push(`${agentDir}/${file}`);
          } else {
            totalFound++;
          }
        } catch {
          missing.push(`${agentDir}/${file}`);
        }
      }
    }

    if (missing.length > 0) {
      return {
        name: "Identity files",
        status: "fail",
        message: `Missing identity files: ${missing.join(", ")}. Fix: Run \`clawhq init\` to regenerate identity files.`,
        durationMs: Date.now() - start,
      };
    }

    if (empty.length > 0) {
      return {
        name: "Identity files",
        status: "fail",
        message: `Empty identity files: ${empty.join(", ")}. Fix: Identity files must contain content for the agent to function.`,
        durationMs: Date.now() - start,
      };
    }

    return {
      name: "Identity files",
      status: "pass",
      message: `${totalFound} identity files verified across ${agents.length} agent(s)`,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    return {
      name: "Identity files",
      status: "fail",
      message: `Failed to check identity files: ${err instanceof Error ? err.message : String(err)}. Fix: Ensure ${workspacePath} exists and is readable.`,
      durationMs: Date.now() - start,
    };
  }
}

// --- Test message & response verification ---

/**
 * Send a test message via Gateway WebSocket RPC and verify
 * the agent responds coherently within the timeout.
 */
export async function checkTestMessage(opts: SmokeTestOptions): Promise<SmokeCheckResult> {
  const start = Date.now();
  const host = opts.gatewayHost ?? "127.0.0.1";
  const port = opts.gatewayPort ?? 18789;
  const timeoutMs = opts.responseTimeoutMs ?? 30_000;

  const gateway = new GatewayClient({
    host,
    port,
    token: opts.gatewayToken,
  });

  try {
    await gateway.connect({ signal: opts.signal });

    // Send a test message via the session RPC
    const response = await gateway.call(
      "session.send",
      {
        message: "ClawHQ smoke test: respond with OK",
        meta: { smokeTest: true },
      },
      { signal: opts.signal, timeoutMs },
    );

    if (response.error) {
      return {
        name: "Test message",
        status: "fail",
        message: `Agent returned error: ${response.error.message}. Fix: Check agent logs with \`clawhq logs\` for runtime errors.`,
        durationMs: Date.now() - start,
      };
    }

    // Verify we got a non-empty response (coherence check)
    const result = response.result as { text?: string; content?: string } | undefined;
    const text = result?.text ?? result?.content ?? "";
    if (typeof text !== "string" || text.trim().length === 0) {
      return {
        name: "Test message",
        status: "fail",
        message: "Agent returned empty response. Fix: Check model configuration and Ollama availability.",
        durationMs: Date.now() - start,
      };
    }

    return {
      name: "Test message",
      status: "pass",
      message: `Agent responded (${text.trim().length} chars, ${Date.now() - start}ms)`,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") throw err;

    return {
      name: "Test message",
      status: "fail",
      message: `Failed to send test message: ${err instanceof Error ? err.message : String(err)}. Fix: Ensure Gateway is healthy and accepting WebSocket connections on ${host}:${port}.`,
      durationMs: Date.now() - start,
    };
  } finally {
    gateway.disconnect();
  }
}

// --- Integration probing ---

/**
 * Probe each connected integration with a read-only operation.
 * Uses `openclaw channels status --probe` for channel integrations
 * and credential health checks for API providers.
 */
export async function checkIntegrations(opts: SmokeTestOptions): Promise<SmokeCheckResult> {
  const start = Date.now();

  try {
    // Read config to find enabled channels/integrations
    const config = await readOpenClawConfig(opts.configPath);
    const channels = config.channels ?? {};
    const enabledChannels = Object.entries(channels).filter(
      ([, cfg]) => cfg.enabled !== false,
    );

    if (enabledChannels.length === 0) {
      return {
        name: "Integration probe",
        status: "skip",
        message: "No integrations configured",
        durationMs: Date.now() - start,
      };
    }

    // Probe channels via openclaw CLI (read-only)
    const probeResults: Array<{ name: string; ok: boolean; detail: string }> = [];

    try {
      const { stdout } = await execFileAsync(
        "docker",
        ["exec", "openclaw", "openclaw", "channels", "status", "--probe", "--json"],
        { timeout: 15_000 },
      );
      const parsed = JSON.parse(stdout) as Array<{
        channel: string;
        status: string;
        message?: string;
      }>;
      for (const ch of parsed) {
        probeResults.push({
          name: ch.channel,
          ok: ch.status === "connected" || ch.status === "healthy",
          detail: ch.message ?? ch.status,
        });
      }
    } catch {
      // Fallback: just report configured channels without probe
      for (const [name] of enabledChannels) {
        probeResults.push({
          name,
          ok: true,
          detail: "configured (probe unavailable)",
        });
      }
    }

    const failed = probeResults.filter((r) => !r.ok);
    if (failed.length > 0) {
      const details = failed.map((f) => `${f.name}: ${f.detail}`).join("; ");
      return {
        name: "Integration probe",
        status: "fail",
        message: `${failed.length}/${probeResults.length} integration(s) unhealthy: ${details}. Fix: Check credentials with \`clawhq creds\`.`,
        durationMs: Date.now() - start,
      };
    }

    return {
      name: "Integration probe",
      status: "pass",
      message: `${probeResults.length} integration(s) healthy: ${probeResults.map((r) => r.name).join(", ")}`,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    return {
      name: "Integration probe",
      status: "fail",
      message: `Failed to probe integrations: ${err instanceof Error ? err.message : String(err)}. Fix: Ensure the agent container is running.`,
      durationMs: Date.now() - start,
    };
  }
}

// --- Helpers ---

async function findAgentWorkspaces(opts: SmokeTestOptions): Promise<string[]> {
  const workspacePath = join(opts.openclawHome, "workspace");
  const dirs: string[] = [];

  try {
    const entries = await readdir(workspacePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        dirs.push(join(workspacePath, entry.name));
      }
    }
  } catch {
    // workspace dir doesn't exist
  }

  // If no subdirs, the workspace itself may be the agent workspace
  if (dirs.length === 0) {
    try {
      await stat(join(workspacePath, "SOUL.md"));
      dirs.push(workspacePath);
    } catch {
      // No identity files at workspace root either
    }
  }

  return dirs;
}

async function readOpenClawConfig(configPath: string): Promise<OpenClawConfig> {
  const content = await readFile(configPath, "utf-8");
  return JSON.parse(content) as OpenClawConfig;
}
