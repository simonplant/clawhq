/**
 * Low-level iptables operations for the CLAWHQ_FWD chain.
 *
 * All operations require sudo. Wraps iptables CLI via execFile
 * (same pattern as DockerClient).
 */

import { execFile } from "node:child_process";
import { platform } from "node:os";

import type { AllowlistEntry } from "./types.js";

/** Execute an iptables command via sudo. Returns stdout. */
export async function iptablesExec(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("sudo", ["iptables", ...args], (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`iptables ${args.join(" ")} failed: ${stderr || err.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/** Check if the current platform supports iptables. */
export function checkPlatform(): { supported: boolean; message: string } {
  const os = platform();
  if (os === "linux") {
    return { supported: true, message: "Linux detected, iptables supported" };
  }
  if (os === "darwin") {
    return {
      supported: false,
      message: "macOS detected. Egress firewall requires Linux (iptables). macOS pf support is not yet implemented.",
    };
  }
  return {
    supported: false,
    message: `Unsupported platform: ${os}. Egress firewall requires Linux (iptables).`,
  };
}

/** Check if the chain exists. */
export async function chainExists(chainName: string): Promise<boolean> {
  try {
    await iptablesExec(["-L", chainName, "-n"]);
    return true;
  } catch {
    return false;
  }
}

/** Create the chain if it doesn't exist. */
export async function createChain(chainName: string): Promise<void> {
  if (await chainExists(chainName)) return;
  await iptablesExec(["-N", chainName]);
}

/** Flush all rules from the chain. */
export async function flushChain(chainName: string): Promise<void> {
  if (!(await chainExists(chainName))) return;
  await iptablesExec(["-F", chainName]);
}

/** Delete the chain (must be empty and unreferenced). */
export async function deleteChain(chainName: string): Promise<void> {
  if (!(await chainExists(chainName))) return;
  await iptablesExec(["-F", chainName]);
  // Remove any references from FORWARD chain
  try {
    await iptablesExec(["-D", "FORWARD", "-j", chainName]);
  } catch {
    // Not referenced in FORWARD, that's fine
  }
  await iptablesExec(["-X", chainName]);
}

/**
 * Insert a jump from FORWARD to our chain on the given interface.
 *
 * Uses -C (check) first to avoid duplicate jumps (idempotent).
 */
export async function insertForwardJump(
  chainName: string,
  bridgeInterface: string,
): Promise<void> {
  try {
    // Check if the rule already exists
    await iptablesExec(["-C", "FORWARD", "-i", bridgeInterface, "-j", chainName]);
  } catch {
    // Rule doesn't exist, insert it
    await iptablesExec(["-I", "FORWARD", "-i", bridgeInterface, "-j", chainName]);
  }
}

/** Remove the jump from FORWARD to our chain. */
export async function removeForwardJump(
  chainName: string,
  bridgeInterface: string,
): Promise<void> {
  try {
    await iptablesExec(["-D", "FORWARD", "-i", bridgeInterface, "-j", chainName]);
  } catch {
    // Already removed
  }
}

/**
 * Generate and apply the complete rule set for the chain.
 *
 * Rule order (critical for correct filtering):
 * 1. ESTABLISHED/RELATED — allow return traffic
 * 2. DNS (UDP+TCP 53) — allow name resolution
 * 3. HTTPS (TCP 443) to each allowlisted IP — allow opted-in destinations
 * 4. LOG — log dropped packets for debugging
 * 5. DROP — block everything else
 */
export async function applyRules(
  chainName: string,
  allowlist: AllowlistEntry[],
): Promise<void> {
  // 1. Allow established/related connections (return traffic)
  await iptablesExec([
    "-A", chainName,
    "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED",
    "-j", "ACCEPT",
  ]);

  // 2. Allow DNS (UDP and TCP port 53)
  await iptablesExec([
    "-A", chainName,
    "-p", "udp", "--dport", "53",
    "-j", "ACCEPT",
  ]);
  await iptablesExec([
    "-A", chainName,
    "-p", "tcp", "--dport", "53",
    "-j", "ACCEPT",
  ]);

  // 3. Allow HTTPS (TCP 443) to each allowlisted IP
  for (const entry of allowlist) {
    for (const ip of entry.ips) {
      await iptablesExec([
        "-A", chainName,
        "-p", "tcp", "--dport", "443",
        "-d", ip,
        "-j", "ACCEPT",
      ]);
    }
  }

  // 4. Log dropped packets (rate-limited to avoid log flood)
  await iptablesExec([
    "-A", chainName,
    "-m", "limit", "--limit", "5/min",
    "-j", "LOG",
    "--log-prefix", "CLAWHQ_DROP: ",
  ]);

  // 5. Drop everything else
  await iptablesExec(["-A", chainName, "-j", "DROP"]);
}

/** List current rules in the chain. Returns raw rule lines. */
export async function listRules(chainName: string): Promise<string[]> {
  try {
    const output = await iptablesExec(["-S", chainName]);
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line !== `-N ${chainName}`);
  } catch {
    return [];
  }
}

/**
 * Build the expected rule strings for verification.
 *
 * Produces the same format as `iptables -S CHAIN_NAME` for comparison.
 */
export function buildExpectedRules(
  chainName: string,
  allowlist: AllowlistEntry[],
): string[] {
  const rules: string[] = [];

  // ESTABLISHED/RELATED
  rules.push(`-A ${chainName} -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT`);

  // DNS
  rules.push(`-A ${chainName} -p udp -m udp --dport 53 -j ACCEPT`);
  rules.push(`-A ${chainName} -p tcp -m tcp --dport 53 -j ACCEPT`);

  // HTTPS to allowlisted IPs
  for (const entry of allowlist) {
    for (const ip of entry.ips) {
      rules.push(`-A ${chainName} -d ${ip}/32 -p tcp -m tcp --dport 443 -j ACCEPT`);
    }
  }

  // LOG
  rules.push(
    `-A ${chainName} -m limit --limit 5/min -j LOG --log-prefix "CLAWHQ_DROP: "`,
  );

  // DROP
  rules.push(`-A ${chainName} -j DROP`);

  return rules;
}
