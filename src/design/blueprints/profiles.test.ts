import { describe, expect, it } from "vitest";

import {
  isValidProfileId,
  mergeProfileDeny,
  MISSION_PROFILE_DEFAULTS,
  MISSION_PROFILE_IDS,
} from "./profiles.js";

// ── MISSION_PROFILE_DEFAULTS Registry ──────────────────────────────────────

describe("MISSION_PROFILE_DEFAULTS", () => {
  it("has entries for all 5 required profiles", () => {
    const required = ["lifeops", "dev", "research", "markets", "marketing"] as const;
    for (const id of required) {
      expect(MISSION_PROFILE_DEFAULTS[id]).toBeDefined();
      expect(MISSION_PROFILE_DEFAULTS[id].deny).toBeInstanceOf(Array);
      expect(MISSION_PROFILE_DEFAULTS[id].recommended_integrations).toBeInstanceOf(Array);
    }
  });

  it("dev profile has no tools denied", () => {
    expect(MISSION_PROFILE_DEFAULTS.dev.deny).toHaveLength(0);
  });

  it("lifeops profile denies browser and nodes", () => {
    expect(MISSION_PROFILE_DEFAULTS.lifeops.deny).toContain("browser");
    expect(MISSION_PROFILE_DEFAULTS.lifeops.deny).toContain("nodes");
  });

  it("research profile denies nodes but not browser", () => {
    expect(MISSION_PROFILE_DEFAULTS.research.deny).toContain("nodes");
    expect(MISSION_PROFILE_DEFAULTS.research.deny).not.toContain("browser");
  });

  it("markets profile denies nodes but not browser (charting allowed)", () => {
    expect(MISSION_PROFILE_DEFAULTS.markets.deny).toContain("nodes");
    expect(MISSION_PROFILE_DEFAULTS.markets.deny).not.toContain("browser");
  });

  it("marketing profile denies nodes", () => {
    expect(MISSION_PROFILE_DEFAULTS.marketing.deny).toContain("nodes");
  });

  it("every profile has recommended_integrations", () => {
    for (const id of MISSION_PROFILE_IDS) {
      expect(MISSION_PROFILE_DEFAULTS[id].recommended_integrations.length).toBeGreaterThan(0);
    }
  });
});

// ── isValidProfileId ───────────────────────────────────────────────────────

describe("isValidProfileId", () => {
  it("returns true for valid profile IDs", () => {
    expect(isValidProfileId("lifeops")).toBe(true);
    expect(isValidProfileId("dev")).toBe(true);
    expect(isValidProfileId("research")).toBe(true);
    expect(isValidProfileId("markets")).toBe(true);
    expect(isValidProfileId("marketing")).toBe(true);
  });

  it("returns false for invalid profile IDs", () => {
    expect(isValidProfileId("unknown")).toBe(false);
    expect(isValidProfileId("")).toBe(false);
    expect(isValidProfileId("home")).toBe(false);
  });
});

// ── mergeProfileDeny ───────────────────────────────────────────────────────

describe("mergeProfileDeny", () => {
  it("returns profile deny when no blueprint overrides", () => {
    const result = mergeProfileDeny(["browser", "nodes"], [], []);
    expect(result).toEqual(["browser", "nodes"]);
  });

  it("returns empty for dev profile (no deny)", () => {
    const result = mergeProfileDeny([], [], []);
    expect(result).toEqual([]);
  });

  it("adds blueprint deny to profile deny (union)", () => {
    const result = mergeProfileDeny(["browser"], ["gateway"], []);
    expect(result).toEqual(["browser", "gateway"]);
  });

  it("deduplicates when blueprint deny overlaps profile deny", () => {
    const result = mergeProfileDeny(["browser", "nodes"], ["browser", "gateway"], []);
    expect(result).toEqual(["browser", "gateway", "nodes"]);
  });

  it("blueprint allow removes from profile deny", () => {
    const result = mergeProfileDeny(["browser", "nodes"], [], ["browser"]);
    expect(result).toEqual(["nodes"]);
  });

  it("deny-wins: blueprint deny + allow for same tool keeps it denied", () => {
    const result = mergeProfileDeny(["browser", "nodes"], ["browser"], ["browser"]);
    expect(result).toEqual(["browser", "nodes"]);
  });

  it("blueprint allow cannot remove items from blueprint deny", () => {
    const result = mergeProfileDeny([], ["gateway", "exec"], ["gateway"]);
    expect(result).toEqual(["exec", "gateway"]);
  });

  it("blueprint allow only removes profile deny, not blueprint deny", () => {
    const result = mergeProfileDeny(["browser"], ["nodes"], ["browser", "nodes"]);
    // browser is profile deny, allowed, not in blueprint deny → removed
    // nodes is blueprint deny, allowed, but deny-wins → kept
    expect(result).toEqual(["nodes"]);
  });

  it("returns sorted list", () => {
    const result = mergeProfileDeny(["nodes", "browser"], ["gateway", "exec"], []);
    expect(result).toEqual(["browser", "exec", "gateway", "nodes"]);
  });
});
