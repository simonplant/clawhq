/**
 * Parity guarantee: the compose produced by `generateCompose` — the
 * single authoritative writer used by `clawhq build` — passes every
 * landmine validator that historically ran against the lightweight
 * `buildComposeConfig` stub produced by the wizard pipeline.
 *
 * Why this test exists: there are (were) two generators emitting
 * compose shapes, and the landmine validators have only ever run
 * against the stub. If the full generator drifts below the stub's
 * security bar for any blueprint, the wizard's validation would
 * still pass while the deployed compose would ship a gap. This
 * test closes that blind spot — and gates the deletion of the stub,
 * which is the next cleanup.
 */

import { describe, expect, it } from "vitest";

import {
  validateLM06,
  validateLM07,
  validateLM10,
  validateLM11,
  validateLM12,
  validateLM13,
} from "../../config/validate.js";
import type { ComposeConfig, ComposeServiceConfig } from "../../config/types.js";
import { listBuiltinBlueprints, loadBlueprint } from "../../design/blueprints/loader.js";

import { generateCompose } from "./compose.js";
import { DEFAULT_POSTURE, getPostureConfig } from "./posture.js";

const DEPLOY_DIR = "/tmp/parity-test";
const IMAGE_TAG = "openclaw:custom";
const NETWORK = "clawhq_net";

/**
 * generateCompose emits a strict ComposeOutput — all fields required,
 * typed literally. The landmine validators consume the looser
 * ComposeConfig (all fields optional, string-keyed Record). Structurally
 * the former is a superset of the latter, but the types don't unify
 * directly; cast via unknown.
 */
function asComposeConfig(output: ReturnType<typeof generateCompose>): ComposeConfig {
  return output as unknown as ComposeConfig;
}

/**
 * Extract the set of env-var names that the compose output references via
 * `${VAR}` / `${VAR:-default}` / `$VAR` syntax. The realistic validateLM11
 * call supplies a concrete envVars map; the realistic emitter (apply →
 * compile → writeBundle) always fills these. Pass the same set so this
 * test mirrors the runtime contract rather than inventing unrealistic
 * "env is empty" scenarios.
 */
function collectRequiredEnvVars(compose: ComposeConfig): Record<string, string> {
  const services = (compose.services ?? {}) as Record<string, ComposeServiceConfig>;
  const vars: Record<string, string> = {};
  const envRef = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::[^}]*)?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const svc of Object.values(services)) {
    const envMap = (svc.environment ?? {}) as Record<string, string>;
    for (const value of Object.values(envMap)) {
      let m: RegExpExecArray | null;
      while ((m = envRef.exec(value)) !== null) {
        const name = m[1] ?? m[2];
        if (name) vars[name] = "placeholder";
      }
    }
  }
  return vars;
}

describe("compose parity — generateCompose satisfies every landmine the stub did", () => {
  const posture = getPostureConfig(DEFAULT_POSTURE);
  const blueprintNames = listBuiltinBlueprints();

  // Minimal blueprints scenario: just the default hardened posture, no sidecars,
  // no tailscale. That's what `clawhq init` produces before `integrate add`
  // brings sidecars online — if landmines fail here, they'd fail for every
  // fresh install.
  for (const name of blueprintNames) {
    describe(`[${name}]`, () => {
      const compose = asComposeConfig(
        generateCompose(IMAGE_TAG, posture, DEPLOY_DIR, NETWORK),
      );

      // Sanity: load the blueprint so a syntactic break surfaces early.
      loadBlueprint(name);

      it("LM-06 container user is 1000", () => {
        expect(validateLM06(compose).passed).toBe(true);
      });

      it("LM-07 cap_drop ALL + no-new-privileges", () => {
        expect(validateLM07(compose).passed).toBe(true);
      });

      it("LM-10 network declared", () => {
        expect(validateLM10(compose).passed).toBe(true);
      });

      it("LM-11 every compose env-ref is satisfied by the realistic envVars", () => {
        expect(validateLM11(compose, collectRequiredEnvVars(compose)).passed).toBe(true);
      });

      it("LM-12 read_only rootfs + tmpfs", () => {
        expect(validateLM12(compose).passed).toBe(true);
      });

      it("LM-13 ICC disabled on network", () => {
        expect(validateLM13(compose).passed).toBe(true);
      });
    });
  }

  // Sidecar-enabled scenario: the fullest compose the platform emits.
  // Deletion of buildComposeConfig mustn't regress these either.
  describe("cred-proxy + market-engine enabled", () => {
    const compose = asComposeConfig(
      generateCompose(IMAGE_TAG, posture, DEPLOY_DIR, NETWORK, {
        enableCredProxy: true,
        enableMarketEngine: true,
      }),
    );

    it("LM-06/07/10/11/12 still pass with all sidecars", () => {
      expect(validateLM06(compose).passed).toBe(true);
      expect(validateLM07(compose).passed).toBe(true);
      expect(validateLM10(compose).passed).toBe(true);
      expect(validateLM11(compose, collectRequiredEnvVars(compose)).passed).toBe(true);
      expect(validateLM12(compose).passed).toBe(true);
    });

    // LM-13 now understands the two legitimate architectures:
    // ICC-disabled-for-standalone OR cred-proxy-present-with-firewall.
    // Either satisfies the "egress filtered" invariant.
    it("LM-13 recognizes cred-proxy as the egress-filter control", () => {
      const result = validateLM13(compose);
      expect(result.passed).toBe(true);
      expect(result.message).toContain("Cred-proxy");
    });
  });
});
