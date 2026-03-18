/**
 * Pre-flight checks for deployment.
 *
 * Validates all prerequisites before starting containers:
 * Docker daemon, images exist, config valid, secrets present,
 * ports available, Ollama reachable.
 *
 * Each failure includes the exact fix command.
 */

import { access, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";

import { loadOpenClawConfig } from "../../config/loader.js";
import type { OpenClawConfig } from "../../config/schema.js";
import { validate } from "../../config/validator.js";
import { DaemonNotRunning, DockerClient } from "../docker/client.js";

import type { DeployOptions, PreflightResult, StepResult } from "./types.js";

async function timedStep(
  name: string,
  fn: () => Promise<{ passed: boolean; message: string }>,
): Promise<StepResult> {
  const start = Date.now();
  try {
    const { passed, message } = await fn();
    return {
      name,
      status: passed ? "done" : "failed",
      message,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    return {
      name,
      status: "failed",
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

function checkPort(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

export async function runPreflight(opts: DeployOptions): Promise<PreflightResult> {
  const openclawHome = opts.openclawHome ?? join(process.env.HOME ?? "~", ".openclaw");
  const configPath = opts.configPath ?? join(openclawHome, "openclaw.json");
  const envPath = opts.envPath ?? join(openclawHome, ".env");
  const imageTag = opts.imageTag ?? "openclaw:custom";
  const baseTag = opts.baseTag ?? "openclaw:local";
  const gatewayPort = opts.gatewayPort ?? 18789;
  const gatewayHost = opts.gatewayHost ?? "127.0.0.1";

  const steps: StepResult[] = [];

  // 1. Docker daemon
  const dockerStep = await timedStep("Docker daemon", async () => {
    const client = new DockerClient();
    try {
      await client.exec(["info"]);
      return { passed: true, message: "Docker daemon is running" };
    } catch (err: unknown) {
      if (err instanceof DaemonNotRunning) {
        return {
          passed: false,
          message: "Docker daemon is not running. Fix: sudo systemctl start docker",
        };
      }
      return {
        passed: false,
        message: `Docker check failed: ${err instanceof Error ? err.message : String(err)}. Fix: Ensure Docker is installed and accessible`,
      };
    }
  });
  steps.push(dockerStep);

  // Abort early if Docker is not available — remaining checks depend on it
  if (dockerStep.status === "failed") {
    return { passed: false, steps };
  }

  // 2. Images exist
  steps.push(await timedStep("Container images", async () => {
    const client = new DockerClient();
    const missing: string[] = [];
    for (const tag of [baseTag, imageTag]) {
      if (!(await client.imageExists(tag))) {
        missing.push(tag);
      }
    }
    if (missing.length > 0) {
      return {
        passed: false,
        message: `Missing images: ${missing.join(", ")}. Fix: clawhq build`,
      };
    }
    return { passed: true, message: `Images found: ${baseTag}, ${imageTag}` };
  }));

  // 3. Config valid
  steps.push(await timedStep("Config validation", async () => {
    let openclawConfig: OpenClawConfig;
    try {
      openclawConfig = await loadOpenClawConfig(configPath) as OpenClawConfig;
    } catch {
      return {
        passed: false,
        message: `Cannot read ${configPath}. Fix: Ensure openclaw.json exists at ${configPath}`,
      };
    }

    let composeContent: string | undefined;
    if (opts.composePath) {
      try {
        composeContent = await readFile(opts.composePath, "utf-8");
      } catch {
        // Non-fatal — compose validation will be partial
      }
    }

    let envContent: string | undefined;
    try {
      envContent = await readFile(envPath, "utf-8");
    } catch {
      // Checked separately below
    }

    const results = validate({
      openclawConfig,
      openclawHome,
      composePath: opts.composePath,
      composeContent,
      envPath,
      envContent,
    });

    const failures = results.filter((r) => r.status === "fail");
    if (failures.length > 0) {
      const details = failures.map((f) => `${f.rule}: ${f.message}. Fix: ${f.fix}`).join("; ");
      return { passed: false, message: `Config validation failed: ${details}` };
    }
    return { passed: true, message: "Config passes all landmine rules" };
  }));

  // 4. Secrets present (.env readable)
  steps.push(await timedStep("Secrets file", async () => {
    try {
      await access(envPath);
      return { passed: true, message: `.env file found at ${envPath}` };
    } catch {
      return {
        passed: false,
        message: `No .env file at ${envPath}. Fix: Create .env with required secrets (chmod 600)`,
      };
    }
  }));

  // 5. Port available
  steps.push(await timedStep("Port availability", async () => {
    const available = await checkPort(gatewayPort, gatewayHost);
    if (available) {
      return { passed: true, message: `Port ${gatewayPort} is available` };
    }
    return {
      passed: false,
      message: `Port ${gatewayPort} is in use. Fix: lsof -i :${gatewayPort} | grep LISTEN`,
    };
  }));

  // 6. Ollama reachable (if configured — non-blocking)
  steps.push(await timedStep("Ollama reachable", async () => {
    try {
      const response = await fetch("http://127.0.0.1:11434/api/tags", {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        return { passed: true, message: "Ollama is running" };
      }
      return {
        passed: true,
        message: "Ollama responded but may be degraded (non-blocking)",
      };
    } catch {
      return {
        passed: true,
        message: "Ollama not reachable at localhost:11434 (non-blocking — cloud models may be used)",
      };
    }
  }));

  const passed = steps.every((s) => s.status === "done");
  return { passed, steps };
}
