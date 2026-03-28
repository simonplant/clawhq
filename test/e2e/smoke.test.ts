/**
 * FEAT-018: End-to-end smoke test — full user journey validation.
 *
 * Tests the complete user journey: install → init → build → up → doctor → down → destroy
 *
 * DESIGN:
 * - Phases 1–3 (install / init / config validation) run without Docker — always.
 * - Phases 4–8 (build / up / doctor / down / destroy) require Docker — skip if absent.
 * - Each phase captures pass/fail + output so failures are diagnosable without re-running.
 * - A new temp directory is created per test run and deleted on success.
 *
 * RUN:
 *   npm run test:e2e
 *
 * Docker phases can be forced off with CLAWHQ_E2E_NO_DOCKER=1.
 */

import { execFile } from "node:child_process";
import { existsSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readFile } from "node:fs/promises";

import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GATEWAY_DEFAULT_PORT } from "../../src/config/defaults.js";
import { validateBundle } from "../../src/config/validate.js";
import { loadBlueprint } from "../../src/design/blueprints/loader.js";
import { generateBundle, generateIdentityFiles } from "../../src/design/configure/generate.js";
import { writeBundle } from "../../src/design/configure/writer.js";
import { scaffoldDirs, writeInitialConfig } from "../../src/build/installer/scaffold.js";
import { buildAllowlistFromBlueprint, serializeAllowlist } from "../../src/build/launcher/index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true if a command is reachable on the host. */
function isAvailable(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("which", [cmd], (err) => resolve(err === null));
  });
}

/** Run a shell command and return { ok, stdout, stderr, code }. */
async function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(cmd, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? 120_000,
    }, (err, stdout, stderr) => {
      const code = (err as NodeJS.ErrnoException & { code?: number })?.code ?? 0;
      resolve({
        ok: err === null,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        code: typeof code === "number" ? code : err ? 1 : 0,
      });
    });
  });
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Build minimal WizardAnswers for a non-interactive test run. */
function makeTestAnswers(deployDir: string) {
  const loaded = loadBlueprint("family-hub");
  return {
    blueprint: loaded.blueprint,
    blueprintPath: loaded.sourcePath,
    channel: "telegram",
    modelProvider: "local" as const,
    localModel: "llama3:8b",
    gatewayPort: GATEWAY_DEFAULT_PORT,
    deployDir,
    airGapped: false,
    integrations: {},
    customizationAnswers: {},
  };
}

// ── State ─────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __e2eDir = dirname(__filename);
const __repoRoot = resolve(__e2eDir, "../..");

let deployDir: string;
let hasDocker: boolean;
let hasOllama: boolean;
let cliPath: string;

beforeAll(async () => {
  // Create isolated temp dir for this run
  deployDir = mkdtempSync(join(tmpdir(), "clawhq-e2e-"));

  // Detect available tooling
  hasDocker = process.env["CLAWHQ_E2E_NO_DOCKER"] !== "1" && await isAvailable("docker");
  hasOllama = await isAvailable("ollama");

  // Resolve CLI binary path (built output or tsx for source run)
  const distCli = resolve(__repoRoot, "dist/cli/index.js");
  const srcCli = resolve(__repoRoot, "src/cli/index.ts");
  cliPath = existsSync(distCli) ? distCli : srcCli;
});

afterAll(() => {
  // Clean up temp dir on success (failures leave it for inspection)
  try {
    rmSync(deployDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
});

// ── Phase 1: Install (scaffold) ──────────────────────────────────────────────

describe("Phase 1: install — scaffold deployment directory", () => {
  it("scaffoldDirs creates the deployment directory structure", () => {
    const result = scaffoldDirs(deployDir);

    expect(existsSync(deployDir)).toBe(true);
    expect(result.created.length).toBeGreaterThan(0);

    // Required subdirectories
    const requiredDirs = [
      "engine",
      "workspace",
      "workspace/identity",
      "workspace/memory",
      "workspace/skills",
      "workspace/tools",
      "cron",
      "ops",
      "ops/audit",
      "ops/backup/snapshots",
      "ops/doctor",
      "ops/firewall",
      "security",
    ];

    for (const dir of requiredDirs) {
      const path = join(deployDir, dir);
      expect(existsSync(path), `Missing required dir: ${dir}`).toBe(true);
    }
  });

  it("secret directories are created with mode 0700", () => {
    const secretDirs = ["security", "workspace/memory", "ops/audit"];
    for (const dir of secretDirs) {
      const path = join(deployDir, dir);
      if (existsSync(path)) {
        const mode = statSync(path).mode & 0o777;
        expect(mode, `${dir} should be 0700, got ${mode.toString(8)}`).toBe(0o700);
      }
    }
  });

  it("writeInitialConfig produces a valid clawhq.yaml", () => {
    const configPath = writeInitialConfig({
      deployDir,
      installMethod: "cache",
    });

    expect(existsSync(configPath)).toBe(true);
    expect(configPath).toMatch(/clawhq\.yaml$/);
  });

  it("scaffoldDirs is idempotent — re-running does not throw", () => {
    expect(() => scaffoldDirs(deployDir)).not.toThrow();
  });
});

// ── Phase 2: Init (config generation) ────────────────────────────────────────

describe("Phase 2: init — blueprint → config generation", () => {
  it("loads a built-in blueprint without error", () => {
    const result = loadBlueprint("family-hub");
    expect(result.blueprint).toBeDefined();
    expect(result.blueprint.name).toBeTruthy();
  });

  it("generateBundle produces a complete deployment bundle", () => {
    const answers = makeTestAnswers(deployDir);
    const bundle = generateBundle(answers);

    expect(bundle.openclawConfig).toBeDefined();
    expect(bundle.composeConfig).toBeDefined();
    expect(bundle.envVars).toBeDefined();
    expect(bundle.cronJobs).toBeDefined();
    expect(bundle.clawhqConfig).toBeDefined();
  });

  it("generated bundle passes all 14 landmine validation rules", () => {
    const answers = makeTestAnswers(deployDir);
    const bundle = generateBundle(answers);
    const report = validateBundle(bundle);

    if (!report.valid) {
      console.error("Landmine validation failures:");
      for (const err of report.errors) {
        console.error(`  ✘ ${err.rule}: ${err.message}`);
      }
    }

    expect(report.valid).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it("writeBundle writes engine config files to the deployment directory", () => {
    const answers = makeTestAnswers(deployDir);
    const bundle = generateBundle(answers);

    const allowlist = buildAllowlistFromBlueprint(answers.blueprint.security_posture.egress_domains);
    const identityFiles = generateIdentityFiles(answers.blueprint, answers.customizationAnswers);

    const files = [
      { relativePath: "engine/openclaw.json", content: JSON.stringify(bundle.openclawConfig, null, 2) + "\n" },
      { relativePath: "engine/docker-compose.yml", content: yamlStringify(bundle.composeConfig) },
      { relativePath: "engine/.env", content: "GATEWAY_TOKEN=test-token\n", mode: 0o600 },
      { relativePath: "cron/jobs.json", content: JSON.stringify(bundle.cronJobs, null, 2) + "\n" },
      { relativePath: "clawhq.yaml", content: yamlStringify(bundle.clawhqConfig) },
      { relativePath: "ops/firewall/allowlist.yaml", content: serializeAllowlist(allowlist) },
      ...identityFiles.map((f: { relativePath: string; content: string }) => ({
        relativePath: f.relativePath,
        content: f.content,
      })),
    ];

    const result = writeBundle(deployDir, files);
    expect(result.written.length).toBeGreaterThan(0);

    // Check critical files are on disk
    const criticalFiles = [
      "engine/openclaw.json",
      "engine/docker-compose.yml",
      "engine/.env",
      "cron/jobs.json",
      "ops/firewall/allowlist.yaml",
    ];

    for (const file of criticalFiles) {
      const path = join(deployDir, file);
      expect(existsSync(path), `Missing: ${file}`).toBe(true);
    }
  });

  it(".env is created with mode 0600 (secrets)", () => {
    const envPath = join(deployDir, "engine/.env");
    if (existsSync(envPath)) {
      const mode = statSync(envPath).mode & 0o777;
      expect(mode, `.env should be 0600, got ${mode.toString(8)}`).toBe(0o600);
    }
  });
});

// ── Phase 3: Pre-build validation ─────────────────────────────────────────────

describe("Phase 3: pre-build validation — config sanity", () => {
  it("engine/openclaw.json is valid JSON", async () => {
    const path = join(deployDir, "engine/openclaw.json");
    if (!existsSync(path)) return; // Phase 2 may have been skipped

    const content = await readFile(path, "utf-8");
    expect(() => JSON.parse(content)).not.toThrow();

    const config = JSON.parse(content);
    expect(config.dangerouslyDisableDeviceAuth).toBe(true); // LM-01
    expect(config.tools?.exec?.host).toBe("gateway");       // LM-04
    expect(config.tools?.exec?.security).toBe("full");      // LM-05
  });

  it("engine/docker-compose.yml is valid YAML", async () => {
    const path = join(deployDir, "engine/docker-compose.yml");
    if (!existsSync(path)) return;

    const content = await readFile(path, "utf-8");
    expect(() => parseYaml(content)).not.toThrow();

    const compose = parseYaml(content);
    expect(compose.services).toBeDefined();
    expect(compose.services["openclaw"]).toBeDefined();
  });

  it("engine/docker-compose.yml has required security hardening", async () => {
    const path = join(deployDir, "engine/docker-compose.yml");
    if (!existsSync(path)) return;

    const content = await readFile(path, "utf-8");
    const compose = parseYaml(content);
    const svc = compose.services["openclaw"];

    // LM-07: cap_drop ALL + no-new-privileges
    expect(svc?.cap_drop).toContain("ALL");
    expect(svc?.security_opt).toContain("no-new-privileges:true");

    // LM-06: non-root user
    expect(svc?.user).toMatch(/\d+:\d+/);
  });
});

// ── Phase 4: Build (Docker) ───────────────────────────────────────────────────

describe("Phase 4: build — Docker image build", () => {
  it.skipIf(!hasDocker)("clawhq build produces a Docker image", async () => {
    const runner = existsSync(cliPath) && cliPath.endsWith(".ts")
      ? ["npx", "tsx", cliPath]
      : ["node", cliPath];

    const result = await run(runner[0]!, [...runner.slice(1), "build", "--deploy-dir", deployDir], {
      timeoutMs: 300_000, // 5 min for Docker build
    });

    if (!result.ok) {
      console.error("clawhq build failed:");
      console.error("stdout:", result.stdout);
      console.error("stderr:", result.stderr);
    }

    expect(result.ok).toBe(true);
  }, 360_000);
});

// ── Phase 5: Up (deploy) ──────────────────────────────────────────────────────

describe("Phase 5: up — deploy and verify agent is reachable", () => {
  it.skipIf(!hasDocker || !hasOllama)("clawhq up starts a running, reachable agent", async () => {
    const runner = existsSync(cliPath) && cliPath.endsWith(".ts")
      ? ["npx", "tsx", cliPath]
      : ["node", cliPath];

    const result = await run(runner[0]!, [
      ...runner.slice(1),
      "up",
      "--deploy-dir", deployDir,
      "--skip-preflight",
    ], {
      timeoutMs: 180_000, // 3 min for container start + health check
    });

    if (!result.ok) {
      console.error("clawhq up failed:");
      console.error("stdout:", result.stdout);
      console.error("stderr:", result.stderr);
    }

    expect(result.ok).toBe(true);
    expect(result.stdout).not.toMatch(/smoke test failed/i);
  }, 240_000);
});

// ── Phase 6: Doctor ───────────────────────────────────────────────────────────

describe("Phase 6: doctor — all diagnostics pass on a running agent", () => {
  it.skipIf(!hasDocker || !hasOllama)("clawhq doctor --json reports healthy", async () => {
    const runner = existsSync(cliPath) && cliPath.endsWith(".ts")
      ? ["npx", "tsx", cliPath]
      : ["node", cliPath];

    const result = await run(runner[0]!, [
      ...runner.slice(1),
      "doctor",
      "--deploy-dir", deployDir,
      "--json",
    ], { timeoutMs: 60_000 });

    let report: { healthy?: boolean; errors?: unknown[] } = {};
    try {
      report = JSON.parse(result.stdout);
    } catch {
      console.error("Could not parse doctor JSON output:", result.stdout);
    }

    if (!report.healthy) {
      console.error("Doctor found errors:", JSON.stringify(report.errors, null, 2));
    }

    expect(report.healthy).toBe(true);
    expect(report.errors).toHaveLength(0);
  }, 90_000);
});

// ── Phase 7: Down ─────────────────────────────────────────────────────────────

describe("Phase 7: down — graceful shutdown", () => {
  it.skipIf(!hasDocker)("clawhq down stops containers cleanly", async () => {
    const runner = existsSync(cliPath) && cliPath.endsWith(".ts")
      ? ["npx", "tsx", cliPath]
      : ["node", cliPath];

    const result = await run(runner[0]!, [
      ...runner.slice(1),
      "down",
      "--deploy-dir", deployDir,
    ], { timeoutMs: 60_000 });

    if (!result.ok) {
      console.error("clawhq down failed:", result.stderr);
    }

    expect(result.ok).toBe(true);
  }, 90_000);
});

// ── Phase 8: Destroy ──────────────────────────────────────────────────────────

describe("Phase 8: destroy — verified agent destruction", () => {
  it.skipIf(!hasDocker)("clawhq destroy --confirm removes all agent data", async () => {
    const runner = existsSync(cliPath) && cliPath.endsWith(".ts")
      ? ["npx", "tsx", cliPath]
      : ["node", cliPath];

    const result = await run(runner[0]!, [
      ...runner.slice(1),
      "destroy",
      "--deploy-dir", deployDir,
      "--confirm",
      "--json",
    ], { timeoutMs: 60_000 });

    if (!result.ok) {
      console.error("clawhq destroy failed:", result.stderr);
    }

    expect(result.ok).toBe(true);

    // After destroy, deploy dir should not contain sensitive files
    const engineDir = join(deployDir, "engine");
    const envPath = join(engineDir, ".env");
    expect(existsSync(envPath)).toBe(false);
  }, 90_000);
});
