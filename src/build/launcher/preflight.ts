/**
 * Preflight checks for deploy.
 *
 * Six checks that must all pass before `clawhq up` proceeds.
 * Each check returns an actionable error message on failure —
 * never a generic "check failed" message.
 */

import { execFile } from "node:child_process";
import { access, constants, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";

import type { PreflightCheckName, PreflightCheckResult, PreflightReport } from "./types.js";

const execFileAsync = promisify(execFile);

// ── Constants ────────────────────────────────────────────────────────────────

const GATEWAY_PORT = GATEWAY_DEFAULT_PORT;
const EXEC_TIMEOUT_MS = 15_000;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Run all 6 preflight checks. Every check runs even if earlier ones fail,
 * so the user gets a complete picture in one pass.
 */
export async function runPreflight(
  deployDir: string,
  signal?: AbortSignal,
): Promise<PreflightReport> {
  const checks = await Promise.all([
    checkDocker(signal),
    checkImages(deployDir, signal),
    checkConfig(deployDir),
    checkSecrets(deployDir),
    checkPorts(signal),
    checkOllama(signal),
  ]);

  const failed = checks.filter((c) => !c.passed);

  return {
    passed: failed.length === 0,
    checks,
    failed,
  };
}

// ── Individual Checks ───────────────────────────────────────────────────────

/** 1. Docker daemon is running and accessible. */
async function checkDocker(signal?: AbortSignal): Promise<PreflightCheckResult> {
  const name: PreflightCheckName = "docker";
  try {
    await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"], {
      timeout: EXEC_TIMEOUT_MS,
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
    console.warn(`[preflight:images] Failed to access build manifest:`, e);
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
      timeout: EXEC_TIMEOUT_MS,
      signal,
    });
    return { name, passed: true, message: `Image ${tag} is available` };
  } catch (e) {
    console.warn(`[preflight:images] Failed to inspect Docker image:`, e);
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

/** 4. Secrets file (.env) exists and has correct permissions. */
async function checkSecrets(deployDir: string): Promise<PreflightCheckResult> {
  const name: PreflightCheckName = "secrets";
  const envFile = join(deployDir, "engine", ".env");

  try {
    const info = await stat(envFile);
    const mode = info.mode & 0o777;

    if (mode !== 0o600) {
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
async function checkPorts(signal?: AbortSignal): Promise<PreflightCheckResult> {
  const name: PreflightCheckName = "ports";
  try {
    const { stdout } = await execFileAsync(
      "ss",
      ["-tlnp", `sport = :${GATEWAY_PORT}`],
      { timeout: EXEC_TIMEOUT_MS, signal },
    );

    // ss always outputs a header line; if there's a second line, port is in use
    const lines = stdout.trim().split("\n");
    if (lines.length > 1) {
      return {
        name,
        passed: false,
        message: `Port ${GATEWAY_PORT} is already in use`,
        fix: `Stop the process using port ${GATEWAY_PORT} or change the gateway port in openclaw.json`,
      };
    }

    return { name, passed: true, message: `Port ${GATEWAY_PORT} is available` };
  } catch (e) {
    console.warn(`[preflight:ports] ss command failed, falling back to lsof:`, e);
    // ss not available (macOS) — try lsof
    try {
      await execFileAsync("lsof", ["-i", `:${GATEWAY_PORT}`, "-sTCP:LISTEN"], {
        timeout: EXEC_TIMEOUT_MS,
        signal,
      });
      // lsof exits 0 if port is in use
      return {
        name,
        passed: false,
        message: `Port ${GATEWAY_PORT} is already in use`,
        fix: `Stop the process using port ${GATEWAY_PORT} or change the gateway port in openclaw.json`,
      };
    } catch (e) {
      console.warn(`[preflight:ports] lsof check failed (port likely free):`, e);
      // lsof exits non-zero when port is free
      return { name, passed: true, message: `Port ${GATEWAY_PORT} is available` };
    }
  }
}

/** 6. Ollama is running (needed for local model inference). */
async function checkOllama(signal?: AbortSignal): Promise<PreflightCheckResult> {
  const name: PreflightCheckName = "ollama";
  try {
    await execFileAsync("ollama", ["list"], {
      timeout: EXEC_TIMEOUT_MS,
      signal,
    });
    return { name, passed: true, message: "Ollama is running" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found") || msg.includes("ENOENT")) {
      return {
        name,
        passed: false,
        message: "Ollama is not installed — required for local model inference",
        fix: "Install Ollama: https://ollama.ai/download",
      };
    }
    return {
      name,
      passed: false,
      message: "Ollama is not running — required for local model inference",
      fix: "Start Ollama with: ollama serve",
    };
  }
}
