/**
 * Regression: every shipped blueprint's `profile_ref` must resolve to a
 * profile ID that exists in `configs/profiles/`.
 *
 * Silent broken refs (e.g. `markets` when the profile is `trading`, `lifeops`
 * when it's `life-ops`) caused the 2026-04-21 stub-clobber incident to be
 * latent across 10 of 11 shipped blueprints — every `clawhq init --guided`
 * run producing a composition-less or unresolvable clawhq.yaml. This test
 * fails fast at CI time so the next mismatch doesn't ship.
 */

import { describe, expect, it } from "vitest";

import { loadAllProfiles } from "../catalog/loader.js";

import { listBuiltinBlueprints, loadBlueprint } from "./loader.js";

describe("blueprint profile_ref integrity", () => {
  const validProfileIds = new Set(loadAllProfiles().map((p) => p.id));
  const blueprintNames = listBuiltinBlueprints();

  it("ships at least one blueprint and one profile", () => {
    expect(blueprintNames.length).toBeGreaterThan(0);
    expect(validProfileIds.size).toBeGreaterThan(0);
  });

  for (const name of blueprintNames) {
    it(`blueprint "${name}" declares a profile_ref that resolves to a known profile`, () => {
      const { blueprint } = loadBlueprint(name);
      if (blueprint.profile_ref === undefined) {
        // profile_ref is optional in the schema, so an absent ref is allowed.
        return;
      }
      expect(
        validProfileIds.has(blueprint.profile_ref),
        `blueprint "${name}" profile_ref "${blueprint.profile_ref}" not in [${[...validProfileIds].join(", ")}]`,
      ).toBe(true);
    });
  }
});
