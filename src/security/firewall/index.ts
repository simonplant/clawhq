// Egress firewall with domain allowlisting.
// See docs/ARCHITECTURE.md → Security Architecture → Egress Firewall.

export {
  apply,
  buildConfig,
  deriveAllowlist,
  remove,
  verify,
} from "./firewall.js";

export type {
  AllowlistEntry,
  FirewallConfig,
  FirewallResult,
  VerifyResult,
} from "./firewall.js";

export { resolveDomain, resolveAllowlist } from "./resolver.js";

export {
  buildExpectedRules,
  chainExists,
  checkPlatform,
  listRules,
} from "./iptables.js";

export {
  BASE_DOMAINS,
  CHAIN_NAME,
  PROVIDER_DOMAINS,
} from "./types.js";

export type { ProviderDomains } from "./types.js";
