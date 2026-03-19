/**
 * Prerequisite detection for `clawhq install`.
 *
 * Checks that Docker, Node.js >=22, and Ollama are available on the host.
 * Each check is independent and never throws — a failed check returns
 * `ok: false` with a human-readable detail message.
 */

import { execFile } from "node:child_process";

import type { PrereqCheckResult, PrereqReport } from "./types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Run a command and return stdout, or null on failure. */
function run(cmd: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args as string[], { timeout: 10_000 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/** Extract a semver-like version string from output. */
function extractVersion(output: string): string | null {
  const match = /(\d+\.\d+[\w.-]*)/.exec(output);
  return match ? match[1] : null;
}

/** Parse the major version number from a version string. */
function parseMajor(version: string): number {
  const match = /^(\d+)/.exec(version);
  return match ? parseInt(match[1], 10) : 0;
}

// ── Individual Checks ───────────────────────────────────────────────────────

/** Check that Docker is installed and the daemon is reachable. */
export async function checkDocker(): Promise<PrereqCheckResult> {
  const output = await run("docker", ["version", "--format", "{{.Server.Version}}"]);
  if (output === null) {
    // Docker CLI may exist but daemon isn't running — try just the CLI
    const cliOutput = await run("docker", ["--version"]);
    if (cliOutput !== null) {
      return {
        name: "docker",
        ok: false,
        detail: "Docker CLI found but daemon is not running. Start Docker and try again.",
      };
    }
    return {
      name: "docker",
      ok: false,
      detail: "Docker not found. Install Docker: https://docs.docker.com/get-docker/",
    };
  }

  const version = extractVersion(output);
  return {
    name: "docker",
    ok: true,
    detail: version ? `Docker ${version}` : "Docker available",
  };
}

/** Check that Node.js >= 22 is available. */
export async function checkNode(): Promise<PrereqCheckResult> {
  const output = await run("node", ["--version"]);
  if (output === null) {
    return {
      name: "node",
      ok: false,
      detail: "Node.js not found. Install Node.js >=22: https://nodejs.org/",
    };
  }

  const version = extractVersion(output.replace(/^v/, ""));
  if (!version) {
    return {
      name: "node",
      ok: false,
      detail: `Node.js found but could not parse version from: ${output}`,
    };
  }

  const major = parseMajor(version);
  if (major < 22) {
    return {
      name: "node",
      ok: false,
      detail: `Node.js ${version} found but >=22 required. Upgrade: https://nodejs.org/`,
    };
  }

  return {
    name: "node",
    ok: true,
    detail: `Node.js ${version}`,
  };
}

/** Check that Ollama is installed and running. */
export async function checkOllama(): Promise<PrereqCheckResult> {
  const output = await run("ollama", ["--version"]);
  if (output === null) {
    return {
      name: "ollama",
      ok: false,
      detail: "Ollama not found. Install Ollama: https://ollama.ai/download",
    };
  }

  const version = extractVersion(output);

  // Check if the Ollama server is reachable
  const listOutput = await run("ollama", ["list"]);
  if (listOutput === null) {
    return {
      name: "ollama",
      ok: false,
      detail: `Ollama ${version ?? ""} installed but not running. Start it with: ollama serve`.trim(),
    };
  }

  return {
    name: "ollama",
    ok: true,
    detail: version ? `Ollama ${version}` : "Ollama available",
  };
}

/** Check that Git is installed (required for --from-source). */
export async function checkGit(): Promise<PrereqCheckResult> {
  const output = await run("git", ["--version"]);
  if (output === null) {
    return {
      name: "git",
      ok: false,
      detail: "Git not found. Install Git: https://git-scm.com/downloads",
    };
  }

  const version = extractVersion(output);
  return {
    name: "git",
    ok: true,
    detail: version ? `Git ${version}` : "Git available",
  };
}

// ── Aggregate ───────────────────────────────────────────────────────────────

/** Options for prerequisite detection. */
export interface DetectPrereqsOptions {
  /** Include git check (required for --from-source). */
  readonly fromSource?: boolean;
}

/** Run all prerequisite checks and return an aggregate report. */
export async function detectPrereqs(options?: DetectPrereqsOptions): Promise<PrereqReport> {
  const checks = await Promise.all([
    checkDocker(),
    checkNode(),
    checkOllama(),
    ...(options?.fromSource ? [checkGit()] : []),
  ]);

  return {
    passed: checks.every((c) => c.ok),
    checks,
  };
}
