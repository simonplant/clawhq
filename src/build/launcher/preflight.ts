/**
 * Preflight checks for deploy.
 *
 * Six checks run before `clawhq up` proceeds. Five are hard gates
 * (docker, images, config, secrets, ports) and one is a warning
 * (ollama). Warnings are reported but do not block deploy.
 * Each check returns an actionable error message on failure —
 * never a generic "check failed" message.
 */

import { execFile } from "node:child_process";
import { access, constants, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { FILE_MODE_SECRET, GATEWAY_DEFAULT_PORT, PREFLIGHT_EXEC_TIMEOUT_MS } from "../../config/defaults.js";

import type { PreflightCheckName, PreflightCheckResult, PreflightReport } from "./types.js";

const execFileAsync = promisify(execFile);

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Run all preflight checks. Every check runs even if earlier ones fail,
 * so the user gets a complete picture in one pass.
 */
export async function runPreflight(
  deployDir: string,
  signal?: AbortSignal,
  gatewayPort?: number,
  runtime?: string,
): Promise<PreflightReport> {
  const port = gatewayPort ?? GATEWAY_DEFAULT_PORT;
  const checks = await Promise.all([
    checkDocker(signal),
    checkImages(deployDir, signal),
    checkConfig(deployDir),
    checkCompose(deployDir),
    checkSecrets(deployDir),
    checkPorts(port, signal),
    checkOllama(signal),
    ...(runtime === "runsc" ? [checkGvisor(signal)] : []),
  ]);

  const warnings = checks.filter((c) => !c.passed && c.warning);
  const failed = checks.filter((c) => !c.passed && !c.warning);

  return {
    passed: failed.length === 0,
    checks,
    failed,
    warnings,
  };
}

// ── Individual Checks ───────────────────────────────────────────────────────

/** 1. Docker daemon is running and accessible. */
async function checkDocker(signal?: AbortSignal): Promise<PreflightCheckResult> {
  const name: PreflightCheckName = "docker";
  try {
    await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"], {
      timeout: PREFLIGHT_EXEC_TIMEOUT_MS,
      signal,
    });
    return { name, passed: true, message: "Docker daemon is running" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found") || msg.includes("ENOENT")) {
      return {
        name,
        passed: false,
        message: "Docker is not installed",
        fix: "Install Docker: https://docs.docker.com/get-docker/",
      };
    }
    return {
      name,
      passed: false,
      message: "Docker daemon is not running",
      fix: "Start Docker with: sudo systemctl start docker (Linux) or open Docker Desktop (macOS)",
    };
  }
}

/** 2. Required Docker images are built (build manifest exists). */
async function checkImages(
  deployDir: string,
  signal?: AbortSignal,
): Promise<PreflightCheckResult> {
  const name: PreflightCheckName = "images";
  const manifestFile = join(deployDir, "engine", "build-manifest.json");

  try {
    await access(manifestFile, constants.R_OK);
  } catch (e) {
    return {
      name,
      passed: false,
      message: "No build manifest found — images have not been built",
      fix: "Run: clawhq build",
    };
  }

  try {
    const raw = await readFile(manifestFile, "utf-8");
    const manifest = JSON.parse(raw) as { imageTag?: string };
    const tag = manifest.imageTag ?? "openclaw:custom";

    await execFileAsync("docker", ["image", "inspect", tag], {
      timeout: PREFLIGHT_EXEC_TIMEOUT_MS,
      signal,
    });
    return { name, passed: true, message: `Image ${tag} is available` };
  } catch (e) {
    return {
      name,
      passed: false,
      message: "Built image not found in Docker — it may have been pruned",
      fix: "Run: clawhq build",
    };
  }
}

/** 3. OpenClaw config (openclaw.json) exists and is valid JSON. */
async function checkConfig(deployDir: string): Promise<PreflightCheckResult> {
  const name: PreflightCheckName = "config";
  const configFile = join(deployDir, "engine", "openclaw.json");

  try {
    const raw = await readFile(configFile, "utf-8");
    JSON.parse(raw);
    return { name, passed: true, message: "Config file is valid" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT")) {
      return {
        name,
        passed: false,
        message: "Config file not found at engine/openclaw.json",
        fix: "Run: clawhq init --guided",
      };
    }
    return {
      name,
      passed: false,
      message: `Config file has invalid JSON: ${msg}`,
      fix: "Fix the JSON syntax in engine/openclaw.json or re-run: clawhq init --guided",
    };
  }
}

/**
 * 3b. docker-compose.yml has valid structure for deploy.
 *
 * Catches the "skeleton compose" problem: a compose file that exists but
 * is missing the image field, extra_hosts, or tmpfs — causing silent failures
 * (container can't start, can't reach Ollama, read-only fs errors).
 */
async function checkCompose(deployDir: string): Promise<PreflightCheckResult> {
  const name: PreflightCheckName = "compose";
  const composePath = join(deployDir, "engine", "docker-compose.yml");

  try {
    const raw = await readFile(composePath, "utf-8");
    const { parse: yamlParse } = await import("yaml");
    const compose = yamlParse(raw) as Record<string, unknown> | null;

    if (!compose || typeof compose !== "object") {
      return {
        name,
        passed: false,
        message: "docker-compose.yml is empty or invalid YAML",
        fix: "Run: clawhq build",
      };
    }

    const services = compose["services"] as Record<string, unknown> | undefined;
    const openclaw = services?.["openclaw"] as Record<string, unknown> | undefined;

    if (!openclaw) {
      return {
        name,
        passed: false,
        message: "docker-compose.yml missing 'openclaw' service definition",
        fix: "Run: clawhq build",
      };
    }

    if (!openclaw["image"]) {
      return {
        name,
        passed: false,
        message: "docker-compose.yml has no image field — container cannot start",
        fix: "Run: clawhq build (regenerates compose from current config)",
      };
    }

    const extraHosts = openclaw["extra_hosts"] as string[] | undefined;
    if (!extraHosts || !extraHosts.some((h) => h.includes("host.docker.internal"))) {
      return {
        name,
        passed: false,
        message: "docker-compose.yml missing extra_hosts — Ollama will be unreachable from container",
        fix: "Run: clawhq build (regenerates compose with host mappings)",
      };
    }

    return { name, passed: true, message: "Compose file structure is valid" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT")) {
      return {
        name,
        passed: false,
        message: "docker-compose.yml not found",
        fix: "Run: clawhq build",
      };
    }
    return {
      name,
      passed: false,
      message: `Cannot parse docker-compose.yml: ${msg}`,
      fix: "Run: clawhq build",
    };
  }
}

/** 4. Secrets file (.env) exists and has correct permissions. */
async function checkSecrets(deployDir: string): Promise<PreflightCheckResult> {
  const name: PreflightCheckName = "secrets";
  const envFile = join(deployDir, "engine", ".env");

  try {
    const info = await stat(envFile);
    const mode = info.mode & 0o777;

    if (mode !== FILE_MODE_SECRET) {
      return {
        name,
        passed: false,
        message: `.env file permissions are ${mode.toString(8)} — must be 600`,
        fix: `Run: chmod 600 ${envFile}`,
      };
    }

    return { name, passed: true, message: "Secrets file exists with correct permissions" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT")) {
      return {
        name,
        passed: false,
        message: "Secrets file (.env) not found",
        fix: "Run: clawhq init --guided",
      };
    }
    return { name, passed: false, message: `Cannot read .env: ${msg}` };
  }
}

/** 5. Gateway port is not already in use. */
async function checkPorts(port: number, signal?: AbortSignal): Promise<PreflightCheckResult> {
  const name: PreflightCheckName = "ports";
  try {
    const { stdout } = await execFileAsync(
      "ss",
      ["-tlnp", `sport = :${port}`],
      { timeout: PREFLIGHT_EXEC_TIMEOUT_MS, signal },
    );

    // ss always outputs a header line; if there's a second line, port is in use
    const lines = stdout.trim().split("\n");
    if (lines.length > 1) {
      return {
        name,
        passed: false,
        message: `Port ${port} is already in use`,
        fix: `Stop the process using port ${port} or change the gateway port in openclaw.json`,
      };
    }

    return { name, passed: true, message: `Port ${port} is available` };
  } catch (e) {
    // ss not available (macOS) — try lsof
    try {
      await execFileAsync("lsof", ["-i", `:${port}`, "-sTCP:LISTEN"], {
        timeout: PREFLIGHT_EXEC_TIMEOUT_MS,
        signal,
      });
      // lsof exits 0 if port is in use
      return {
        name,
        passed: false,
        message: `Port ${port} is already in use`,
        fix: `Stop the process using port ${port} or change the gateway port in openclaw.json`,
      };
    } catch (e) {
      // lsof exits non-zero when port is free
      return { name, passed: true, message: `Port ${port} is available` };
    }
  }
}

/**
 * 6. Ollama is available (needed for local model inference).
 *
 * Ollama absence is a **warning**, not a hard failure. The agent can still
 * start — it just won't be able to run local model inference until Ollama
 * is installed and running. This allows CI environments and machines
 * without Ollama to complete `clawhq up` successfully.
 */
async function checkOllama(signal?: AbortSignal): Promise<PreflightCheckResult> {
  const name: PreflightCheckName = "ollama";
  try {
    await execFileAsync("ollama", ["list"], {
      timeout: PREFLIGHT_EXEC_TIMEOUT_MS,
      signal,
    });
    return { name, passed: true, message: "Ollama is running" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found") || msg.includes("ENOENT")) {
      return {
        name,
        passed: false,
        warning: true,
        message: "Ollama is not installed — local model inference will not be available",
        fix: "Install Ollama: https://ollama.ai/download",
      };
    }
    return {
      name,
      passed: false,
      warning: true,
      message: "Ollama is not running — local model inference will not be available",
      fix: "Start Ollama with: ollama serve",
    };
  }
}

/**
 * 7. gVisor (runsc) runtime is installed and registered with Docker.
 *
 * Only checked when the posture requests gVisor (hardened/under-attack).
 * Warning, not a blocker - if runsc isn't installed, compose omits
 * the runtime field and the container runs with default runc.
 */
async function checkGvisor(signal?: AbortSignal): Promise<PreflightCheckResult> {
  const name: PreflightCheckName = "gvisor";
  try {
    // Check if runsc binary exists
    await execFileAsync("runsc", ["--version"], {
      timeout: PREFLIGHT_EXEC_TIMEOUT_MS,
      signal,
    });

    // Verify Docker knows about the runtime
    const { stdout } = await execFileAsync("docker", [
      "info", "--format", "{{.Runtimes}}",
    ], { timeout: PREFLIGHT_EXEC_TIMEOUT_MS, signal });

    if (!stdout.includes("runsc")) {
      return {
        name,
        passed: false,
        warning: true,
        message: "gVisor (runsc) is installed but not registered as a Docker runtime",
        fix: "Add to /etc/docker/daemon.json: {\"runtimes\":{\"runsc\":{\"path\":\"/usr/bin/runsc\"}}} then restart Docker",
      };
    }

    return { name, passed: true, message: "gVisor (runsc) runtime is available" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found") || msg.includes("ENOENT")) {
      return {
        name,
        passed: false,
        warning: true,
        message: "gVisor (runsc) not installed - container will use default runc runtime",
        fix: "Install gVisor: https://gvisor.dev/docs/user_guide/install/",
      };
    }
    return {
      name,
      passed: false,
      warning: true,
      message: `gVisor check failed: ${msg}`,
      fix: "Install gVisor: https://gvisor.dev/docs/user_guide/install/",
    };
  }
}
