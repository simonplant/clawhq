/**
 * High-level egress firewall management.
 *
 * Provides Apply(), Remove(), and Verify() operations for the
 * CLAWHQ_FWD iptables chain on the Docker bridge interface.
 *
 * Apply() is idempotent — safe to call multiple times.
 *
 * See docs/ARCHITECTURE.md → Security Architecture → Egress Firewall.
 */

import {
  applyRules,
  buildExpectedRules,
  chainExists,
  checkPlatform,
  createChain,
  deleteChain,
  flushChain,
  insertForwardJump,
  listRules,
  removeForwardJump,
} from "./iptables.js";
import { resolveAllowlist } from "./resolver.js";
import type {
  AllowlistEntry,
  FirewallConfig,
  FirewallResult,
  VerifyResult,
} from "./types.js";
import { BASE_DOMAINS, CHAIN_NAME, PROVIDER_DOMAINS } from "./types.js";

/**
 * Derive the full domain allowlist from base domains + opted-in providers.
 *
 * @param enabledProviders - Provider names the user has opted into (e.g. ["anthropic", "openai"])
 * @param extraDomains - Additional domains to allowlist
 */
export function deriveAllowlist(
  enabledProviders: string[] = [],
  extraDomains: string[] = [],
): string[] {
  const domains = new Set<string>(BASE_DOMAINS);

  for (const provider of enabledProviders) {
    const providerDomains = PROVIDER_DOMAINS[provider];
    if (providerDomains) {
      for (const d of providerDomains) {
        domains.add(d);
      }
    }
  }

  for (const d of extraDomains) {
    domains.add(d);
  }

  return [...domains];
}

/**
 * Build a FirewallConfig from user settings.
 *
 * Resolves all domains to IPs for iptables rules.
 */
export async function buildConfig(options: {
  enabledProviders?: string[];
  extraDomains?: string[];
  bridgeInterface?: string;
}): Promise<FirewallConfig> {
  const domains = deriveAllowlist(
    options.enabledProviders,
    options.extraDomains,
  );
  const allowlist = await resolveAllowlist(domains);

  return {
    chainName: CHAIN_NAME,
    bridgeInterface: options.bridgeInterface ?? "docker0",
    allowlist,
  };
}

/**
 * Apply the egress firewall.
 *
 * Idempotent: flushes existing rules and reapplies from scratch.
 * Creates the chain if it doesn't exist.
 */
export async function apply(config: FirewallConfig): Promise<FirewallResult> {
  const platformCheck = checkPlatform();
  if (!platformCheck.supported) {
    return { success: false, message: platformCheck.message };
  }

  try {
    // Create or flush the chain (idempotent)
    await createChain(config.chainName);
    await flushChain(config.chainName);

    // Apply the rules
    await applyRules(config.chainName, config.allowlist);

    // Insert FORWARD jump for the bridge interface
    await insertForwardJump(config.chainName, config.bridgeInterface);

    const domainCount = config.allowlist.filter((e) => e.ips.length > 0).length;
    const ipCount = config.allowlist.reduce((sum, e) => sum + e.ips.length, 0);

    return {
      success: true,
      message: `Firewall applied: ${domainCount} domains (${ipCount} IPs) allowlisted on ${config.bridgeInterface}`,
    };
  } catch (err: unknown) {
    return {
      success: false,
      message: `Failed to apply firewall: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Remove the egress firewall completely.
 *
 * Removes the FORWARD jump, flushes rules, and deletes the chain.
 */
export async function remove(config: FirewallConfig): Promise<FirewallResult> {
  const platformCheck = checkPlatform();
  if (!platformCheck.supported) {
    return { success: false, message: platformCheck.message };
  }

  try {
    if (!(await chainExists(config.chainName))) {
      return { success: true, message: "Firewall chain does not exist, nothing to remove" };
    }

    await removeForwardJump(config.chainName, config.bridgeInterface);
    await deleteChain(config.chainName);

    return { success: true, message: "Firewall removed" };
  } catch (err: unknown) {
    return {
      success: false,
      message: `Failed to remove firewall: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Verify that the current iptables rules match the expected state.
 *
 * Returns true only when rules match exactly.
 */
export async function verify(config: FirewallConfig): Promise<VerifyResult> {
  const platformCheck = checkPlatform();
  if (!platformCheck.supported) {
    return {
      matches: false,
      currentRules: [],
      missingRules: [],
      extraRules: [],
      message: platformCheck.message,
    };
  }

  try {
    const exists = await chainExists(config.chainName);
    if (!exists) {
      return {
        matches: false,
        currentRules: [],
        missingRules: ["(chain does not exist)"],
        extraRules: [],
        message: `Chain ${config.chainName} does not exist`,
      };
    }

    const currentRules = await listRules(config.chainName);
    const expectedRules = buildExpectedRules(config.chainName, config.allowlist);

    // Normalize rules for comparison (trim whitespace, consistent spacing)
    const normalize = (rule: string) => rule.replace(/\s+/g, " ").trim();
    const currentSet = new Set(currentRules.map(normalize));
    const expectedSet = new Set(expectedRules.map(normalize));

    const missingRules = expectedRules.filter((r) => !currentSet.has(normalize(r)));
    const extraRules = currentRules.filter((r) => !expectedSet.has(normalize(r)));

    const matches = missingRules.length === 0 && extraRules.length === 0;

    return {
      matches,
      currentRules,
      missingRules,
      extraRules,
      message: matches
        ? "Firewall rules match expected state"
        : `${missingRules.length} missing, ${extraRules.length} unexpected rules`,
    };
  } catch (err: unknown) {
    return {
      matches: false,
      currentRules: [],
      missingRules: [],
      extraRules: [],
      message: `Cannot verify firewall: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export { AllowlistEntry, FirewallConfig, FirewallResult, VerifyResult };
