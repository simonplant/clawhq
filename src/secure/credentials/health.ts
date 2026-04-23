/**
 * Credential health — probe runner and report aggregation.
 *
 * Reads the .env file, runs all registered probes (skipping integrations
 * that aren't configured unless explicitly requested), and produces a
 * ProbeReport with pass/fail counts.
 */

import { getAllEnvValues, readEnv } from "./env-store.js";
import type { CredentialProbe, ProbeReport, ProbeResult } from "./probe-types.js";
import { builtinProbes } from "./probes.js";

// ── Options ──────────────────────────────────────────────────────────────────

export interface RunProbesOptions {
  /** Path to the .env file to read credentials from. */
  readonly envPath: string;
  /** Additional probes beyond the built-in set. */
  readonly extraProbes?: readonly CredentialProbe[];
  /** If true, include probes for integrations that have no env key set. Default: true. */
  readonly includeUnconfigured?: boolean;
}

// ── Runner ───────────────────────────────────────────────────────────────────

/**
 * Run all credential probes and produce an aggregate report.
 *
 * Probes run concurrently (they're independent network calls).
 * Never throws — individual probe failures are captured in results.
 */
export async function runProbes(options: RunProbesOptions): Promise<ProbeReport> {
  const env = getAllEnvValues(readEnv(options.envPath));
  const probes: readonly CredentialProbe[] = options.extraProbes
    ? [...builtinProbes, ...options.extraProbes]
    : builtinProbes;

  const results: ProbeResult[] = await Promise.all(
    probes.map((probe) => probe(env)),
  );

  // Default: only show integrations that are actually configured. Previously
  // defaulted to `true`, which made the report noisy and non-idempotent —
  // adding a new probe to `builtinProbes` would change every future report
  // even for users who never configured that integration. Callers that want
  // the full matrix can opt in explicitly.
  const includeUnconfigured = options.includeUnconfigured ?? false;
  const filtered = includeUnconfigured
    ? results
    : results.filter((r) => r.message !== "Not configured");

  const passed = filtered.filter((r) => r.ok).length;
  const skipped = filtered.filter((r) => !r.ok && r.message === "Not configured").length;
  const failed = filtered.filter((r) => !r.ok && r.message !== "Not configured").length;

  return {
    timestamp: new Date().toISOString(),
    results: filtered,
    passed,
    failed,
    skipped,
    healthy: failed === 0 && filtered.length > 0,
  };
}

// ── Table Formatter ──────────────────────────────────────────────────────────

/**
 * Format a ProbeReport as a clean status table for terminal output.
 *
 * Example output:
 * ```
 *   Integration   Key                   Status   Message
 *   ───────────   ───────────────────   ──────   ───────────────────────────
 *   Anthropic     ANTHROPIC_API_KEY     ✔ pass   Valid
 *   OpenAI        OPENAI_API_KEY        ✘ FAIL   Key rejected (401)
 *                                                 → Regenerate at https://...
 *   Telegram      TELEGRAM_BOT_TOKEN    - skip   Not configured
 * ```
 */
export function formatProbeReport(report: ProbeReport): string {
  if (report.results.length === 0) {
    return "No integrations configured. Add credentials to your .env file.";
  }

  // Column widths (minimum + dynamic)
  const col1 = Math.max(11, ...report.results.map((r) => r.integration.length)) + 2;
  const col2 = Math.max(3, ...report.results.map((r) => r.envKey.length)) + 2;
  const col3 = 8; // "✔ pass" / "✘ FAIL" / "- skip"
  // col4 is the rest

  const header =
    pad("Integration", col1) +
    pad("Key", col2) +
    pad("Status", col3) +
    "Message";

  const separator =
    pad("─".repeat(col1 - 2), col1) +
    pad("─".repeat(col2 - 2), col2) +
    pad("─".repeat(col3 - 2), col3) +
    "─".repeat(30);

  const rows = report.results.map((r) => {
    const status = r.ok ? "✔ pass" : r.message === "Not configured" ? "- skip" : "✘ FAIL";
    let line =
      pad(r.integration, col1) +
      pad(r.envKey, col2) +
      pad(status, col3) +
      r.message;

    if (r.fix) {
      line += "\n" + " ".repeat(col1 + col2 + col3) + `→ ${r.fix}`;
    }
    return line;
  });

  const lines = [header, separator, ...rows];

  // Summary line
  const { passed, failed, skipped } = report;
  const total = report.results.length;
  const parts: string[] = [];
  if (passed > 0) parts.push(`${passed} passed`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  const summary = report.healthy
    ? `\n✔ All ${total} credential${total === 1 ? "" : "s"} healthy`
    : `\n${parts.join(", ")} out of ${total}`;
  lines.push(summary);

  return lines.join("\n");
}

/** Right-pad a string to a given width. */
function pad(str: string, width: number): string {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}
