/**
 * Deploy orchestrator for `clawhq up / down / restart`.
 *
 * Coordinates the full deploy sequence:
 *   preflight → compose up → identity lock → firewall → health verify → integration verify → smoke test
 *
 * Every step reports progress via callback. AbortSignal threads through
 * the entire pipeline for clean cancellation. On failure, the user gets
 * a clear, actionable error — never silent failure.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { DEPLOY_COMPOSE_TIMEOUT_MS } from "../../config/defaults.js";
import { withDeployLock } from "../../config/lock.js";
import {
  DEFAULT_POSTURE,
  getPostureConfig,
  readCurrentPosture,
  readManifest,
} from "../docker/index.js";

import {
  applyFirewall,
  collectIntegrationDomains,
  detectConfiguredIntegrations,
  removeFirewall,
  serializeAllowlist,
} from "./firewall.js";
import { smokeTest, verifyHealth } from "./health.js";
import { runPreflight } from "./preflight.js";
import type {
  DeployOptions,
  DeployProgress,
  DeployResult,
  DeployStepName,
  DeployStepStatus,
  ProgressCallback,
  ShutdownOptions,
  ShutdownResult,
} from "./types.js";
import { formatVerifyReport, verifyIntegrations } from "./verify.js";

const execFileAsync = promisify(execFile);

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Deploy the agent: preflight → compose up → firewall → health → smoke test.
 *
 * Returns a running, reachable agent or a clear error. Never silent failure.
 *
 * Serialized under the deploy lock so concurrent `clawhq up/restart`
 * invocations (or one racing against a parallel `clawhq build`) don't
 * stomp on each other. Reentrant-by-pid — auto-build nested inside a
 * deploy doesn't re-acquire.
 */
export async function deploy(options: DeployOptions): Promise<DeployResult> {
  return withDeployLock(options.deployDir, () => deployImpl(options));
}

async function deployImpl(options: DeployOptions): Promise<DeployResult> {
  const { deployDir, onProgress, signal } = options;
  const engineDir = join(deployDir, "engine");
  const report = progress(onProgress);

  // ── Step 0: Auto-detect and execute missing lifecycle steps ─────────────
  // Makes `clawhq up` a single command that handles everything:
  // not installed → install. not built → build. then deploy.
  // Init (wizard) cannot be auto-run — it's interactive.

  if (!options.skipPreflight) {
    // Check 1: Is ClawHQ installed (directories + clawhq.yaml)?
    if (!existsSync(join(deployDir, "clawhq.yaml"))) {
      report("auto-install", "running", "Platform not installed — running install…");
      try {
        const { install } = await import("../installer/index.js");
        const installResult = await install({ deployDir });
        if (!installResult.success) {
          report("auto-install", "failed", `Install failed: ${installResult.error ?? "unknown error"}`);
          return { success: false, preflight: null, healthy: false, error: `Auto-install failed: ${installResult.error}` };
        }
        report("auto-install", "done", "Platform installed");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        report("auto-install", "failed", msg);
        return { success: false, preflight: null, healthy: false, error: `Auto-install failed: ${msg}` };
      }
    }

    // Check 2: Is config initialized (openclaw.json exists)?
    if (!existsSync(join(engineDir, "openclaw.json"))) {
      report("preflight", "failed", "Agent not configured — run `clawhq init --guided` first");
      return {
        success: false,
        preflight: null,
        healthy: false,
        error: "No agent config found. Run: clawhq init --guided (or clawhq quickstart)",
      };
    }

    // Check 3: Is the Docker image built?
    const manifest = await readManifest(deployDir);
    if (!manifest?.imageTag) {
      report("auto-build", "running", "No build manifest — running build…");
      try {
        const { build } = await import("../docker/index.js");
        const { scanWorkspaceManifest } = await import("../../design/configure/generate.js");
        const { getRequiredBinaries } = await import("../docker/index.js");

        const posture = readCurrentPosture(deployDir) ?? DEFAULT_POSTURE;
        const workspace = scanWorkspaceManifest(deployDir);
        const buildResult = await build({
          deployDir,
          stage1: { baseImage: "node:24-slim", aptPackages: [] },
          stage2: {
            binaries: getRequiredBinaries(deployDir),
            workspaceTools: [],
            skills: [],
            workspace,
          },
          posture,
        });

        if (!buildResult.success) {
          report("auto-build", "failed", `Build failed: ${buildResult.error}`);
          return { success: false, preflight: null, healthy: false, error: `Auto-build failed: ${buildResult.error}` };
        }
        report("auto-build", "done", `Image built: ${buildResult.manifest?.imageTag ?? "openclaw:custom"}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        report("auto-build", "failed", msg);
        return { success: false, preflight: null, healthy: false, error: `Auto-build failed: ${msg}` };
      }
    }
  }

  // ── Step 1: Preflight ──────────────────────────────────────────────────

  if (!options.skipPreflight) {
    report("preflight", "running", "Running preflight checks…");

    const preflight = await runPreflight(deployDir, signal, options.gatewayPort, options.runtime);

    // Report warnings (non-blocking) before checking hard failures
    if (preflight.warnings.length > 0) {
      const warns = preflight.warnings
        .map((c) => `  ⚠ ${c.name}: ${c.message}${c.fix ? ` → ${c.fix}` : ""}`)
        .join("\n");
      report("preflight", "running", `Warning:\n${warns}`);
    }

    if (!preflight.passed) {
      // Compose is owned by `clawhq build` and `clawhq apply`. If preflight
      // says it's broken/stale, fail loudly and tell the user which primitive
      // regenerates it. The previous self-heal silently rewrote compose on
      // every trip — but its sidecar detection was partial, so it routinely
      // dropped cred-proxy / clawdius-trading services and
      // caused the "compose stub recurrence" bug class. Loud failure +
      // explicit remediation is the correct config-management behavior.
      const errors = preflight.failed
        .map((c) => `  • ${c.name}: ${c.message}${c.fix ? ` → ${c.fix}` : ""}`)
        .join("\n");
      const composeFailure = preflight.failed.some((c) => c.name === "compose");
      const remediation = composeFailure
        ? "\n\nCompose is stale or invalid. Run: clawhq build (or clawhq apply if the manifest changed)"
        : "";
      report("preflight", "failed", `${preflight.failed.length} preflight check(s) failed`);
      return { success: false, preflight, healthy: false, error: `Preflight failed:\n${errors}${remediation}` };
    }

    if (preflight.warnings.length > 0) {
      report("preflight", "done", `Preflight passed with ${preflight.warnings.length} warning(s)`);
    } else {
      report("preflight", "done", "All preflight checks passed");
    }
  }

  // ── Step 1b: Config Sync ────────────────────────────────────────────────
  // The golden config at deployDir/openclaw.json is the source of truth.
  // The engine copy at deployDir/engine/openclaw.json is what the container reads.
  // Sync golden → engine so the container always starts with the latest config.
  {
    const goldenConfig = join(deployDir, "openclaw.json");
    const engineConfig = join(engineDir, "openclaw.json");
    try {
      const goldenStat = await stat(goldenConfig);
      if (goldenStat.isFile()) {
        await copyFile(goldenConfig, engineConfig);
        report("preflight", "running", "Config synced (golden → engine)");
      }
    } catch {
      // Golden config doesn't exist — engine config is used as-is
    }
  }

  // ── Step 1c: Ensure firewall allowlist exists ─────────────────────────
  // If no allowlist.yaml exists yet, auto-generate it from the configured
  // channels and integrations in openclaw.json + .env. Without this, the
  // egress firewall blocks ALL HTTPS traffic.
  {
    const allowlistPath = join(deployDir, "ops", "firewall", "allowlist.yaml");
    try {
      await stat(allowlistPath);
    } catch {
      // Allowlist doesn't exist — auto-generate from config + env
      try {
        const configPath = join(engineDir, "openclaw.json");
        const envPath = join(engineDir, ".env");

        const configRaw = await readFile(configPath, "utf-8");
        const config = JSON.parse(configRaw) as Record<string, unknown>;

        // Parse .env file into key-value map
        const envVars: Record<string, string> = {};
        try {
          const envRaw = await readFile(envPath, "utf-8");
          for (const line of envRaw.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx > 0) {
              envVars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
            }
          }
        } catch { /* no .env — continue with empty */ }

        // Collect domains from configured integrations
        const configuredIntegrations = detectConfiguredIntegrations(envVars);
        const entries = collectIntegrationDomains(configuredIntegrations, envVars);

        // Add Telegram API domain if telegram channel is enabled
        const channels = config["channels"] as Record<string, unknown> | undefined;
        const telegram = channels?.["telegram"] as Record<string, unknown> | undefined;
        if (telegram?.["enabled"] === true) {
          entries.push({ domain: "api.telegram.org", port: 443 });
        }

        if (entries.length > 0) {
          await mkdir(join(deployDir, "ops", "firewall"), { recursive: true });
          await writeFile(allowlistPath, serializeAllowlist(entries), "utf-8");
          report("preflight", "running", `Firewall allowlist auto-generated (${entries.length} entries)`);
        }
      } catch {
        // Best-effort — firewall will fall back to DNS-only
      }
    }
  }

  // ── Step 2: Compose Up ─────────────────────────────────────────────────

  if (signal?.aborted) {
    return aborted();
  }

  report("compose-up", "running", "Starting containers…");

  try {
    await execFileAsync(
      "docker",
      ["compose", "-f", join(engineDir, "docker-compose.yml"), "up", "-d", "--wait"],
      { timeout: DEPLOY_COMPOSE_TIMEOUT_MS, signal },
    );
    report("compose-up", "done", "Containers started");

    await ensureOllamaReachable(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report("compose-up", "failed", "Failed to start containers");
    return {
      success: false,
      preflight: null,
      healthy: false,
      error: `Docker Compose failed: ${message}`,
    };
  }

  // ── Step 3: Identity Lock (chattr +i) ──────────────────────────────────

  if (signal?.aborted) {
    return aborted();
  }

  if (options.immutableIdentity) {
    report("identity-lock", "running", "Marking identity files immutable (chattr +i)…");

    const identityResult = await lockIdentityFiles(deployDir);
    if (identityResult.success) {
      report("identity-lock", "done", `${identityResult.filesLocked} identity file(s) locked`);
    } else {
      // Non-fatal — agent still runs, just without persistence prevention
      report("identity-lock", "skipped", `Identity lock skipped: ${identityResult.error}`);
    }
  }

  // ── Step 4: Firewall ───────────────────────────────────────────────────

  if (signal?.aborted) {
    return aborted();
  }

  // Firewall: enabled by default, auto-enabled by posture (hardened/paranoid).
  // Skipped when: --skip-firewall flag, or security.firewallDisabled in clawhq.yaml
  const clawhqConfigPath = join(deployDir, "clawhq.yaml");
  let firewallDisabledByConfig = false;
  try {
    const { readFileSync } = await import("node:fs");
    const { parse: yamlParse } = await import("yaml");
    const raw = yamlParse(readFileSync(clawhqConfigPath, "utf-8")) as Record<string, unknown>;
    const security = raw.security as Record<string, unknown> | undefined;
    firewallDisabledByConfig = security?.firewallDisabled === true;
  } catch { /* no config or parse error — default to enabled */ }

  if (!options.skipFirewall && !firewallDisabledByConfig) {
    const firewallOpts = { deployDir, airGap: options.airGap, signal };
    report("firewall", "running", options.airGap ? "Applying air-gap firewall (all egress blocked)…" : "Applying egress firewall…");

    const fwResult = await applyFirewall(firewallOpts);

    if (!fwResult.success) {
      report("firewall", "failed", "Firewall setup failed");
      // Firewall failure is non-fatal — agent still runs, just without egress filtering
      report("firewall", "skipped", `Firewall skipped: ${fwResult.error}`);
    } else if (fwResult.warning) {
      report("firewall", "skipped", fwResult.warning);
    } else {
      report("firewall", "done", `Firewall applied (${fwResult.rulesApplied} rules${options.airGap ? ", air-gap mode" : ""})`);
    }
  } else {
    report("firewall", "skipped", "Firewall skipped (--skip-firewall)");
  }

  // ── Step 5: Health Verify ──────────────────────────────────────────────

  if (signal?.aborted) {
    return aborted();
  }

  report("health-verify", "running", "Verifying agent is reachable…");

  const healthResult = await verifyHealth({
    gatewayToken: options.gatewayToken,
    gatewayPort: options.gatewayPort,
    signal,
  });

  if (!healthResult.healthy) {
    report("health-verify", "failed", "Agent is not reachable");
    return {
      success: false,
      preflight: null,
      healthy: false,
      error: healthResult.error ?? "Health verification failed — Gateway did not respond",
    };
  }

  report("health-verify", "done", `Agent reachable (${healthResult.attempts} attempt(s), ${healthResult.elapsedMs}ms)`);

  // ── Step 6: Integration Verify ───────────────────────────────────────

  if (signal?.aborted) {
    return aborted();
  }

  if (!options.skipVerify) {
    report("verify", "running", "Verifying integrations work from container…");

    const verifyReport = await verifyIntegrations({
      deployDir,
      signal,
    });

    if (verifyReport.checks.length === 0) {
      report("verify", "skipped", "No integrations to verify");
    } else if (verifyReport.healthy) {
      report("verify", "done", `All ${verifyReport.passed} integrations verified`);
    } else {
      // Verification failures are warnings, not blockers — agent still runs
      report("verify", "failed",
        `${verifyReport.failed} of ${verifyReport.checks.length} checks failed:\n${formatVerifyReport(verifyReport)}`);
    }
  } else {
    report("verify", "skipped", "Integration verification skipped (--skip-verify)");
  }

  // ── Step 7: Smoke Test ─────────────────────────────────────────────────

  if (signal?.aborted) {
    return aborted();
  }

  report("smoke-test", "running", "Sending real message to agent…");

  const smokeResult = await smokeTest({
    gatewayToken: options.gatewayToken,
    gatewayPort: options.gatewayPort,
    signal,
  });

  if (!smokeResult.healthy) {
    // Smoke test failure is a warning, not a blocker — the gateway is healthy,
    // the agent just can't respond to messages yet (needs model credentials,
    // channel config, etc.). The user can configure these post-deploy.
    report("smoke-test", "skipped", "Smoke test skipped — agent gateway is live but message pipeline not yet configured");
  }

  if (smokeResult.fallback) {
    report("smoke-test", "done", "Smoke test passed (status only — upgrade OpenClaw for full message verification)");
  } else if (smokeResult.messageSent && smokeResult.responseReceived) {
    report("smoke-test", "done", "Smoke test passed — agent responded to real message");
  } else {
    report("smoke-test", "done", "Smoke test passed — agent is live");
  }

  return {
    success: true,
    preflight: null,
    healthy: true,
  };
}

/**
 * Graceful shutdown: unlock identity → compose down → firewall remove.
 *
 * Serialized under the deploy lock. Reentrant — `clawhq restart` calls
 * shutdown + deploy in sequence under the same outer lock.
 */
export async function shutdown(options: ShutdownOptions): Promise<ShutdownResult> {
  return withDeployLock(options.deployDir, () => shutdownImpl(options));
}

async function shutdownImpl(options: ShutdownOptions): Promise<ShutdownResult> {
  const { deployDir, onProgress, signal } = options;
  const engineDir = join(deployDir, "engine");
  const report = progress(onProgress);

  // Unlock identity files if they were locked (best-effort, won't fail shutdown)
  await unlockIdentityFiles(deployDir);

  report("compose-up", "running", "Stopping containers…");

  try {
    const args = ["compose", "-f", join(engineDir, "docker-compose.yml"), "down"];
    if (options.removeVolumes) args.push("-v");

    await execFileAsync("docker", args, { timeout: DEPLOY_COMPOSE_TIMEOUT_MS, signal });
    report("compose-up", "done", "Containers stopped");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report("compose-up", "failed", "Failed to stop containers");
    return { success: false, error: `Docker Compose down failed: ${message}` };
  }

  // Remove firewall rules
  report("firewall", "running", "Removing firewall rules…");
  const fwResult = await removeFirewall(signal);
  if (fwResult.success) {
    report("firewall", "done", "Firewall rules removed");
  } else {
    report("firewall", "skipped", `Firewall removal skipped: ${fwResult.error}`);
  }

  return { success: true };
}

/**
 * Restart: graceful shutdown → deploy with firewall reapply.
 *
 * Held under a single outer deploy lock so shutdown + deploy execute
 * atomically — another process can't race in between the compose-down
 * and compose-up.
 */
export async function restart(
  deployOptions: DeployOptions,
  shutdownOptions?: Partial<ShutdownOptions>,
): Promise<DeployResult> {
  return withDeployLock(deployOptions.deployDir, () => restartImpl(deployOptions, shutdownOptions));
}

async function restartImpl(
  deployOptions: DeployOptions,
  shutdownOptions?: Partial<ShutdownOptions>,
): Promise<DeployResult> {
  const shutResult = await shutdown({
    deployDir: deployOptions.deployDir,
    onProgress: deployOptions.onProgress,
    signal: deployOptions.signal,
    ...shutdownOptions,
  });

  if (!shutResult.success) {
    return {
      success: false,
      preflight: null,
      healthy: false,
      error: `Restart failed during shutdown: ${shutResult.error}`,
    };
  }

  return deploy(deployOptions);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function progress(callback?: ProgressCallback) {
  return (step: DeployStepName, status: DeployStepStatus, message: string): void => {
    if (callback) {
      const event: DeployProgress = { step, status, message };
      callback(event);
    }
  };
}

function aborted(): DeployResult {
  return {
    success: false,
    preflight: null,
    healthy: false,
    error: "Deploy aborted",
  };
}

// ── Host Firewall: Ollama Reachability ────────────────────────────────────

/**
 * Allow container → host traffic to Ollama (port 11434) on the Docker bridges.
 *
 * On UFW hosts a raw iptables rule is wiped by the next `ufw reload` — today's
 * recurring "Clawdius went silent after reboot" bug. UFW allow rules persist
 * across reloads and reboots and cover INPUT + FORWARD, which matches how
 * docker-compose attaches containers to custom bridges (traffic to the
 * bridge gateway hits INPUT, not FORWARD).
 *
 * Fallback to raw iptables when UFW is inactive. Best-effort: no sudo → skip
 * and let doctor flag it with an actionable fix.
 */
async function ensureOllamaReachable(
  report: (step: DeployStepName, status: DeployStepStatus, message: string) => void,
): Promise<void> {
  const subnet = "172.16.0.0/12";
  const port = "11434";

  let ufwActive = false;
  try {
    const { stdout } = await execFileAsync("systemctl", ["is-active", "ufw"], { timeout: 2000 });
    ufwActive = stdout.trim() === "active";
  } catch {
    // systemctl missing / ufw unit absent → treat as inactive
  }

  try {
    if (ufwActive) {
      await execFileAsync(
        "sudo",
        ["ufw", "allow", "from", subnet, "to", "any", "port", port, "proto", "tcp",
         "comment", "clawhq→ollama"],
        { timeout: 5000 },
      );
      report("compose-up", "done", "Ollama reachability rule applied (ufw)");
    } else {
      try {
        await execFileAsync(
          "sudo",
          ["iptables", "-C", "FORWARD", "-s", subnet, "-p", "tcp", "--dport", port, "-j", "ACCEPT"],
          { timeout: 5000 },
        );
      } catch {
        await execFileAsync(
          "sudo",
          ["iptables", "-I", "FORWARD", "-s", subnet, "-p", "tcp", "--dport", port, "-j", "ACCEPT"],
          { timeout: 5000 },
        );
        report("compose-up", "done", "Ollama reachability rule applied (iptables)");
      }
    }
  } catch {
    // sudo unavailable or rule add failed — non-fatal, doctor surfaces it.
  }
}

// ── Identity File Immutability ────────────────────────────────────────────

interface IdentityLockResult {
  success: boolean;
  filesLocked: number;
  error?: string;
}

/**
 * Mark identity files immutable with chattr +i.
 *
 * Prevents the agent from modifying its own identity files even if it
 * gains write access through a prompt injection exploit. Requires sudo.
 * Files: workspace/identity/*.md (SOUL.md, AGENTS.md, USER.md, TOOLS.md, etc.)
 */
async function lockIdentityFiles(deployDir: string): Promise<IdentityLockResult> {
  const identityDir = join(deployDir, "workspace", "identity");

  try {
    const files = await readdir(identityDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));

    if (mdFiles.length === 0) {
      return { success: true, filesLocked: 0 };
    }

    const paths = mdFiles.map((f) => join(identityDir, f));

    await execFileAsync("sudo", ["chattr", "+i", ...paths], { timeout: 10_000 });
    return { success: true, filesLocked: mdFiles.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Directory doesn't exist yet — not an error, identity files just haven't been generated
    if (msg.includes("ENOENT")) {
      return { success: true, filesLocked: 0 };
    }
    return { success: false, filesLocked: 0, error: msg };
  }
}

/**
 * Remove immutable flag from identity files before shutdown.
 * Required so files can be updated on next deploy cycle.
 */
async function unlockIdentityFiles(deployDir: string): Promise<void> {
  const identityDir = join(deployDir, "workspace", "identity");
  try {
    const files = await readdir(identityDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    if (mdFiles.length === 0) return;
    const paths = mdFiles.map((f) => join(identityDir, f));
    await execFileAsync("sudo", ["chattr", "-i", ...paths], { timeout: 10_000 });
  } catch {
    // Best-effort unlock — don't fail shutdown for this
  }
}
