/**
 * Check: Egress firewall applied and matches expected rules.
 *
 * Verifies the CLAWHQ_FWD iptables chain exists and contains
 * the expected rules for the configured allowlist.
 */

import {
  buildConfig,
  chainExists,
  checkPlatform,
  verify,
} from "../../security/firewall/index.js";
import type { Check, CheckResult, DoctorContext } from "../types.js";

export interface FirewallCheckContext extends DoctorContext {
  enabledProviders?: string[];
  extraDomains?: string[];
  bridgeInterface?: string;
}

export const firewallCheck: Check = {
  name: "Egress firewall",

  async run(ctx: DoctorContext): Promise<CheckResult> {
    const fwCtx = ctx as FirewallCheckContext;

    // Check platform support
    const platform = checkPlatform();
    if (!platform.supported) {
      return {
        name: this.name,
        status: "warn",
        message: platform.message,
        fix: "",
      };
    }

    try {
      // Check if chain exists at all
      const exists = await chainExists("CLAWHQ_FWD");
      if (!exists) {
        return {
          name: this.name,
          status: "fail",
          message: "CLAWHQ_FWD chain does not exist — egress firewall is not applied",
          fix: "Run `clawhq up` to apply the egress firewall, or apply manually with the firewall module",
        };
      }

      // Build expected config and verify rules match
      const config = await buildConfig({
        enabledProviders: fwCtx.enabledProviders,
        extraDomains: fwCtx.extraDomains,
        bridgeInterface: fwCtx.bridgeInterface,
      });

      const result = await verify(config);

      if (result.matches) {
        return {
          name: this.name,
          status: "pass",
          message: `Firewall rules match expected state (${config.allowlist.length} domains allowlisted)`,
          fix: "",
        };
      }

      return {
        name: this.name,
        status: "fail",
        message: `Firewall rules mismatch: ${result.message}`,
        fix: "Reapply the firewall with `clawhq up` or re-run firewall apply",
      };
    } catch (err: unknown) {
      return {
        name: this.name,
        status: "fail",
        message: `Cannot check firewall: ${err instanceof Error ? err.message : String(err)}`,
        fix: "Ensure iptables is installed and you have sudo access",
      };
    }
  },
};
