/**
 * Single-agent compile parity — guard against multi-agent emit (M1+) leaking
 * into single-agent blueprints.
 *
 * Why this test exists: ClawHQ is adding per-agent overrides via
 * `agents.list[]` (Sterling Gen-4). Every existing blueprint (life-ops,
 * family-hub, stoic-coach, etc.) stays single-agent and MUST keep producing
 * the same `agents` block it produces today — `agents.defaults` only, no
 * `agents.list`. If a future compiler change silently starts emitting
 * `agents.list` for these blueprints, OpenClaw will treat the previously-
 * implicit default agent as just-one-of-many and routing semantics shift.
 *
 * This file pins the contract: single-agent blueprints emit a single-agent
 * `agents` block. When a blueprint INTENTIONALLY becomes multi-agent
 * (sterling-gen4), add it to the EXCLUDED set below — that's a one-line
 * change that gets reviewed as part of the multi-agent work.
 */

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { loadAllProfiles } from "./loader.js";
import type { UserConfig } from "./types.js";

import { compile } from "./index.js";

const TEST_USER: UserConfig = {
  name: "TestUser",
  timezone: "UTC",
  communication: "brief",
};

const DEPLOY_DIR = "/tmp/single-agent-parity-test";

/**
 * Profiles that legitimately emit `agents.list[]`. Adding an id here is an
 * explicit acknowledgement that the profile is multi-agent and should NOT
 * be checked against the single-agent contract.
 */
const MULTI_AGENT_PROFILES = new Set<string>([
  // Sterling Gen-4 will land here when its profile ships.
]);

function compileOpenclawJson(profile: string): string {
  const result = compile({ profile }, TEST_USER, DEPLOY_DIR);
  const oc = result.files.find((f) => f.relativePath === "openclaw.json");
  if (!oc) throw new Error(`compile(${profile}) produced no openclaw.json`);
  return oc.content;
}

describe("single-agent compile parity", () => {
  const allProfiles = loadAllProfiles().map((p) => p.id);
  const singleAgentProfiles = allProfiles.filter(
    (id) => !MULTI_AGENT_PROFILES.has(id),
  );

  it("has at least one single-agent profile to test", () => {
    expect(singleAgentProfiles.length).toBeGreaterThan(0);
  });

  for (const profile of singleAgentProfiles) {
    describe(`[${profile}]`, () => {
      const content = compileOpenclawJson(profile);
      const config = JSON.parse(content) as Record<string, unknown>;
      const agents = config.agents as
        | { list?: unknown; defaults?: Record<string, unknown> }
        | undefined;

      it("emits agents.defaults", () => {
        expect(agents).toBeDefined();
        expect(agents?.defaults).toBeDefined();
      });

      it("does NOT emit agents.list (single-agent invariant)", () => {
        // If this fails, EITHER (a) the blueprint legitimately became
        // multi-agent — add it to MULTI_AGENT_BLUEPRINTS above; OR (b) a
        // compiler change is leaking multi-agent emit into single-agent
        // outputs — fix the compiler, not the test.
        expect(agents?.list).toBeUndefined();
      });

      it("defaults.model.primary is a non-empty string", () => {
        const model = agents?.defaults?.model as
          | { primary?: unknown }
          | undefined;
        expect(typeof model?.primary).toBe("string");
        expect((model?.primary as string).length).toBeGreaterThan(0);
      });

      it("compile is deterministic — two runs produce byte-identical output", () => {
        const second = compileOpenclawJson(profile);
        expect(second).toBe(content);
      });
    });
  }
});

describe("life-ops content digest", () => {
  // A tighter lock on the life-ops profile specifically — it's the one
  // Clawdius runs in production. Any compiler change that alters this hash
  // must be reviewed: regenerate intentionally, or fix the regression.
  //
  // To regenerate after an intentional change, run:
  //   node -e "const {compile}=require('./dist/design/catalog/index.js'); \
  //     const {createHash}=require('node:crypto'); \
  //     const r=compile({profile:'life-ops'},{name:'TestUser',timezone:'UTC',communication:'brief'},'/tmp/single-agent-parity-test'); \
  //     console.log(createHash('sha256').update(r.files.find(f=>f.relativePath==='openclaw.json').content).digest('hex'))"
  // …and replace EXPECTED_LIFEOPS_DIGEST below.

  // Pinned 2026-05-11 (M1 baseline). When this fails, EITHER (a) regenerate
  // intentionally if the compiler change was deliberate, OR (b) treat the
  // failure as a regression and fix the compiler.
  const EXPECTED_LIFEOPS_DIGEST =
    "6364d575961d447877bdde34168dd02422b69e9a9a01e73a83db5bbb63791d2e";

  it("life-ops openclaw.json is stable across compiler changes", () => {
    const actual = createHash("sha256")
      .update(compileOpenclawJson("life-ops"))
      .digest("hex");
    expect(actual).toBe(EXPECTED_LIFEOPS_DIGEST);
  });
});
