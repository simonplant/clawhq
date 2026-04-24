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
import { INTEGRATION_REGISTRY } from "../../evolve/integrate/registry.js";

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
 * Key invariants (the reason this function exists):
 *   - BOTH v4 and v6 chains are always touched, even when no v6 IPs
 *     resolved. The prior implementation only touched ip6tables when AAAA
 *     records came back, so a deploy that lost its IPv6 addresses between
 *     runs left stale ip6tables rules filtering against the old policy.
 *   - FORWARD attachment is deduped: any prior `-j CLAWHQ_FWD` jumps are
 *     removed in a loop first, then exactly one is inserted. The older
 *     `-C` check + `-I` fallback could stack duplicates on rapid re-runs.
 *   - On any error we tear down — a partial apply is worse than no
 *     firewall because it filters some traffic while letting other
 *     traffic through against the intended policy.
 */
export async function applyFirewall(options: FirewallOptions): Promise<FirewallResult> {
  const airGap = options.airGap ?? false;
  const allowlist = airGap ? [] : (options.allowlist ?? (await loadAllowlist(options.deployDir)));

  // ipset is a hard prerequisite when there's any allowlist to apply.
  if (!airGap && allowlist.length > 0) {
    let ipsetAvailable = true;
    try {
      await ipsetCmd(["--version"], options.signal);
    } catch {
      ipsetAvailable = false;
    }
    if (!ipsetAvailable) {
      return {
        success: true,
        rulesApplied: 0,
        resolvedIps: 0,
        warning:
          "ipset not available — egress firewall skipped (install ipset for domain-based filtering)",
      };
    }
  }

  // Empty non-airgap allowlist is a misconfiguration, not an intentional
  // "block everything". Refuse rather than emit a DROP-all chain that
  // looks like a working firewall. Caller can pass airGap=true to truly
  // block all egress.
  if (!airGap && allowlist.length === 0) {
    return {
      success: true,
      rulesApplied: 0,
      resolvedIps: 0,
      warning:
        "egress firewall skipped — allowlist is empty (run clawhq init to generate)",
    };
  }

  try {
    const domains = allowlist.map((e) => e.domain);
    const ports = [...new Set(allowlist.map((e) => e.port))].sort((a, b) => a - b);
    const resolved = airGap
      ? { v4: [] as string[], v6: [] as string[] }
      : await resolveDomains(domains);

    const v4Rules = await reconcileFamily(
      "iptables",
      IPSET_NAME,
      "inet",
      resolved.v4,
      ports,
      airGap,
      options.signal,
    );

    // IPv6 failure modes are different from IPv4: hosts with a stripped
    // kernel (minimal Alpine / some VPS images) can have ipset without
    // inet6 support, or ip6tables entirely absent. On those hosts the
    // prior "teardown on any error" behavior bricked deploys that had
    // worked before. Treat ip6tables reconcile failure as degraded
    // filtering (v4-only) rather than a hard failure.
    let v6Rules = 0;
    let v6Warning: string | undefined;
    try {
      v6Rules = await reconcileFamily(
        "ip6tables",
        IPSET_NAME_V6,
        "inet6",
        resolved.v6,
        ports,
        airGap,
        options.signal,
      );
    } catch (err) {
      v6Warning =
        "ip6tables/ipset inet6 not available — v6 egress unfiltered " +
        `(${err instanceof Error ? err.message : String(err)})`;
    }

    await writeIpsetMeta(options.deployDir, {
      lastRefreshed: new Date().toISOString(),
      refreshIntervalMs: IPSET_REFRESH_INTERVAL_MS,
      domains,
      resolvedV4: resolved.v4.length,
      resolvedV6: resolved.v6.length,
      setName: IPSET_NAME,
      setNameV6: IPSET_NAME_V6,
    });

    return {
      success: true,
      rulesApplied: v4Rules + v6Rules,
      resolvedIps: resolved.v4.length + resolved.v6.length,
      ...(v6Warning ? { warning: v6Warning } : {}),
    };
  } catch (err) {
    try {
      await teardown(options.signal);
    } catch {
      // best effort
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      rulesApplied: 0,
      error: `Firewall setup failed (rolled back): ${message}`,
    };
  }
}

/**
 * Remove the CLAWHQ_FWD chain, all its rules, and associated ipsets.
 * Safe to call even if the chain/ipsets don't exist — fully idempotent.
 *
 * Thin wrapper around `teardown()`. Callers that already hold a deployDir
 * should prefer `reconcile(deployDir, { enabled: false, ... })` so the
 * state.json file stays consistent; this signal-only overload is kept for
 * the `shutdown` code path where we don't want to bring deployDir into
 * the function signature for backwards-compat.
 */
export async function removeFirewall(signal?: AbortSignal): Promise<FirewallResult> {
  return teardown(signal);
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
 * Build allowlist entries from blueprint egress_domains + integration domains.
 *
 * Merges blueprint-defined domains (always port 443) with integration entries
 * that may specify custom ports (e.g. IMAP 993, SMTP 587).
 * Deduplicates by domain+port.
 */
export function buildAllowlistFromBlueprint(
  egressDomains: readonly string[],
  integrationEntries: readonly FirewallAllowEntry[] = [],
): FirewallAllowEntry[] {
  const seen = new Set<string>();
  const entries: FirewallAllowEntry[] = [];

  // When an integration entry covers a host on a non-443 port (IMAP 993,
  // SMTP 587), that entry is authoritative — skip the blueprint's 443
  // entry for the same host. Without this, every email provider emits
  // both `imap.mail.me.com:443` (from the catalog's egressDomains) AND
  // `imap.mail.me.com:993` (from env-var-inferred integration detection),
  // bloating the ipset with a 443 rule that never matches real IMAP
  // traffic.
  const hostsWithSpecificPort = new Set<string>();
  for (const entry of integrationEntries) {
    if (entry.port !== 443) hostsWithSpecificPort.add(entry.domain);
  }

  // Blueprint domains default to port 443 — unless a more-specific port
  // for the same host already appears in integrationEntries.
  for (const domain of egressDomains) {
    if (hostsWithSpecificPort.has(domain)) continue;
    const key = `${domain}:443`;
    if (!seen.has(key)) {
      seen.add(key);
      entries.push({ domain, port: 443 });
    }
  }

  // Integration entries carry their own port
  for (const entry of integrationEntries) {
    const key = `${entry.domain}:${entry.port}`;
    if (!seen.has(key)) {
      seen.add(key);
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * Extract hostname from a value that may be a plain hostname, a URL, or a host:port.
 * Returns the hostname, or undefined if extraction fails.
 */
function extractHostname(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // URL: parse and extract hostname
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try { return new URL(trimmed).hostname; } catch { return undefined; }
  }
  // host:port — take the host part
  const colonIdx = trimmed.lastIndexOf(":");
  if (colonIdx > 0) {
    const maybePort = trimmed.slice(colonIdx + 1);
    if (/^\d+$/.test(maybePort)) return trimmed.slice(0, colonIdx);
  }
  // Plain hostname
  return trimmed;
}

/**
 * Auto-detect which integrations are configured by checking which env keys
 * from the registry are present in the env vars map.
 */
export function detectConfiguredIntegrations(envVars: Readonly<Record<string, string>>): string[] {
  const configured: string[] = [];
  for (const [name, def] of Object.entries(INTEGRATION_REGISTRY)) {
    const hasKey = def.envKeys.some((ek) => {
      const val = envVars[ek.key];
      return val !== undefined && val !== "";
    });
    if (hasKey) configured.push(name);
  }
  return configured;
}

/**
 * Collect egress domains for a set of configured integrations.
 *
 * Looks up each integration name in the registry and returns all
 * egressDomains they require. For integrations with dynamic domains
 * (email, calendar, home assistant), resolves hostnames from envVars.
 *
 * When envVars is provided, also auto-detects integrations not in the
 * explicit list (catches credentials added after initial setup).
 * Unknown integration names are skipped.
 *
 * Returns FirewallAllowEntry[] with correct ports (e.g. IMAP=993, SMTP=587).
 */
export function collectIntegrationDomains(
  integrationNames: readonly string[],
  envVars?: Readonly<Record<string, string>>,
): FirewallAllowEntry[] {
  // Merge explicit list with auto-detected integrations from env vars
  const allNames = new Set(integrationNames.map((n) => n.toLowerCase()));
  if (envVars) {
    for (const name of detectConfiguredIntegrations(envVars)) {
      allNames.add(name);
    }
  }

  const entries: FirewallAllowEntry[] = [];
  for (const name of allNames) {
    const def = INTEGRATION_REGISTRY[name];
    if (!def) continue;

    // Static domains — default port 443
    for (const d of def.egressDomains) {
      entries.push({ domain: d, port: 443 });
    }

    // Dynamic domains from env vars with port detection
    if (def.dynamicEgressEnvKeys && envVars) {
      for (const envKey of def.dynamicEgressEnvKeys) {
        const val = envVars[envKey];
        if (!val) continue;

        // Extract hostname and port from the env value
        const trimmed = val.trim();
        let host: string | undefined;
        let port = 443;

        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
          try {
            const url = new URL(trimmed);
            host = url.hostname;
            port = url.port ? parseInt(url.port, 10) : (url.protocol === "https:" ? 443 : 80);
          } catch { continue; }
        } else {
          host = extractHostname(trimmed);
          // Infer port from env key name
          if (envKey === "IMAP_HOST") port = parseInt(envVars.IMAP_PORT || "993", 10);
          else if (envKey === "SMTP_HOST") port = parseInt(envVars.SMTP_PORT || "587", 10);
        }

        if (host && host !== "localhost" && host !== "127.0.0.1" && host !== "0.0.0.0") {
          entries.push({ domain: host, port });
        }
      }
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

    // Handle both formats:
    // New format: [{domain: "...", port: 443}]
    // Legacy compiler format: {domains: ["domain1", "domain2"]}
    let items: unknown[];
    if (Array.isArray(parsed)) {
      items = parsed;
    } else if (parsed && typeof parsed === "object" && "domains" in parsed && Array.isArray((parsed as Record<string, unknown>).domains)) {
      // Legacy format — convert plain domain strings to entries with default port 443
      items = ((parsed as Record<string, unknown>).domains as string[]).map(
        (d) => ({ domain: d, port: 443 }),
      );
    } else {
      return [];
    }

    const entries: FirewallAllowEntry[] = [];
    for (const item of items) {
      if (typeof item === "object" && item !== null && "domain" in item && typeof (item as Record<string, unknown>).domain === "string") {
        const rec = item as Record<string, unknown>;
        entries.push({
          domain: rec.domain as string,
          port: typeof rec.port === "number" ? rec.port : 443,
          comment: typeof rec.comment === "string" ? rec.comment : undefined,
        });
      }
    }

    return entries;
  } catch {
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

type IptablesCmd = "iptables" | "ip6tables";

async function runIptablesCmd(cmd: IptablesCmd, args: string[], signal?: AbortSignal): Promise<void> {
  // iptables requires root — use sudo (sudoers should have NOPASSWD for iptables)
  await execFileAsync("sudo", [cmd, ...args], { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal });
}

async function ensureChain(cmd: IptablesCmd, signal?: AbortSignal): Promise<void> {
  try {
    // Try to create the chain
    await runIptablesCmd(cmd, ["-N", CHAIN_NAME], signal);
  } catch {
    // Chain already exists — flush it
    await runIptablesCmd(cmd, ["-F", CHAIN_NAME], signal);
  }
}

/**
 * Attach the chain to FORWARD exactly once.
 *
 * The prior implementation used `-C` (check) then `-I` (insert) when the
 * check failed. That pattern is not idempotent: if the check itself fails
 * for any reason other than "not present" (sudo timeout, iptables locked),
 * we insert anyway, and rapid re-runs could accumulate duplicate jumps.
 *
 * This version removes ALL existing jumps first (`-D` in a loop until it
 * errors, which means no more matches), then inserts exactly one. Net
 * effect: the rule count is always 1 after this call, no matter how many
 * duplicates existed before.
 */
async function attachToForward(cmd: IptablesCmd, signal?: AbortSignal): Promise<void> {
  // Bounded loop — iptables can't hold more than a handful of duplicates
  // without prior bugs, and an unbounded loop here would be a DoS if a
  // caller somehow caused -D to keep succeeding. 32 is far more than
  // realistic duplicate counts and far less than pathological.
  for (let i = 0; i < 32; i++) {
    try {
      await runIptablesCmd(cmd, ["-D", "FORWARD", "-j", CHAIN_NAME], signal);
    } catch {
      break;
    }
  }
  await runIptablesCmd(cmd, ["-I", "FORWARD", "-j", CHAIN_NAME], signal);
}

/**
 * Converge a single address family (v4 or v6) onto the target state.
 *
 * Called from `reconcile` for both families unconditionally. Even when
 * `ips` is empty, we still flush + re-emit the chain: that is what
 * guarantees stale ACCEPT rules from a prior apply don't survive.
 *
 * Returns the number of rules emitted — used by the caller to report
 * totals to the progress UI.
 */
async function reconcileFamily(
  cmd: IptablesCmd,
  ipsetName: string,
  family: "inet" | "inet6",
  ips: readonly string[],
  ports: readonly number[],
  airGap: boolean,
  signal?: AbortSignal,
): Promise<number> {
  let rules = 0;

  // Ipset: always ensure existence (create-if-missing) and flush — even
  // when ips is empty. An empty ipset + ACCEPT rule matches nothing, which
  // is what we want; leaving the prior ipset populated would let traffic
  // through against the current policy.
  await ensureIpset(ipsetName, family, signal);
  await flushIpset(ipsetName, signal);
  for (const ip of ips) {
    await ipsetAdd(ipsetName, ip, signal);
  }

  await ensureChain(cmd, signal);

  // 1. ESTABLISHED/RELATED — always.
  await runIptablesCmd(
    cmd,
    ["-A", CHAIN_NAME, "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"],
    signal,
  );
  rules++;

  if (!airGap) {
    // 2. DNS on UDP + TCP.
    await runIptablesCmd(cmd, ["-A", CHAIN_NAME, "-p", "udp", "--dport", "53", "-j", "ACCEPT"], signal);
    await runIptablesCmd(cmd, ["-A", CHAIN_NAME, "-p", "tcp", "--dport", "53", "-j", "ACCEPT"], signal);
    rules += 2;

    // 3. Per-port ipset match — only if we have IPs for this family, since
    //    iptables won't match against an empty ipset and we'd be emitting
    //    dead rules. The ipset stays present (flushed above) so a later
    //    refreshIpset() can repopulate without recreating it.
    if (ips.length > 0) {
      for (const port of ports) {
        await runIptablesCmd(
          cmd,
          [
            "-A", CHAIN_NAME,
            "-p", "tcp",
            "-m", "set", "--match-set", ipsetName, "dst",
            "--dport", String(port),
            "-j", "ACCEPT",
          ],
          signal,
        );
        rules++;
      }
    }
  }

  // 4. LOG + DROP — always.
  await runIptablesCmd(
    cmd,
    ["-A", CHAIN_NAME, "-j", "LOG", "--log-prefix", "CLAWHQ_DROP: ", "--log-level", "4"],
    signal,
  );
  await runIptablesCmd(cmd, ["-A", CHAIN_NAME, "-j", "DROP"], signal);
  rules += 2;

  // 5. Attach to FORWARD — de-dupes any prior jumps.
  await attachToForward(cmd, signal);

  return rules;
}

/**
 * Tear down CLAWHQ_FWD chains and ipsets. Safe to call when nothing exists.
 */
async function teardown(signal?: AbortSignal): Promise<FirewallResult> {
  try {
    await removeChain("iptables", signal);
    await removeChain("ip6tables", signal);
    await destroyIpset(IPSET_NAME, signal);
    await destroyIpset(IPSET_NAME_V6, signal);
    return { success: true, rulesApplied: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, rulesApplied: 0, error: `Firewall teardown failed: ${message}` };
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
  const { stdout } = await execFileAsync("sudo", ["ipset", ...args], { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal });
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
