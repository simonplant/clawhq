import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveOpenclawServiceName } from "./container.js";

describe("resolveOpenclawServiceName", () => {
  let deployDir: string;

  beforeEach(() => {
    deployDir = mkdtempSync(join(tmpdir(), "clawhq-resolver-"));
    mkdirSync(join(deployDir, "engine"), { recursive: true });
  });

  afterEach(() => {
    rmSync(deployDir, { recursive: true, force: true });
  });

  it("returns 'openclaw' for an empty deployDir (last-resort fallback)", () => {
    expect(resolveOpenclawServiceName({ deployDir })).toBe("openclaw");
  });

  it("returns the parsed key from compose.yml when present (legacy literal)", () => {
    writeFileSync(
      join(deployDir, "engine", "docker-compose.yml"),
      ["services:", "  openclaw:", "    image: foo:latest"].join("\n"),
    );
    expect(resolveOpenclawServiceName({ deployDir })).toBe("openclaw");
  });

  it("returns the parsed key from compose.yml when present (instance-scoped)", () => {
    writeFileSync(
      join(deployDir, "engine", "docker-compose.yml"),
      [
        "services:",
        "  openclaw-01955000:",
        "    image: foo:latest",
      ].join("\n"),
    );
    expect(resolveOpenclawServiceName({ deployDir })).toBe("openclaw-01955000");
  });

  it("ignores non-openclaw services and picks the openclaw one", () => {
    writeFileSync(
      join(deployDir, "engine", "docker-compose.yml"),
      [
        "services:",
        "  ollama:",
        "    image: ollama/ollama:latest",
        "  openclaw-deadbeef:",
        "    image: foo:latest",
        "  cred-proxy:",
        "    image: bar:latest",
      ].join("\n"),
    );
    expect(resolveOpenclawServiceName({ deployDir })).toBe("openclaw-deadbeef");
  });

  it("falls back to deriving from instanceId when compose.yml is absent", () => {
    writeFileSync(
      join(deployDir, "clawhq.yaml"),
      "instanceId: 01955000-0000-4000-8000-000000000001\n",
    );
    expect(resolveOpenclawServiceName({ deployDir })).toBe(
      "openclaw-01955000",
    );
  });

  it("compose.yml beats clawhq.yaml when both are present", () => {
    writeFileSync(
      join(deployDir, "clawhq.yaml"),
      "instanceId: 01955000-0000-4000-8000-000000000001\n",
    );
    writeFileSync(
      join(deployDir, "engine", "docker-compose.yml"),
      ["services:", "  openclaw:", "    image: foo:latest"].join("\n"),
    );
    expect(resolveOpenclawServiceName({ deployDir })).toBe("openclaw");
  });

  it("malformed compose.yml falls through to instanceId derivation", () => {
    writeFileSync(
      join(deployDir, "clawhq.yaml"),
      "instanceId: 01955000-0000-4000-8000-000000000001\n",
    );
    writeFileSync(
      join(deployDir, "engine", "docker-compose.yml"),
      "this: is: not: { valid yaml",
    );
    expect(resolveOpenclawServiceName({ deployDir })).toBe(
      "openclaw-01955000",
    );
  });
});
