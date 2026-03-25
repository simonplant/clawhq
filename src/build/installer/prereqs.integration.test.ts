/**
 * Integration tests for prerequisite detection.
 *
 * These tests call the real check functions against installed binaries.
 * Tests skip gracefully when a binary is not available on the host.
 */

import { execFile } from "node:child_process";

import { describe, expect, it } from "vitest";

import { checkDocker, checkGit, checkNode, checkOllama, detectPrereqs } from "./prereqs.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Returns true if a command is reachable on the host. */
function isAvailable(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("which", [cmd], (err) => resolve(err === null));
  });
}

// ── Docker ──────────────────────────────────────────────────────────────────

describe("checkDocker (integration)", async () => {
  const hasDocker = await isAvailable("docker");

  it.skipIf(!hasDocker)("parses version from real docker output", async () => {
    const result = await checkDocker();

    expect(result.name).toBe("docker");
    // Docker is present — result should either pass (daemon running)
    // or fail with "daemon is not running" (CLI present but daemon down).
    // In both cases, version parsing should not produce a cryptic error.
    if (result.ok) {
      // Version string should contain a semver-like number
      expect(result.detail).toMatch(/Docker \d+\.\d+/);
    } else {
      expect(result.detail).toMatch(/daemon is not running/);
    }
  });
});

// ── Node.js ─────────────────────────────────────────────────────────────────

describe("checkNode (integration)", () => {
  // Node is always available — we're running in it.
  it("parses version from real node output", async () => {
    const result = await checkNode();

    expect(result.name).toBe("node");
    expect(result.ok).toBe(true);
    // Should contain the parsed version number (without the leading "v")
    expect(result.detail).toMatch(/Node\.js \d+\.\d+/);
  });

  it("version parsing matches process.versions.node", async () => {
    const result = await checkNode();
    const expected = process.versions.node;

    expect(result.ok).toBe(true);
    expect(result.detail).toContain(expected);
  });
});

// ── Ollama ──────────────────────────────────────────────────────────────────

describe("checkOllama (integration)", async () => {
  const hasOllama = await isAvailable("ollama");

  it.skipIf(!hasOllama)("parses version from real ollama output", async () => {
    const result = await checkOllama();

    expect(result.name).toBe("ollama");
    // Ollama binary is present — either server is running or not
    if (result.ok) {
      expect(result.detail).toMatch(/Ollama \d+\.\d+/);
    } else {
      // CLI found but server not running is a valid outcome
      expect(result.detail).toMatch(/not running/);
    }
  });

  it.skipIf(hasOllama)("returns not-found when ollama is absent", async () => {
    const result = await checkOllama();

    expect(result.name).toBe("ollama");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("not found");
  });
});

// ── Git ─────────────────────────────────────────────────────────────────────

describe("checkGit (integration)", async () => {
  const hasGit = await isAvailable("git");

  it.skipIf(!hasGit)("parses version from real git output", async () => {
    const result = await checkGit();

    expect(result.name).toBe("git");
    expect(result.ok).toBe(true);
    expect(result.detail).toMatch(/Git \d+\.\d+/);
  });
});

// ── detectPrereqs (aggregate) ───────────────────────────────────────────────

describe("detectPrereqs (integration)", () => {
  it("returns a report with real check results", async () => {
    const report = await detectPrereqs();

    expect(report.checks).toHaveLength(3);
    expect(report.checks.map((c) => c.name)).toEqual(["docker", "node", "ollama"]);
    // Each check should have a non-empty detail string
    for (const check of report.checks) {
      expect(check.detail).toBeTruthy();
    }
  });

  it("includes git when fromSource is true", async () => {
    const report = await detectPrereqs({ fromSource: true });

    expect(report.checks).toHaveLength(4);
    expect(report.checks.map((c) => c.name)).toEqual(["docker", "node", "ollama", "git"]);
  });
});
