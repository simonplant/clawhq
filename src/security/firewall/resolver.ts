/**
 * Domain-to-IP resolver for firewall allowlist entries.
 *
 * Resolves domain names to IPv4 addresses using the system DNS resolver.
 * Used to build iptables rules that match by destination IP.
 */

import { resolve4 } from "node:dns/promises";

import type { AllowlistEntry } from "./types.js";

/**
 * Resolve a single domain to its IPv4 addresses.
 *
 * Returns an empty array if resolution fails (the domain will be
 * skipped in rule generation, logged as a warning).
 */
export async function resolveDomain(domain: string): Promise<string[]> {
  try {
    return await resolve4(domain);
  } catch {
    return [];
  }
}

/**
 * Resolve all domains in an allowlist to IP addresses.
 *
 * Resolves concurrently for speed. Domains that fail resolution
 * are included with an empty IP list (caller decides how to handle).
 */
export async function resolveAllowlist(domains: string[]): Promise<AllowlistEntry[]> {
  const entries = await Promise.all(
    domains.map(async (domain) => ({
      domain,
      ips: await resolveDomain(domain),
    })),
  );
  return entries;
}
