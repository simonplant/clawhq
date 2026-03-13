/**
 * Egress firewall types.
 *
 * Manages a dedicated iptables chain (CLAWHQ_FWD) on the Docker bridge
 * interface to restrict outbound traffic to allowlisted domains only.
 *
 * See docs/ARCHITECTURE.md → Security Architecture → Egress Firewall.
 */

/** A domain allowed through the egress firewall. */
export interface AllowlistEntry {
  domain: string;
  /** Resolved IP addresses for this domain. */
  ips: string[];
}

/** The complete firewall configuration to apply. */
export interface FirewallConfig {
  /** Name of the iptables chain. */
  chainName: string;
  /** Docker bridge interface name (e.g. "docker0", "br-xxxx"). */
  bridgeInterface: string;
  /** Domains allowed through HTTPS (port 443). */
  allowlist: AllowlistEntry[];
}

/** Result of a firewall operation (apply, remove). */
export interface FirewallResult {
  success: boolean;
  message: string;
}

/** Result of firewall verification. */
export interface VerifyResult {
  matches: boolean;
  /** Rules found in the chain. */
  currentRules: string[];
  /** Rules that should exist but don't. */
  missingRules: string[];
  /** Rules that exist but shouldn't. */
  extraRules: string[];
  message: string;
}

/** Cloud API provider domain mapping. */
export interface ProviderDomains {
  name: string;
  domains: string[];
}

/** The default chain name used by ClawHQ. */
export const CHAIN_NAME = "CLAWHQ_FWD";

/** Base domains always allowed (required for Docker pulls and DNS). */
export const BASE_DOMAINS: string[] = [
  "registry-1.docker.io",
  "auth.docker.io",
  "production.cloudflare.docker.com",
];

/** Cloud API provider domains, enabled per user opt-in. */
export const PROVIDER_DOMAINS: Record<string, string[]> = {
  anthropic: ["api.anthropic.com"],
  openai: ["api.openai.com"],
  google: ["generativelanguage.googleapis.com"],
  ollama: [], // localhost only, no egress needed
};
