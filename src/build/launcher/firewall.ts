/**
 * Egress firewall management using iptables.
 *
 * Manages the CLAWHQ_FWD chain on the Docker bridge network.
 * Rules: allow ESTABLISHED/RELATED, DNS, HTTPS to allowlisted domains,
 * LOG + DROP everything else. Reapplied after every compose down.
 *
 * See docs/ARCHITECTURE.md § "Egress Firewall" for spec.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { FirewallAllowEntry, FirewallOptions, FirewallResult } from "./types.js";

const execFileAsync = promisify(execFile);

// ── Constants ────────────────────────────────────────────────────────────────

const CHAIN_NAME = "CLAWHQ_FWD";
const EXEC_TIMEOUT_MS = 15_000;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Apply egress firewall rules for the CLAWHQ_FWD chain.
 *
 * Creates (or flushes) the chain, adds allowlist rules, then
 * attaches it to the FORWARD chain of the Docker bridge.
 */
export async function applyFirewall(options: FirewallOptions): Promise<FirewallResult> {
  const allowlist = options.allowlist ?? (await loadAllowlist(options.deployDir));

  try {
    // Ensure chain exists (create if not, flush if exists)
    await ensureChain(options.signal);

    let rulesApplied = 0;

    // 1. Allow ESTABLISHED/RELATED connections
    await iptables(
      ["-A", CHAIN_NAME, "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"],
      options.signal,
    );
    rulesApplied++;

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

    // 4. LOG + DROP everything else
    await iptables(
      ["-A", CHAIN_NAME, "-j", "LOG", "--log-prefix", "CLAWHQ_DROP: ", "--log-level", "4"],
      options.signal,
    );
    await iptables(["-A", CHAIN_NAME, "-j", "DROP"], options.signal);
    rulesApplied += 2;

    // 5. Attach to FORWARD chain if not already attached
    await attachToForward(options.signal);

    return { success: true, rulesApplied };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, rulesApplied: 0, error: `Firewall setup failed: ${message}` };
  }
}

/**
 * Remove the CLAWHQ_FWD chain and all its rules.
 * Safe to call even if the chain doesn't exist.
 */
export async function removeFirewall(signal?: AbortSignal): Promise<FirewallResult> {
  try {
    // Detach from FORWARD
    try {
      await iptables(["-D", "FORWARD", "-j", CHAIN_NAME], signal);
    } catch {
      // Not attached — that's fine
    }

    // Flush and delete chain
    try {
      await iptables(["-F", CHAIN_NAME], signal);
      await iptables(["-X", CHAIN_NAME], signal);
    } catch {
      // Chain doesn't exist — that's fine
    }

    return { success: true, rulesApplied: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, rulesApplied: 0, error: `Firewall removal failed: ${message}` };
  }
}

// ── Internal Helpers ────────────────────────────────────────────────────────

async function iptables(args: string[], signal?: AbortSignal): Promise<void> {
  await execFileAsync("iptables", args, { timeout: EXEC_TIMEOUT_MS, signal });
}

async function ensureChain(signal?: AbortSignal): Promise<void> {
  try {
    // Try to create the chain
    await iptables(["-N", CHAIN_NAME], signal);
  } catch {
    // Chain already exists — flush it
    await iptables(["-F", CHAIN_NAME], signal);
  }
}

async function attachToForward(signal?: AbortSignal): Promise<void> {
  try {
    // Check if already attached
    await iptables(["-C", "FORWARD", "-j", CHAIN_NAME], signal);
  } catch {
    // Not attached — add it
    await iptables(["-I", "FORWARD", "-j", CHAIN_NAME], signal);
  }
}

async function loadAllowlist(deployDir: string): Promise<FirewallAllowEntry[]> {
  const allowlistPath = join(deployDir, "ops", "firewall", "allowlist.yaml");
  try {
    const raw = await readFile(allowlistPath, "utf-8");
    // Simple YAML parsing for the allowlist format:
    // - domain: api.example.com
    //   port: 443
    const entries: FirewallAllowEntry[] = [];
    const lines = raw.split("\n");

    let currentDomain: string | undefined;
    let currentPort: number | undefined;
    let currentComment: string | undefined;

    for (const line of lines) {
      const domainMatch = line.match(/^\s*-?\s*domain:\s*(.+)/);
      const portMatch = line.match(/^\s*port:\s*(\d+)/);
      const commentMatch = line.match(/^\s*comment:\s*(.+)/);

      if (domainMatch) {
        if (currentDomain) {
          entries.push({ domain: currentDomain, port: currentPort ?? 443, comment: currentComment });
        }
        currentDomain = domainMatch[1].trim();
        currentPort = undefined;
        currentComment = undefined;
      } else if (portMatch) {
        currentPort = parseInt(portMatch[1], 10);
      } else if (commentMatch) {
        currentComment = commentMatch[1].trim();
      }
    }
    if (currentDomain) {
      entries.push({ domain: currentDomain, port: currentPort ?? 443, comment: currentComment });
    }

    return entries;
  } catch {
    // No allowlist file — return empty (default: block all non-DNS egress)
    return [];
  }
}
