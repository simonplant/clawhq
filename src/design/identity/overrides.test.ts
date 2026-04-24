import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  globalIdentityTemplatesDir,
  instanceIdentityTemplatesDir,
  readIdentityOverride,
  withIdentityOverride,
} from "./overrides.js";

let homeSandbox: string;
let originalHome: string | undefined;

beforeEach(() => {
  homeSandbox = mkdtempSync(join(tmpdir(), "identity-overrides-home-"));
  originalHome = process.env["HOME"];
  process.env["HOME"] = homeSandbox;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  rmSync(homeSandbox, { recursive: true, force: true });
});

describe("globalIdentityTemplatesDir / instanceIdentityTemplatesDir", () => {
  it("resolves to the expected Layer-2 directories", () => {
    expect(globalIdentityTemplatesDir()).toBe(
      join(homeSandbox, ".clawhq", "templates", "identity"),
    );
    expect(instanceIdentityTemplatesDir("01955000-0000-4000-8000-000000000001")).toBe(
      join(
        homeSandbox,
        ".clawhq",
        "instances",
        "01955000-0000-4000-8000-000000000001",
        "templates",
        "identity",
      ),
    );
  });
});

describe("readIdentityOverride", () => {
  it("returns undefined when no override exists", () => {
    expect(readIdentityOverride("SOUL.md")).toBeUndefined();
  });

  it("returns the machine-global override content when present", () => {
    mkdirSync(globalIdentityTemplatesDir(), { recursive: true });
    writeFileSync(join(globalIdentityTemplatesDir(), "SOUL.md"), "# my custom soul\n");
    expect(readIdentityOverride("SOUL.md")).toBe("# my custom soul\n");
  });

  it("returns the per-instance override when both exist (instance wins)", () => {
    mkdirSync(globalIdentityTemplatesDir(), { recursive: true });
    writeFileSync(join(globalIdentityTemplatesDir(), "SOUL.md"), "global\n");

    const id = "01955000-0000-4000-8000-000000000001";
    mkdirSync(instanceIdentityTemplatesDir(id), { recursive: true });
    writeFileSync(join(instanceIdentityTemplatesDir(id), "SOUL.md"), "per-instance\n");

    expect(readIdentityOverride("SOUL.md", id)).toBe("per-instance\n");
  });

  it("falls back to global when per-instance is absent", () => {
    mkdirSync(globalIdentityTemplatesDir(), { recursive: true });
    writeFileSync(join(globalIdentityTemplatesDir(), "SOUL.md"), "global\n");

    const id = "01955000-0000-4000-8000-000000000001";
    expect(readIdentityOverride("SOUL.md", id)).toBe("global\n");
  });

  it("returns undefined when neither exists (with or without instanceId)", () => {
    expect(readIdentityOverride("AGENTS.md")).toBeUndefined();
    expect(readIdentityOverride("AGENTS.md", "some-id")).toBeUndefined();
  });
});

describe("withIdentityOverride", () => {
  it("returns rendered content when no override exists", () => {
    expect(withIdentityOverride("SOUL.md", "rendered content")).toBe("rendered content");
  });

  it("returns the override content verbatim when one exists", () => {
    mkdirSync(globalIdentityTemplatesDir(), { recursive: true });
    writeFileSync(join(globalIdentityTemplatesDir(), "SOUL.md"), "overridden");
    expect(withIdentityOverride("SOUL.md", "rendered content")).toBe("overridden");
  });

  it("discards renderer output when per-instance override exists", () => {
    const id = "01955000-0000-4000-8000-000000000001";
    mkdirSync(instanceIdentityTemplatesDir(id), { recursive: true });
    writeFileSync(join(instanceIdentityTemplatesDir(id), "TOOLS.md"), "my tools");
    expect(withIdentityOverride("TOOLS.md", "rendered tools", id)).toBe("my tools");
  });
});
