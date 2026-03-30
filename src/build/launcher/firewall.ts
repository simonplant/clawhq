/**
 * Egress firewall management using iptables + ipset.
 *
 * Manages the CLAWHQ_FWD chain on the Docker bridge network.
 * Domain allowlists are DNS-resolved into ipsets, refreshed periodically
 * to handle CDN rotations, multi-homed services, and IPv6.
 *
 * Rules: allow ESTABLISHED/RELATED, DNS, ipset match for allowlisted
 * domains (resolved IPs), LOG + DROP everything else.
 * Supports air-gap mode (block ALL egress).
 *
 * See docs/ARCHITECTURE.md § "Egress Firewall" for spec.
 */

import { execFile } from "node:child_process";
import { resolve4, resolve6 } from "node:dns/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { stringify as yamlStringify, parse as yamlParse } from "yaml";

import { DOCTOR_EXEC_TIMEOUT_MS } from "../../config/defaults.js";

import type {
  FirewallAllowEntry,
  FirewallOptions,
  FirewallResult,
  FirewallVerifyResult,
  IpsetMeta,
} from "./types.js";

const execFileAsync = promisify(execFile);

// ── Constants ────────────────────────────────────────────────────────────────

export const CHAIN_NAME = "CLAWHQ_FWD";
export const IPSET_NAME = "clawhq_egress";
export const IPSET_NAME_V6 = "clawhq_egress_v6";

/** Default DNS re-resolution interval: 5 minutes. */
export const IPSET_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Apply egress firewall rules for the CLAWHQ_FWD chain using ipset.
 *
 * Creates (or flushes) the chain, resolves domain allowlist via DNS
 * into ipsets, adds iptables rules referencing the ipset, then
 * attaches to the FORWARD chain of the Docker bridge.
 *
 * In air-gap mode, only ESTABLISHED/RELATED is allowed — no DNS, no HTTPS.
 */
export async function applyFirewall(options: FirewallOptions): Promise<FirewallResult> {
  const airGap = options.airGap ?? false;
  const allowlist = airGap ? [] : (options.allowlist ?? (await loadAllowlist(options.deployDir)));

  try {
    // Ensure chain exists (create if not, flush if exists) — idempotent
    await ensureChain("iptables", options.signal);

    let rulesApplied = 0;
    let resolvedIps = 0;

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

      // 3. Resolve domains → IPs and populate ipsets
      if (allowlist.length > 0) {
        const domains = allowlist.map((e) => e.domain);
        const resolved = await resolveDomains(domains);
        resolvedIps = resolved.v4.length + resolved.v6.length;

        // Collect unique ports from allowlist
        const ports = [...new Set(allowlist.map((e) => e.port))];

        // Create and populate IPv4 ipset
        await ensureIpset(IPSET_NAME, "inet", options.signal);
        await flushIpset(IPSET_NAME, options.signal);
        for (const ip of resolved.v4) {
          await ipsetAdd(IPSET_NAME, ip, options.signal);
        }

        // Add iptables rules referencing IPv4 ipset — one per port
        for (const port of ports) {
          if (resolved.v4.length > 0) {
            await iptables(
              [
                "-A", CHAIN_NAME,
                "-p", "tcp",
                "-m", "set", "--match-set", IPSET_NAME, "dst",
                "--dport", String(port),
                "-j", "ACCEPT",
              ],
              options.signal,
            );
            rulesApplied++;
          }
        }

        // Create and populate IPv6 ipset + ip6tables chain if we have AAAA records
        if (resolved.v6.length > 0) {
          await ensureIpset(IPSET_NAME_V6, "inet6", options.signal);
          await flushIpset(IPSET_NAME_V6, options.signal);
          for (const ip of resolved.v6) {
            await ipsetAdd(IPSET_NAME_V6, ip, options.signal);
          }

          // Create and populate ip6tables chain
          await ensureChain("ip6tables", options.signal);

          await ip6tables(
            ["-A", CHAIN_NAME, "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"],
            options.signal,
          );
          await ip6tables(["-A", CHAIN_NAME, "-p", "udp", "--dport", "53", "-j", "ACCEPT"], options.signal);
          await ip6tables(["-A", CHAIN_NAME, "-p", "tcp", "--dport", "53", "-j", "ACCEPT"], options.signal);

          for (const port of ports) {
            await ip6tables(
              [
                "-A", CHAIN_NAME,
                "-p", "tcp",
                "-m", "set", "--match-set", IPSET_NAME_V6, "dst",
                "--dport", String(port),
                "-j", "ACCEPT",
              ],
              options.signal,
            );
            rulesApplied++;
          }

          await ip6tables(
            ["-A", CHAIN_NAME, "-j", "LOG", "--log-prefix", "CLAWHQ_DROP: ", "--log-level", "4"],
            options.signal,
          );
          await ip6tables(["-A", CHAIN_NAME, "-j", "DROP"], options.signal);

          await attachToForward("ip6tables", options.signal);
        }

        // Write ipset metadata for staleness detection
        await writeIpsetMeta(options.deployDir, {
          lastRefreshed: new Date().toISOString(),
          refreshIntervalMs: IPSET_REFRESH_INTERVAL_MS,
          domains,
          resolvedV4: resolved.v4.length,
          resolvedV6: resolved.v6.length,
          setName: IPSET_NAME,
          setNameV6: IPSET_NAME_V6,
        });
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
    await attachToForward("iptables", options.signal);

    return { success: true, rulesApplied, resolvedIps };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, rulesApplied: 0, error: `Firewall setup failed: ${message}` };
  }
}

/**
 * Remove the CLAWHQ_FWD chain, all its rules, and associated ipsets.
 * Safe to call even if the chain/ipsets don't exist — fully idempotent.
 */
export async function removeFirewall(signal?: AbortSignal): Promise<FirewallResult> {
  try {
    // Detach from FORWARD and remove chain (iptables)
    await removeChain("iptables", signal);

    // Detach from FORWARD and remove chain (ip6tables — may not exist)
    await removeChain("ip6tables", signal);

    // Destroy ipsets
    await destroyIpset(IPSET_NAME, signal);
    await destroyIpset(IPSET_NAME_V6, signal);

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
              () => { /* reapply failed — non-fatal */ },
            );
          }
        }, 2_000);
      }
    });
  }

  proc.on("error", () => {
    // Docker events stream failed — non-fatal
  });

  return controller;
}

/**
 * Refresh ipset by re-resolving DNS for all allowlisted domains.
 *
 * Atomically swaps ipset contents: resolve new IPs, flush old set, add new.
 * Updates the metadata file with the new timestamp.
 */
export async function refreshIpset(options: FirewallOptions): Promise<FirewallResult> {
  const allowlist = options.allowlist ?? (await loadAllowlist(options.deployDir));

  if (allowlist.length === 0) {
    return { success: true, rulesApplied: 0, resolvedIps: 0 };
  }

  try {
    const domains = allowlist.map((e) => e.domain);
    const resolved = await resolveDomains(domains);
    const resolvedIps = resolved.v4.length + resolved.v6.length;

    // Flush and repopulate ipsets
    await flushIpset(IPSET_NAME, options.signal);
    for (const ip of resolved.v4) {
      await ipsetAdd(IPSET_NAME, ip, options.signal);
    }

    await flushIpset(IPSET_NAME_V6, options.signal);
    for (const ip of resolved.v6) {
      await ipsetAdd(IPSET_NAME_V6, ip, options.signal);
    }

    // Update metadata
    await writeIpsetMeta(options.deployDir, {
      lastRefreshed: new Date().toISOString(),
      refreshIntervalMs: IPSET_REFRESH_INTERVAL_MS,
      domains,
      resolvedV4: resolved.v4.length,
      resolvedV6: resolved.v6.length,
      setName: IPSET_NAME,
      setNameV6: IPSET_NAME_V6,
    });

    return { success: true, rulesApplied: 0, resolvedIps };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, rulesApplied: 0, error: `Ipset refresh failed: ${message}` };
  }
}

/**
 * Start periodic ipset refresh for DNS re-resolution.
 *
 * Returns an AbortController to stop the refresh loop.
 * Default interval: 5 minutes (IPSET_REFRESH_INTERVAL_MS).
 */
export function startIpsetRefresh(
  options: FirewallOptions,
  onRefresh?: (result: FirewallResult) => void,
  intervalMs: number = IPSET_REFRESH_INTERVAL_MS,
): AbortController {
  const controller = new AbortController();
  const { signal } = controller;

  const timer = setInterval(() => {
    if (signal.aborted) {
      clearInterval(timer);
      return;
    }
    refreshIpset(options).then(
      (result) => onRefresh?.(result),
      () => { /* refresh failed — non-fatal, will retry next interval */ },
    );
  }, intervalMs);

  // Clean up on abort
  signal.addEventListener("abort", () => clearInterval(timer), { once: true });

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
    // No allowlist file or invalid YAML — return empty (default: block all non-DNS egress)
    return [];
  }
}

// ── Ipset Metadata ──────────────────────────────────────────────────────────

/** Read ipset metadata from ops/firewall/ipset-meta.json. */
export async function loadIpsetMeta(deployDir: string): Promise<IpsetMeta | null> {
  const metaPath = join(deployDir, "ops", "firewall", "ipset-meta.json");
  try {
    const raw = await readFile(metaPath, "utf-8");
    return JSON.parse(raw) as IpsetMeta;
  } catch {
    return null;
  }
}

/** Write ipset metadata to ops/firewall/ipset-meta.json. */
async function writeIpsetMeta(deployDir: string, meta: IpsetMeta): Promise<void> {
  const metaDir = join(deployDir, "ops", "firewall");
  await mkdir(metaDir, { recursive: true });
  const metaPath = join(metaDir, "ipset-meta.json");
  await writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf-8");
}

// ── DNS Resolution ──────────────────────────────────────────────────────────

/**
 * Resolve an array of domain names to IPv4 and IPv6 addresses.
 * Failures for individual domains are silently skipped (the domain
 * may only have A or AAAA records, not both).
 */
export async function resolveDomains(
  domains: readonly string[],
): Promise<{ v4: string[]; v6: string[] }> {
  const v4Set = new Set<string>();
  const v6Set = new Set<string>();

  const uniqueDomains = [...new Set(domains)];

  await Promise.all(
    uniqueDomains.map(async (domain) => {
      // Resolve IPv4
      try {
        const addrs = await resolve4(domain);
        for (const addr of addrs) v4Set.add(addr);
      } catch {
        // No A record or DNS failure — skip
      }

      // Resolve IPv6
      try {
        const addrs = await resolve6(domain);
        for (const addr of addrs) v6Set.add(addr);
      } catch {
        // No AAAA record or DNS failure — skip
      }
    }),
  );

  return { v4: [...v4Set], v6: [...v6Set] };
}

// ── Internal Helpers ────────────────────────────────────────────────────────

async function iptables(args: string[], signal?: AbortSignal): Promise<void> {
  await runIptablesCmd("iptables", args, signal);
}

async function ip6tables(args: string[], signal?: AbortSignal): Promise<void> {
  await runIptablesCmd("ip6tables", args, signal);
}

type IptablesCmd = "iptables" | "ip6tables";

async function runIptablesCmd(cmd: IptablesCmd, args: string[], signal?: AbortSignal): Promise<void> {
  await execFileAsync(cmd, args, { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal });
}

async function ensureChain(cmd: IptablesCmd, signal?: AbortSignal): Promise<void> {
  try {
    // Try to create the chain
    await runIptablesCmd(cmd, ["-N", CHAIN_NAME], signal);
  } catch (e) {
    // Chain already exists — flush it
    await runIptablesCmd(cmd, ["-F", CHAIN_NAME], signal);
  }
}

async function attachToForward(cmd: IptablesCmd, signal?: AbortSignal): Promise<void> {
  try {
    // Check if already attached
    await runIptablesCmd(cmd, ["-C", "FORWARD", "-j", CHAIN_NAME], signal);
  } catch (e) {
    // Not attached — add it
    await runIptablesCmd(cmd, ["-I", "FORWARD", "-j", CHAIN_NAME], signal);
  }
}

/** Remove chain from FORWARD and delete it. Safe if chain doesn't exist. */
async function removeChain(cmd: IptablesCmd, signal?: AbortSignal): Promise<void> {
  try {
    await runIptablesCmd(cmd, ["-D", "FORWARD", "-j", CHAIN_NAME], signal);
  } catch {
    // Not attached — that's fine
  }
  try {
    await runIptablesCmd(cmd, ["-F", CHAIN_NAME], signal);
    await runIptablesCmd(cmd, ["-X", CHAIN_NAME], signal);
  } catch {
    // Chain doesn't exist — that's fine
  }
}

// ── Ipset Helpers ───────────────────────────────────────────────────────────

async function ipsetCmd(args: string[], signal?: AbortSignal): Promise<string> {
  const { stdout } = await execFileAsync("ipset", args, { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal });
  return stdout;
}

/** Create an ipset if it doesn't already exist. */
async function ensureIpset(name: string, family: "inet" | "inet6", signal?: AbortSignal): Promise<void> {
  try {
    await ipsetCmd(["create", name, "hash:ip", "family", family, "-exist"], signal);
  } catch {
    // ipset may already exist with different type — destroy and recreate
    try {
      await ipsetCmd(["destroy", name], signal);
    } catch { /* didn't exist */ }
    await ipsetCmd(["create", name, "hash:ip", "family", family], signal);
  }
}

/** Flush all entries from an ipset. */
async function flushIpset(name: string, signal?: AbortSignal): Promise<void> {
  try {
    await ipsetCmd(["flush", name], signal);
  } catch {
    // Set doesn't exist — that's fine
  }
}

/** Add an IP address to an ipset (idempotent with -exist). */
async function ipsetAdd(name: string, ip: string, signal?: AbortSignal): Promise<void> {
  await ipsetCmd(["add", name, ip, "-exist"], signal);
}

/** Destroy an ipset. Safe to call if it doesn't exist. */
async function destroyIpset(name: string, signal?: AbortSignal): Promise<void> {
  try {
    await ipsetCmd(["destroy", name], signal);
  } catch {
    // Doesn't exist — that's fine
  }
}

/** List ipset members. Returns array of IP strings. */
export async function listIpsetMembers(name: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const stdout = await ipsetCmd(["list", name, "-output", "plain"], signal);
    const members: string[] = [];
    let inMembers = false;
    for (const line of stdout.split("\n")) {
      if (line.startsWith("Members:")) {
        inMembers = true;
        continue;
      }
      if (inMembers && line.trim()) {
        members.push(line.trim());
      }
    }
    return members;
  } catch {
    return [];
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

/** Build expected rule descriptors from allowlist (ipset-based). */
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

    // 3. Ipset match rules — one per unique port
    const ports = [...new Set(allowlist.map((e) => e.port))];
    for (const port of ports) {
      rules.push({
        target: "ACCEPT",
        protocol: "tcp",
        destination: "0.0.0.0/0",
        dport: String(port),
        extra: `match-set ${IPSET_NAME} dst tcp dpt:${port}`,
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
