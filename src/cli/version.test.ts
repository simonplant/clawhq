import { describe, expect, it } from "vitest";

import { getVersion } from "./version.js";

describe("getVersion", () => {
  it("returns the version from package.json", () => {
    const version = getVersion();
    expect(version).toBe("0.1.0");
  });

  it("returns a valid semver string", () => {
    const version = getVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
