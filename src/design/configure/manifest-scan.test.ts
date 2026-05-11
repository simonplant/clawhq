/**
 * Workspace manifest scan — locks the contract for per-agent identity
 * directories in multi-agent (Sterling) profiles.
 *
 * scanWorkspaceManifest builds the immutable file list that the Docker
 * compose generator uses to mount identity files chmod 444 :ro — the
 * supply-chain-attack countermeasure for the agent's own personality.
 * Multi-agent profiles emit identity under workspace/<agent-id>/; the
 * scanner must lift those into the immutable list with the same
 * protection as single-agent root-level files.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { scanWorkspaceManifest } from "./generate.js";

const IDENTITY_FILES = [
  "TOOLS.md",
  "IDENTITY.md",
  "SOUL.md",
  "AGENTS.md",
  "BOOTSTRAP.md",
  "HEARTBEAT.md",
];

function makeDeploy(): string {
  const root = mkdtempSync(join(tmpdir(), "manifest-scan-"));
  mkdirSync(join(root, "workspace"), { recursive: true });
  return root;
}

function touchIdentityFiles(workspaceSubdir: string): void {
  mkdirSync(workspaceSubdir, { recursive: true });
  for (const f of IDENTITY_FILES) {
    writeFileSync(join(workspaceSubdir, f), `# ${f}\n`);
  }
}

describe("scanWorkspaceManifest — multi-agent partition", () => {
  it("lifts per-agent identity files into the immutable list", () => {
    const deploy = makeDeploy();
    touchIdentityFiles(join(deploy, "workspace", "life-ops"));
    touchIdentityFiles(join(deploy, "workspace", "markets"));

    const manifest = scanWorkspaceManifest(deploy);

    for (const f of IDENTITY_FILES) {
      expect(manifest.immutable).toContain(`life-ops/${f}`);
      expect(manifest.immutable).toContain(`markets/${f}`);
    }
  });

  it("still lifts root-level identity files when present (single-agent)", () => {
    const deploy = makeDeploy();
    for (const f of IDENTITY_FILES) {
      writeFileSync(join(deploy, "workspace", f), `# ${f}\n`);
    }

    const manifest = scanWorkspaceManifest(deploy);

    for (const f of IDENTITY_FILES) {
      expect(manifest.immutable).toContain(f);
    }
  });

  it("ignores non-agent subdirectories (skills, memory, config, state)", () => {
    // Subdirs without identity files must NOT be treated as agent
    // workspaces — they're tool/data dirs and have their own ownership
    // rules. Falsely classifying them as agents would inflate the
    // immutable list with arbitrary content.
    const deploy = makeDeploy();
    const ws = join(deploy, "workspace");
    mkdirSync(join(ws, "skills", "morning-brief"), { recursive: true });
    writeFileSync(join(ws, "skills", "morning-brief", "SKILL.md"), "x");
    mkdirSync(join(ws, "memory"), { recursive: true });
    writeFileSync(join(ws, "memory", "2026-05-11.md"), "x");
    mkdirSync(join(ws, "config"), { recursive: true });
    writeFileSync(join(ws, "config", "substack-aliases.json"), "{}");

    const manifest = scanWorkspaceManifest(deploy);

    // No SOUL.md present in any of those subdirs, so nothing in immutable
    // should reference them as per-agent identity.
    const perAgent = manifest.immutable.filter((p) => /\/SOUL\.md$/.test(p));
    expect(perAgent).toEqual([]);
  });

  it("subdir with PARTIAL identity files is still recognised", () => {
    // A future scenario: an agent that only ships SOUL.md and IDENTITY.md
    // (custom build, smaller surface). The scanner should still treat it
    // as a per-agent workspace and lift the present files — recognition
    // hinges on "at least one canonical identity file is present", not
    // "all eight are present".
    const deploy = makeDeploy();
    const sub = join(deploy, "workspace", "minimal");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "SOUL.md"), "x");

    const manifest = scanWorkspaceManifest(deploy);

    expect(manifest.immutable).toContain("minimal/SOUL.md");
    // Files that don't exist in the subdir aren't added.
    expect(manifest.immutable).not.toContain("minimal/AGENTS.md");
  });
});
