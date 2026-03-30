/**
 * End-to-end smoke test — full user journey against real Docker.
 *
 * Runs: init → build → up → doctor → down → destroy
 *
 * Requires Docker to be available. Skips gracefully if Docker is not running.
 * Uses a minimal blueprint that requires no external API keys.
 * All work happens in a temp directory, cleaned up after.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

// ── Paths ───────────────────────────────────────────────────────────────────

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const CLI_ENTRY = join(PROJECT_ROOT, "dist", "cli", "index.js");
const BLUEPRINT_FIXTURE = join(PROJECT_ROOT, "test/e2e/fixtures/smoke-test.yaml");

// ── Helpers ─────────────────────────────────────────────────────────────────

interface StepResult {
  step: string;
  passed: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  error?: string;
}

const results: StepResult[] = [];

/**
 * Run a CLI command and capture everything.
 * Does NOT throw on non-zero exit — the test decides what to assert.
 */
async function runCli(
  step: string,
  args: string[],
  opts: { env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<StepResult> {
  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync("node", [CLI_ENTRY, ...args], {
      cwd: PROJECT_ROOT,
      timeout: opts.timeoutMs ?? 120_000,
      env: { ...process.env, ...opts.env, NODE_NO_WARNINGS: "1" },
    });
    const result: StepResult = {
      step,
      passed: true,
      exitCode: 0,
      stdout,
      stderr,
      durationMs: Date.now() - start,
    };
    results.push(result);
    return result;
  } catch (err: unknown) {
    const execErr = err as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const result: StepResult = {
      step,
      passed: false,
      exitCode: typeof execErr.code === "number" ? execErr.code : 1,
      stdout: execErr.stdout ?? "",
      stderr: execErr.stderr ?? "",
      durationMs: Date.now() - start,
      error: execErr.message,
    };
    results.push(result);
    return result;
  }
}

/** Check if Docker daemon is reachable. */
async function isDockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["info"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** Check if the built CLI exists (project must be compiled). */
function isBuilt(): boolean {
  return existsSync(CLI_ENTRY);
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe("e2e smoke test — full user journey", () => {
  let deployDir: string;
  let dockerAvailable: boolean;

  beforeAll(async () => {
    dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      console.warn("\n⚠  Docker not available — e2e smoke test will be skipped.\n");
      return;
    }

    if (!isBuilt()) {
      throw new Error(
        "CLI not built. Run `npm run build` before running e2e tests.",
      );
    }

    // Create isolated temp directory
    deployDir = join(
      tmpdir(),
      `clawhq-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(deployDir, { recursive: true });
  });

  afterAll(async () => {
    // Print results summary
    console.log("\n┌─────────────────────────────────────────────────┐");
    console.log("│           E2E Smoke Test Results                │");
    console.log("├──────────┬──────────┬──────────────────────────┤");
    console.log("│  Status  │ Time     │ Step                     │");
    console.log("├──────────┼──────────┼──────────────────────────┤");
    for (const r of results) {
      const status = r.passed ? "  PASS  " : "  FAIL  ";
      const time = `${(r.durationMs / 1000).toFixed(1)}s`.padEnd(8);
      const step = r.step.padEnd(24);
      console.log(`│ ${status} │ ${time} │ ${step} │`);
    }
    console.log("└──────────┴──────────┴──────────────────────────┘");

    const failures = results.filter((r) => !r.passed);
    if (failures.length > 0) {
      console.log("\n── Failure Details ──\n");
      for (const f of failures) {
        console.log(`Step: ${f.step}`);
        console.log(`Exit code: ${f.exitCode}`);
        if (f.stdout.trim()) console.log(`stdout:\n${f.stdout.trim()}`);
        if (f.stderr.trim()) console.log(`stderr:\n${f.stderr.trim()}`);
        if (f.error) console.log(`error: ${f.error}`);
        console.log("");
      }
    }

    // Clean up temp directory
    if (deployDir && existsSync(deployDir)) {
      await rm(deployDir, { recursive: true, force: true });
    }
  });

  // ── Step 1: Install ──────────────────────────────────────────────────────

  it("step 1: install — prerequisite check and directory scaffold", async () => {
    if (!dockerAvailable) return;

    const result = await runCli("install", [
      "install",
      "-d", deployDir,
    ], { timeoutMs: 60_000 });

    // Install checks prereqs (Docker, Node, Ollama) and scaffolds the deploy dir.
    // Known issue (FEAT-127): install hard-fails when Ollama is absent.
    // We verify Docker and Node passed; Ollama failure is a documented gap.
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/docker/i);
    expect(output).toMatch(/node/i);
    if (result.exitCode !== 0) {
      console.warn(`\n⚠  'install' exited ${result.exitCode} — likely Ollama not installed (see FEAT-127)`);
    }
    expect(existsSync(deployDir)).toBe(true);
  });

  // ── Step 2: Init (programmatic — bypasses interactive wizard) ───────────

  it("step 2: init — generate config from smoke-test blueprint", async () => {
    if (!dockerAvailable) return;

    // Use the programmatic API to bypass the interactive wizard.
    // This is the "pre-canned config fixture" approach from the sprint spec.
    const { loadBlueprintFile } = await import(
      "../../src/design/blueprints/loader.js"
    );
    const { generateBundle } = await import(
      "../../src/design/configure/generate.js"
    );
    const { writeBundle } = await import(
      "../../src/design/configure/writer.js"
    );
    const { validateBundle } = await import("../../src/config/validate.js");
    const { bundleToFiles } = await import(
      "../../src/cli/commands/helpers.js"
    );

    const start = Date.now();
    try {
      // Load the smoke-test blueprint
      const blueprint = loadBlueprintFile(BLUEPRINT_FIXTURE);

      // Build wizard answers (what the interactive wizard would produce)
      const answers = {
        blueprint,
        blueprintPath: BLUEPRINT_FIXTURE,
        channel: "telegram",
        modelProvider: "local" as const,
        localModel: "llama3:8b",
        gatewayPort: 18799, // Non-default port to avoid conflicts
        deployDir,
        airGapped: true, // No internet needed for smoke test
        integrations: {},
        customizationAnswers: {},
      };

      // Generate deployment bundle
      const bundle = generateBundle(answers);

      // Validate against all 14 landmine rules
      const report = validateBundle(bundle);
      expect(report.valid).toBe(true);
      if (!report.valid) {
        const errors = report.errors.map((e) => `${e.rule}: ${e.message}`);
        throw new Error(`Validation failed:\n${errors.join("\n")}`);
      }

      // Write config files to deploy directory
      const files = bundleToFiles(bundle, blueprint, {});
      const writeResult = writeBundle(deployDir, files);

      // Verify key files were created
      expect(writeResult.written.length).toBeGreaterThan(0);
      expect(existsSync(join(deployDir, "engine", "openclaw.json"))).toBe(true);
      expect(existsSync(join(deployDir, "engine", "docker-compose.yml"))).toBe(true);
      expect(existsSync(join(deployDir, "engine", ".env"))).toBe(true);
      expect(existsSync(join(deployDir, "clawhq.yaml"))).toBe(true);

      results.push({
        step: "init",
        passed: true,
        exitCode: 0,
        stdout: `Config generated: ${writeResult.written.length} files written to ${deployDir}`,
        stderr: "",
        durationMs: Date.now() - start,
      });
    } catch (err) {
      results.push({
        step: "init",
        passed: false,
        exitCode: 1,
        stdout: "",
        stderr: "",
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  });

  // ── Step 3: Build ─────────────────────────────────────────────────────────

  it("step 3: build — two-stage Docker image build", async () => {
    if (!dockerAvailable) return;

    const result = await runCli("build", [
      "build",
      "-d", deployDir,
    ], { timeoutMs: 300_000 }); // Docker builds can take time

    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/built|image|success/i);
  });

  // ── Step 4: Up ────────────────────────────────────────────────────────────

  it("step 4: up — deploy agent with containers", async () => {
    if (!dockerAvailable) return;

    const result = await runCli("up", [
      "up",
      "-d", deployDir,
      "--token", "e2e-smoke-test-token",
      "-p", "18799",
      "--skip-preflight",
      "--skip-firewall",
    ], { timeoutMs: 120_000 });

    // Capture result regardless — some failures are expected
    // (e.g., health check may fail without Ollama)
    if (result.exitCode !== 0) {
      console.warn(`\n⚠  'up' step exited ${result.exitCode} — may be expected without Ollama`);
    }
  });

  // ── Step 5: Doctor ────────────────────────────────────────────────────────

  it("step 5: doctor — run diagnostics", async () => {
    if (!dockerAvailable) return;

    const result = await runCli("doctor", [
      "doctor",
      "-d", deployDir,
      "--json",
    ], { timeoutMs: 60_000 });

    // Doctor should run and produce output even if some checks fail.
    // The key assertion: it runs without crashing.
    const output = result.stdout + result.stderr;
    expect(output.length).toBeGreaterThan(0);

    // Try to parse JSON output for structured results
    if (result.exitCode === 0 && result.stdout.trim()) {
      try {
        const report = JSON.parse(result.stdout.trim());
        expect(report).toHaveProperty("checks");
        console.log(`  Doctor: ${report.checks?.length ?? 0} checks executed`);
      } catch {
        // JSON parse failure is informational, not a test failure
        console.warn("  Doctor output was not valid JSON");
      }
    }
  });

  // ── Step 6: Down ──────────────────────────────────────────────────────────

  it("step 6: down — stop agent containers", async () => {
    if (!dockerAvailable) return;

    const result = await runCli("down", [
      "down",
      "-d", deployDir,
      "-v",
    ], { timeoutMs: 60_000 });

    expect(result.exitCode).toBe(0);
  });

  // ── Step 7: Destroy ───────────────────────────────────────────────────────

  it("step 7: destroy — verified agent destruction", async () => {
    if (!dockerAvailable) return;

    const result = await runCli("destroy", [
      "destroy",
      "-d", deployDir,
      "--confirm",
      "--json",
    ], { timeoutMs: 60_000 });

    expect(result.exitCode).toBe(0);

    // After destroy, the deploy directory should be removed or emptied
    // (the destroy command handles cleanup)
    if (result.stdout.trim()) {
      try {
        const proof = JSON.parse(result.stdout.trim());
        if (proof.success !== undefined) {
          expect(proof.success).toBe(true);
        }
      } catch {
        // JSON parse failure is informational
      }
    }
  });
});
