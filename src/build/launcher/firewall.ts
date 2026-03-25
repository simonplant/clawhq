/**
 * Egress firewall management using iptables.
 *
 * Manages the CLAWHQ_FWD chain on the Docker bridge network.
 * Rules: allow ESTABLISHED/RELATED, DNS, HTTPS to allowlisted domains,
 * LOG + DROP everything else. Supports air-gap mode (block ALL egress).
 * Reapplied after every compose down via Docker event monitoring.
 *
 * See docs/ARCHITECTURE.md § "Egress Firewall" for spec.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { stringify as yamlStringify, parse as yamlParse } from "yaml";

import { DOCTOR_EXEC_TIMEOUT_MS } from "../../config/defaults.js";

import type {
  FirewallAllowEntry,
  FirewallOptions,
  FirewallResult,
  FirewallVerifyResult,
} from "./types.js";

const execFileAsync = promisify(execFile);

// ── Constants ────────────────────────────────────────────────────────────────

export const CHAIN_NAME = "CLAWHQ_FWD";

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Apply egress firewall rules for the CLAWHQ_FWD chain.
 *
 * Creates (or flushes) the chain, adds allowlist rules, then
 * attaches it to the FORWARD chain of the Docker bridge.
 *
 * In air-gap mode, only ESTABLISHED/RELATED is allowed — no DNS, no HTTPS.
 */
export async function applyFirewall(options: FirewallOptions): Promise<FirewallResult> {
  const airGap = options.airGap ?? false;
  const allowlist = airGap ? [] : (options.allowlist ?? (await loadAllowlist(options.deployDir)));

  try {
    // Ensure chain exists (create if not, flush if exists) — idempotent
    await ensureChain(options.signal);

    let rulesApplied = 0;

    // 1. Allow ESTABLISHED/RELATED connections
    await iptables(
      ["-A", CHAIN_NAME, "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"],
      options.signal,
    );
    rulesApplied++;

    if (!airGap) {
      // 2. Allow DNS (UDP + TCP port 53)
      await iptables(["-A", CHAIN_NAME, "-p", "udp", "--dport", "53", "-j", "ACCEPT"], options.signal);
      await iptables(["-A", CHAIN_NAME, "-p", "tcp", "--dport", "53", "-j", "ACCEPT"], options.signal);
      rulesApplied += 2;

      // 3. Allow HTTPS to allowlisted domains
      for (const entry of allowlist) {
        await iptables(
          [
            "-A", CHAIN_NAME,
            "-p", "tcp",
            "-d", entry.domain,
            "--dport", String(entry.port),
            "-j", "ACCEPT",
          ],
          options.signal,
        );
        rulesApplied++;
      }
    }

    // 4. LOG + DROP everything else
    await iptables(
      ["-A", CHAIN_NAME, "-j", "LOG", "--log-prefix", "CLAWHQ_DROP: ", "--log-level", "4"],
      options.signal,
    );
    await iptables(["-A", CHAIN_NAME, "-j", "DROP"], options.signal);
    rulesApplied += 2;

    // 5. Attach to FORWARD chain if not already attached — idempotent
    await attachToForward(options.signal);

    return { success: true, rulesApplied };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, rulesApplied: 0, error: `Firewall setup failed: ${message}` };
  }
}

/**
 * Remove the CLAWHQ_FWD chain and all its rules.
 * Safe to call even if the chain doesn't exist — fully idempotent.
 */
export async function removeFirewall(signal?: AbortSignal): Promise<FirewallResult> {
  try {
    // Detach from FORWARD
    try {
      await iptables(["-D", "FORWARD", "-j", CHAIN_NAME], signal);
    } catch (e) {
      console.warn(`[firewall:remove] Failed to detach chain from FORWARD:`, e);
      // Not attached — that's fine
    }

    // Flush and delete chain
    try {
      await iptables(["-F", CHAIN_NAME], signal);
      await iptables(["-X", CHAIN_NAME], signal);
    } catch (e) {
      console.warn(`[firewall:remove] Failed to flush/delete chain:`, e);
      // Chain doesn't exist — that's fine
    }

    return { success: true, rulesApplied: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, rulesApplied: 0, error: `Firewall removal failed: ${message}` };
  }
}

/**
 * Verify firewall rules match expected state.
 *
 * Compares expected rules (derived from allowlist) against live iptables
 * output. Returns a diff of missing and extra rules.
 */
export async function verifyFirewall(options: FirewallOptions): Promise<FirewallVerifyResult> {
  const airGap = options.airGap ?? false;
  const allowlist = airGap ? [] : (options.allowlist ?? (await loadAllowlist(options.deployDir)));

  try {
    // Get live rules from iptables
    const { stdout } = await execFileAsync(
      "iptables", ["-L", CHAIN_NAME, "-n", "--line-numbers"],
      { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal: options.signal },
    );

    const liveRules = parseIptablesOutput(stdout);
    const expectedRules = buildExpectedRules(allowlist, airGap);

    // Compare expected vs actual
    const missing = expectedRules.filter((e) => !liveRules.some((l) => rulesMatch(e, l)));
    const extra = liveRules.filter((l) => !expectedRules.some((e) => rulesMatch(e, l)));

    return {
      matches: missing.length === 0 && extra.length === 0,
      expectedCount: expectedRules.length,
      actualCount: liveRules.length,
      missing,
      extra,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("No chain") || message.includes("doesn't exist")) {
      const expectedRules = buildExpectedRules(allowlist, airGap);
      return {
        matches: false,
        expectedCount: expectedRules.length,
        actualCount: 0,
        missing: expectedRules,
        extra: [],
      };
    }
    return {
      matches: false,
      expectedCount: 0,
      actualCount: 0,
      missing: [],
      extra: [],
      error: `Cannot verify firewall: ${message}`,
    };
  }
}

/**
 * Watch for Docker container stop events and reapply firewall.
 *
 * Returns an AbortController to stop watching. Calls `applyFirewall`
 * whenever an OpenClaw container stops (which happens on compose down).
 */
export function watchAndReapply(
  options: FirewallOptions,
  onReapply?: (result: FirewallResult) => void,
): AbortController {
  const controller = new AbortController();
  const { signal } = controller;

  // Spawn `docker events` to watch for container die/stop events
  const proc = execFile(
    "docker",
    ["events", "--filter", "event=die", "--filter", "type=container", "--format", "{{.Actor.Attributes.name}}"],
    { signal },
    // callback is required for non-promisified form — errors handled via events
    () => { /* handled below */ },
  );

  if (proc.stdout) {
    proc.stdout.on("data", (chunk: Buffer) => {
      const name = chunk.toString().trim();
      // Reapply when an OpenClaw container stops
      if (name.includes("openclaw") || name.includes("clawhq")) {
        // Short delay to let compose fully tear down
        setTimeout(() => {
          if (!signal.aborted) {
            applyFirewall(options).then(
              (result) => onReapply?.(result),
              (err) => console.warn("[firewall:watch] Reapply failed:", err),
            );
          }
        }, 2_000);
      }
    });
  }

  proc.on("error", (err) => {
    if (!signal.aborted) {
      console.warn("[firewall:watch] Docker events stream failed:", err);
    }
  });

  return controller;
}

/**
 * Build allowlist entries from blueprint egress_domains.
 *
 * Merges blueprint-defined domains with integration registry domains
 * for any connected integrations. Deduplicates by domain+port.
 */
export function buildAllowlistFromBlueprint(
  egressDomains: readonly string[],
  integrationDomains: readonly string[] = [],
): FirewallAllowEntry[] {
  const seen = new Set<string>();
  const entries: FirewallAllowEntry[] = [];

  for (const domain of [...egressDomains, ...integrationDomains]) {
    const key = `${domain}:443`;
    if (!seen.has(key)) {
      seen.add(key);
      entries.push({ domain, port: 443 });
    }
  }

  return entries;
}

/**
 * Serialize allowlist entries to YAML for writing to ops/firewall/allowlist.yaml.
 */
export function serializeAllowlist(entries: readonly FirewallAllowEntry[]): string {
  if (entries.length === 0) {
    return "# Empty allowlist — no egress allowed (air-gap mode)\n[]\n";
  }
  return yamlStringify(
    entries.map((e) => ({
      domain: e.domain,
      port: e.port,
      ...(e.comment ? { comment: e.comment } : {}),
    })),
  );
}

// ── Allowlist Loader ────────────────────────────────────────────────────────

export async function loadAllowlist(deployDir: string): Promise<FirewallAllowEntry[]> {
  const allowlistPath = join(deployDir, "ops", "firewall", "allowlist.yaml");
  try {
    const raw = await readFile(allowlistPath, "utf-8");
    const parsed: unknown = yamlParse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    const entries: FirewallAllowEntry[] = [];
    for (const item of parsed) {
      if (typeof item === "object" && item !== null && "domain" in item && typeof item.domain === "string") {
        entries.push({
          domain: item.domain,
          port: typeof item.port === "number" ? item.port : 443,
          comment: typeof item.comment === "string" ? item.comment : undefined,
        });
      }
    }

    return entries;
  } catch (e) {
    console.warn(`[firewall:allowlist] Failed to load allowlist file:`, e);
    // No allowlist file or invalid YAML — return empty (default: block all non-DNS egress)
    return [];
  }
}

// ── Internal Helpers ────────────────────────────────────────────────────────

async function iptables(args: string[], signal?: AbortSignal): Promise<void> {
  await execFileAsync("iptables", args, { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal });
}

async function ensureChain(signal?: AbortSignal): Promise<void> {
  try {
    // Try to create the chain
    await iptables(["-N", CHAIN_NAME], signal);
  } catch (e) {
    console.warn(`[firewall:ensure-chain] Chain already exists, flushing:`, e);
    // Chain already exists — flush it
    await iptables(["-F", CHAIN_NAME], signal);
  }
}

async function attachToForward(signal?: AbortSignal): Promise<void> {
  try {
    // Check if already attached
    await iptables(["-C", "FORWARD", "-j", CHAIN_NAME], signal);
  } catch (e) {
    console.warn(`[firewall:attach] Chain not yet attached to FORWARD, adding:`, e);
    // Not attached — add it
    await iptables(["-I", "FORWARD", "-j", CHAIN_NAME], signal);
  }
}

// ── Verification Helpers ────────────────────────────────────────────────────

/** Rule descriptor for comparison between expected and live rules. */
export interface FirewallRuleDescriptor {
  readonly target: string;
  readonly protocol: string;
  readonly destination: string;
  readonly dport: string;
  readonly extra: string;
}

/** Parse iptables -L output into rule descriptors. */
export function parseIptablesOutput(stdout: string): FirewallRuleDescriptor[] {
  const rules: FirewallRuleDescriptor[] = [];
  const lines = stdout.split("\n");

  for (const line of lines) {
    // Skip header lines
    if (line.startsWith("Chain ") || line.startsWith("num ") || line.trim() === "") {
      continue;
    }

    // Parse rule line: "num  TARGET  PROT  OPT  SOURCE  DESTINATION  extra..."
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 6) {
      const target = parts[1] ?? "";
      const protocol = parts[2] ?? "";
      const destination = parts[5] ?? "";
      const extraParts = parts.slice(6);
      const dport = extractDport(extraParts);

      rules.push({
        target,
        protocol,
        destination,
        dport,
        extra: extraParts.join(" "),
      });
    }
  }

  return rules;
}

/** Extract --dport value from extra fields. */
function extractDport(parts: string[]): string {
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part && part.startsWith("dpt:")) {
      return part.replace("dpt:", "");
    }
  }
  return "";
}

/** Build expected rule descriptors from allowlist. */
export function buildExpectedRules(
  allowlist: readonly FirewallAllowEntry[],
  airGap: boolean,
): FirewallRuleDescriptor[] {
  const rules: FirewallRuleDescriptor[] = [];

  // 1. ESTABLISHED/RELATED
  rules.push({
    target: "ACCEPT",
    protocol: "all",
    destination: "0.0.0.0/0",
    dport: "",
    extra: "ctstate RELATED,ESTABLISHED",
  });

  if (!airGap) {
    // 2. DNS
    rules.push({
      target: "ACCEPT",
      protocol: "udp",
      destination: "0.0.0.0/0",
      dport: "53",
      extra: "udp dpt:53",
    });
    rules.push({
      target: "ACCEPT",
      protocol: "tcp",
      destination: "0.0.0.0/0",
      dport: "53",
      extra: "tcp dpt:53",
    });

    // 3. Allowlisted domains
    for (const entry of allowlist) {
      rules.push({
        target: "ACCEPT",
        protocol: "tcp",
        destination: entry.domain,
        dport: String(entry.port),
        extra: `tcp dpt:${entry.port}`,
      });
    }
  }

  // 4. LOG + DROP
  rules.push({
    target: "LOG",
    protocol: "all",
    destination: "0.0.0.0/0",
    dport: "",
    extra: "LOG flags 0 level 4 prefix \"CLAWHQ_DROP: \"",
  });
  rules.push({
    target: "DROP",
    protocol: "all",
    destination: "0.0.0.0/0",
    dport: "",
    extra: "",
  });

  return rules;
}

/** Compare two rule descriptors for equivalence. */
export function rulesMatch(a: FirewallRuleDescriptor, b: FirewallRuleDescriptor): boolean {
  return a.target === b.target && a.protocol === b.protocol && a.destination === b.destination && a.dport === b.dport;
}
