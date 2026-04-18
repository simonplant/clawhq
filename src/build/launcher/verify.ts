/**
 * Post-deploy integration verification.
 *
 * Runs after health-verify, before smoke-test. Tests that every configured
 * integration actually works from inside the container — not just that
 * the container started.
 *
 * This catches firewall misconfigurations, credential issues, and timeout
 * problems that are invisible from health checks alone.
 */

import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { CREDENTIALS_PROBE_TIMEOUT_MS, WEBSOCKET_EVENT_CALLER_TIMEOUT_MS } from "../../config/defaults.js";
import { runProbes } from "../../secure/credentials/health.js";

const execFileAsync = promisify(execFile);

// ── Types ──────────────────────────────────────────────────────────────────

export interface VerifyOptions {
  readonly deployDir: string;
  readonly signal?: AbortSignal;
}

export interface VerifyCheckResult {
  readonly name: string;
  readonly passed: boolean;
  readonly message: string;
  readonly fix?: string;
  readonly durationMs: number;
}

export interface VerifyReport {
  readonly timestamp: string;
  readonly checks: readonly VerifyCheckResult[];
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly healthy: boolean;
}

// ── Shell Safety ──────────────────────────────────────────────────────────

/** Strip characters unsafe for shell interpolation. Only allows alphanumeric, dots, dashes, underscores, colons, and slashes. */
function shellSafe(s: string): string {
  return s.replace(/[^a-zA-Z0-9._:/-]/g, "");
}

// ── Container Exec Helper ──────────────────────────────────────────────────

/** Run a command inside the running OpenClaw container. Returns stdout or null on failure. */
async function containerExec(
  deployDir: string,
  cmd: string[],
  timeoutMs = CREDENTIALS_PROBE_TIMEOUT_MS,
): Promise<{ stdout: string } | { error: string }> {
  try {
    const composePath = join(deployDir, "engine", "docker-compose.yml");
    const { stdout } = await execFileAsync(
      "docker",
      ["compose", "-f", composePath, "exec", "-T", "openclaw", ...cmd],
      { timeout: timeoutMs },
    );
    return { stdout: stdout.trim() };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

// ── Individual Checks ──────────────────────────────────────────────────────

/**
 * Test network reachability of a host:port from inside the container.
 * Uses bash timeout + /dev/tcp which is available in most containers.
 */
async function checkReachable(
  deployDir: string,
  host: string,
  port: number,
  label: string,
): Promise<VerifyCheckResult> {
  const start = Date.now();
  const result = await containerExec(
    deployDir,
    ["bash", "-c", `timeout 5 bash -c 'echo > /dev/tcp/'${shellSafe(host)}'/'${shellSafe(String(port))} 2>&1`],
    10_000,
  );

  if ("error" in result) {
    return {
      name: label,
      passed: false,
      message: `Cannot reach ${host}:${port} from container`,
      fix: `Check egress firewall allowlist — run: clawhq doctor`,
      durationMs: Date.now() - start,
    };
  }

  return {
    name: label,
    passed: true,
    message: `${host}:${port} reachable`,
    durationMs: Date.now() - start,
  };
}

/** Parse .env file into key-value map. */
function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const eqIdx = line.indexOf("=");
    if (eqIdx > 0 && !line.startsWith("#")) {
      env[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
    }
  }
  return env;
}

// ── Main Verify Function ───────────────────────────────────────────────────

/**
 * Run post-deploy integration verification.
 *
 * 1. Credential probes (API keys valid — runs from host)
 * 2. Container reachability (IMAP, SMTP, FastMail — tests from inside container)
 * 3. LLM budget check (compares probe response time to timeout budget)
 */
export async function verifyIntegrations(options: VerifyOptions): Promise<VerifyReport> {
  const { deployDir } = options;
  const checks: VerifyCheckResult[] = [];

  // Read .env for integration detection
  const { readFileSync } = await import("node:fs");
  let envContent: string;
  try {
    envContent = readFileSync(join(deployDir, "engine", ".env"), "utf-8");
  } catch {
    return {
      timestamp: new Date().toISOString(),
      checks: [],
      passed: 0,
      failed: 0,
      skipped: 0,
      healthy: true,
    };
  }

  const env = parseEnvFile(envContent);

  // ── Credential probes (from host) ────────────────────────────────────
  const start = Date.now();
  const probeReport = await runProbes({
    envPath: join(deployDir, "engine", ".env"),
    includeUnconfigured: false,
  });

  for (const result of probeReport.results) {
    checks.push({
      name: `cred:${result.integration.toLowerCase()}`,
      passed: result.ok,
      message: result.ok ? `${result.integration} credentials valid` : result.message,
      fix: result.fix,
      durationMs: Date.now() - start,
    });
  }

  // ── Container reachability checks ────────────────────────────────────
  // Test that the container can actually reach services (catches firewall blocks)

  const reachabilityChecks: Array<{ host: string; port: number; label: string }> = [];

  // IMAP
  if (env.IMAP_HOST) {
    reachabilityChecks.push({
      host: env.IMAP_HOST,
      port: parseInt(env.IMAP_PORT || "993", 10),
      label: `net:imap (${env.IMAP_HOST})`,
    });
  }

  // SMTP
  if (env.SMTP_HOST) {
    reachabilityChecks.push({
      host: env.SMTP_HOST,
      port: parseInt(env.SMTP_PORT || "587", 10),
      label: `net:smtp (${env.SMTP_HOST})`,
    });
  }

  // FastMail JMAP
  if (env.FASTMAIL_API_TOKEN) {
    reachabilityChecks.push({
      host: "api.fastmail.com",
      port: 443,
      label: "net:fastmail (api.fastmail.com)",
    });
  }

  // CalDAV
  if (env.CALDAV_URL) {
    try {
      const url = new URL(env.CALDAV_URL);
      reachabilityChecks.push({
        host: url.hostname,
        port: url.port ? parseInt(url.port, 10) : (url.protocol === "https:" ? 443 : 80),
        label: `net:caldav (${url.hostname})`,
      });
    } catch { /* invalid URL — skip */ }
  }

  // Home Assistant
  if (env.HA_URL) {
    try {
      const url = new URL(env.HA_URL);
      reachabilityChecks.push({
        host: url.hostname,
        port: url.port ? parseInt(url.port, 10) : (url.protocol === "https:" ? 443 : 80),
        label: `net:homeassistant (${url.hostname})`,
      });
    } catch { /* invalid URL — skip */ }
  }

  // Telegram
  if (env.TELEGRAM_BOT_TOKEN) {
    reachabilityChecks.push({
      host: "api.telegram.org",
      port: 443,
      label: "net:telegram (api.telegram.org)",
    });
  }

  // Run reachability checks concurrently
  const reachResults = await Promise.all(
    reachabilityChecks.map((c) => checkReachable(deployDir, c.host, c.port, c.label)),
  );
  checks.push(...reachResults);

  // ── LLM timeout budget check ─────────────────────────────────────────
  // If using Ollama, check that the model can respond within the timeout budget
  if (env.OLLAMA_HOST || env.OLLAMA_URL) {
    const llmStart = Date.now();
    const ollamaHost = env.OLLAMA_HOST || env.OLLAMA_URL || "http://ollama:11434";

    // Test from container: can we reach Ollama?
    try {
      const url = new URL(ollamaHost);
      const reachResult = await checkReachable(
        deployDir,
        url.hostname === "host.docker.internal" ? "host.docker.internal" : url.hostname,
        url.port ? parseInt(url.port, 10) : 11434,
        "net:ollama",
      );
      checks.push(reachResult);

      if (reachResult.passed) {
        // Quick generate test from host to measure actual latency.
        // Body built with JSON.stringify and passed as an argv arg — no shell, no interpolation.
        const body = JSON.stringify({
          model: env.OLLAMA_MODEL || "gemma4:26b",
          prompt: "Reply OK",
          stream: false,
        });
        const genResult = await containerExec(
          deployDir,
          [
            "curl", "-s", "-m", "120", "-X", "POST",
            `${ollamaHost}/api/generate`,
            "-H", "Content-Type: application/json",
            "-d", body,
          ],
          130_000,
        );

        const llmDuration = Date.now() - llmStart;
        const budgetMs = WEBSOCKET_EVENT_CALLER_TIMEOUT_MS;

        if ("error" in genResult) {
          checks.push({
            name: "llm:response",
            passed: false,
            message: `Ollama did not respond within 120s`,
            fix: "Check Ollama is running and model is loaded: ollama list",
            durationMs: llmDuration,
          });
        } else {
          const withinBudget = llmDuration < budgetMs * 0.8; // 80% of budget = safe margin
          checks.push({
            name: "llm:response",
            passed: withinBudget,
            message: withinBudget
              ? `LLM responded in ${(llmDuration / 1000).toFixed(1)}s (budget: ${budgetMs / 1000}s)`
              : `LLM took ${(llmDuration / 1000).toFixed(1)}s — close to ${budgetMs / 1000}s timeout budget`,
            fix: withinBudget ? undefined : "Increase WEBSOCKET_EVENT_CALLER_TIMEOUT or use a faster model",
            durationMs: llmDuration,
          });
        }
      }
    } catch { /* invalid URL — skip */ }
  }

  // ── Aggregate ────────────────────────────────────────────────────────
  const passed = checks.filter((c) => c.passed).length;
  const failed = checks.filter((c) => !c.passed).length;

  return {
    timestamp: new Date().toISOString(),
    checks,
    passed,
    failed,
    skipped: 0,
    healthy: failed === 0,
  };
}

// ── Formatter ──────────────────────────────────────────────────────────────

/** Format a verify report as a terminal table. */
export function formatVerifyReport(report: VerifyReport): string {
  if (report.checks.length === 0) {
    return "  No integrations to verify.";
  }

  const lines: string[] = [];
  for (const check of report.checks) {
    const icon = check.passed ? "✔" : "✘";
    const time = check.durationMs < 1000
      ? `${check.durationMs}ms`
      : `${(check.durationMs / 1000).toFixed(1)}s`;
    lines.push(`  ${icon} ${check.name.padEnd(35)} ${check.message} (${time})`);
    if (check.fix && !check.passed) {
      lines.push(`    → ${check.fix}`);
    }
  }

  lines.push("");
  lines.push(`  ${report.passed} passed, ${report.failed} failed`);

  return lines.join("\n");
}
