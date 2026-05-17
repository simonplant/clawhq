/**
 * Regression guard: no source file may hardcode "openclaw" as the
 * docker-compose service name in exec/ps/filter commands. After
 * compose generation became instance-scoped (`openclaw-<shortId>`),
 * any literal match would break in multi-agent deployments.
 *
 * Callers must resolve the service name via:
 *   resolveOpenclawServiceName({ deployDir })   // see ./container.ts
 *
 * Allowed sites (the helpers themselves, and tests) are exempted via
 * ALLOWED_PATHS below. Comments are skipped so docs/examples can
 * still mention the literal.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(__dirname, "..", "..");

/** Files that may legitimately contain the literal in non-comment lines. */
const ALLOWED_PATHS: readonly string[] = [
  // The resolver itself returns "openclaw" as a last-resort literal and
  // probes docker labels with the legacy value.
  "build/docker/container.ts",
  // The compose generator uses "openclaw" as the in-memory property key
  // on the typed ComposeOutput.services shape; the on-disk YAML key is
  // derived from primaryServiceName, which this regression test does
  // not police (it's already enforced by snapshot tests).
  "build/docker/compose.ts",
  // The deterministic-naming helpers.
  "build/docker/container-naming.ts",
];

/**
 * Patterns that indicate a hardcoded service name in a docker command.
 * Each regex looks for the literal as the *service argument*, not as a
 * property key or filename — those are legitimate elsewhere.
 */
const FORBIDDEN: readonly { name: string; pattern: RegExp }[] = [
  {
    name: 'docker compose exec -T openclaw',
    pattern: /"exec"\s*,\s*"-T"\s*,\s*"openclaw"/,
  },
  {
    name: 'docker compose ps -q openclaw',
    pattern: /"ps"\s*,\s*"-q"\s*,\s*"openclaw"/,
  },
  {
    name: 'label=com.docker.compose.service=openclaw filter',
    pattern: /"label=com\.docker\.compose\.service=openclaw"/,
  },
];

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTs(path, out);
    } else if (
      entry.isFile() &&
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name) &&
      !/\.regression\.test\.tsx?$/.test(entry.name)
    ) {
      out.push(path);
    }
  }
  return out;
}

describe("regression: no hardcoded openclaw service name", () => {
  it("docker exec/ps/filter commands resolve the service name dynamically", () => {
    const files = walkTs(SRC_ROOT);
    const violations: { file: string; line: number; text: string; rule: string }[] = [];

    for (const file of files) {
      const rel = relative(SRC_ROOT, file);
      if (ALLOWED_PATHS.includes(rel)) continue;

      const lines = readFileSync(file, "utf-8").split("\n");
      let inBlockComment = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";

        // Strip block comments line-by-line so we don't false-positive on docstrings.
        if (inBlockComment) {
          if (line.includes("*/")) inBlockComment = false;
          continue;
        }
        if (/^\s*\/\*/.test(line)) {
          if (!line.includes("*/")) inBlockComment = true;
          continue;
        }
        if (/^\s*(\/\/|\*)/.test(line)) continue;

        for (const { name, pattern } of FORBIDDEN) {
          if (pattern.test(line)) {
            violations.push({ file: rel, line: i + 1, text: line.trim(), rule: name });
          }
        }
      }
    }

    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line}  [${v.rule}]\n    ${v.text}`)
        .join("\n");
      throw new Error(
        `Hardcoded "openclaw" service literal(s) found — use resolveOpenclawServiceName({ deployDir }) instead:\n${msg}`,
      );
    }

    expect(violations).toEqual([]);
  });
});
