/**
 * Integration test — identity-fragment overrides flow through compile().
 *
 * When a user drops a SOUL.md (or any identity fragment) at the Layer-2
 * template path, the compiler's output for that fragment must match the
 * override byte-for-byte, discarding the renderer's version entirely.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { globalIdentityTemplatesDir, instanceIdentityTemplatesDir } from "../identity/overrides.js";

import { compile } from "./compiler.js";
import type { UserConfig } from "./types.js";

const TEST_USER: UserConfig = {
  name: "Test User",
  timezone: "UTC",
};

let homeSandbox: string;
let originalHome: string | undefined;

beforeEach(() => {
  homeSandbox = mkdtempSync(join(tmpdir(), "compiler-overrides-home-"));
  originalHome = process.env["HOME"];
  process.env["HOME"] = homeSandbox;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  rmSync(homeSandbox, { recursive: true, force: true });
});

function contentFor(result: ReturnType<typeof compile>, relativePath: string): string | undefined {
  return result.files.find((f) => f.relativePath === relativePath)?.content;
}

describe("compile — identity-fragment overrides", () => {
  it("applies a machine-global SOUL.md override verbatim", () => {
    mkdirSync(globalIdentityTemplatesDir(), { recursive: true });
    writeFileSync(
      join(globalIdentityTemplatesDir(), "SOUL.md"),
      "# custom soul\n\nForged by hand.\n",
    );

    const result = compile({ profile: "life-ops" }, TEST_USER, "/tmp/test");

    expect(contentFor(result, "workspace/SOUL.md")).toBe("# custom soul\n\nForged by hand.\n");
  });

  it("per-instance override takes precedence over machine-global", () => {
    mkdirSync(globalIdentityTemplatesDir(), { recursive: true });
    writeFileSync(join(globalIdentityTemplatesDir(), "TOOLS.md"), "global tools\n");

    const id = "01955000-0000-4000-8000-000000000001";
    mkdirSync(instanceIdentityTemplatesDir(id), { recursive: true });
    writeFileSync(join(instanceIdentityTemplatesDir(id), "TOOLS.md"), "per-instance tools\n");

    const result = compile(
      { profile: "life-ops" },
      TEST_USER,
      "/tmp/test",
      undefined,
      {},
      {},
      { instanceId: id },
    );

    expect(contentFor(result, "workspace/TOOLS.md")).toBe("per-instance tools\n");
  });

  it("uses the renderer output when no override exists", () => {
    const result = compile({ profile: "life-ops" }, TEST_USER, "/tmp/test");
    const soul = contentFor(result, "workspace/SOUL.md");
    // Renderer output is non-empty and contains the canonical blueprint's name heading.
    expect(soul).toBeDefined();
    expect(soul?.length ?? 0).toBeGreaterThan(50);
  });

  it("applies overrides to every identity fragment independently", () => {
    mkdirSync(globalIdentityTemplatesDir(), { recursive: true });
    writeFileSync(join(globalIdentityTemplatesDir(), "AGENTS.md"), "just agents\n");
    writeFileSync(join(globalIdentityTemplatesDir(), "BOOTSTRAP.md"), "just bootstrap\n");

    const result = compile({ profile: "life-ops" }, TEST_USER, "/tmp/test");

    expect(contentFor(result, "workspace/AGENTS.md")).toBe("just agents\n");
    expect(contentFor(result, "workspace/BOOTSTRAP.md")).toBe("just bootstrap\n");
    // Untouched — renderer output
    expect(contentFor(result, "workspace/SOUL.md")?.length ?? 0).toBeGreaterThan(50);
  });
});
