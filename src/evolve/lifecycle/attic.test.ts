import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { archiveDeployment, deploymentExists } from "./attic.js";

let sandbox: string;
let deployDir: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "clawhq-attic-test-"));
  deployDir = join(sandbox, ".clawhq");
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("deploymentExists", () => {
  it("returns false when deployDir is missing", () => {
    expect(deploymentExists(deployDir)).toBe(false);
  });

  it("returns false when deployDir exists but clawhq.yaml is missing", () => {
    mkdirSync(deployDir);
    expect(deploymentExists(deployDir)).toBe(false);
  });

  it("returns true when clawhq.yaml is present", () => {
    mkdirSync(deployDir);
    writeFileSync(join(deployDir, "clawhq.yaml"), "version: 0.2.0\n");
    expect(deploymentExists(deployDir)).toBe(true);
  });
});

describe("archiveDeployment", () => {
  it("returns empty archivePath when nothing to archive", () => {
    const result = archiveDeployment(deployDir);
    expect(result.archivePath).toBe("");
  });

  it("moves deployment to a timestamped sibling and preserves content", () => {
    mkdirSync(deployDir, { recursive: true });
    writeFileSync(join(deployDir, "clawhq.yaml"), "version: 0.2.0\n");
    writeFileSync(join(deployDir, "marker.txt"), "hi");

    const result = archiveDeployment(deployDir);

    expect(existsSync(deployDir)).toBe(false);
    expect(existsSync(result.archivePath)).toBe(true);
    expect(result.archivePath).toMatch(/\.attic\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
    expect(readFileSync(join(result.archivePath, "clawhq.yaml"), "utf-8")).toBe("version: 0.2.0\n");
    expect(readFileSync(join(result.archivePath, "marker.txt"), "utf-8")).toBe("hi");
  });

  it("archive path is a sibling of deployDir, preserving basename", () => {
    mkdirSync(deployDir, { recursive: true });
    writeFileSync(join(deployDir, "clawhq.yaml"), "");
    const result = archiveDeployment(deployDir);
    expect(result.archivePath.startsWith(sandbox + "/")).toBe(true);
    expect(result.archivePath.includes(".clawhq.attic.")).toBe(true);
  });
});
