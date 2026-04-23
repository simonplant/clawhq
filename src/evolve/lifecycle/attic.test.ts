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
    // Format: YYYY-MM-DDTHH-MM-SS-mmm (ms suffix for sub-second resolution)
    expect(result.archivePath).toMatch(/\.attic\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}(-\d+)?$/);
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

  it("two archives in rapid succession produce distinct paths (collision-safe)", () => {
    // First deployment → archive
    mkdirSync(deployDir, { recursive: true });
    writeFileSync(join(deployDir, "clawhq.yaml"), "v1");
    const a = archiveDeployment(deployDir);

    // Create a second deployment at the same path and archive again — this
    // must land at a distinct path even if the ms hasn't ticked.
    mkdirSync(deployDir, { recursive: true });
    writeFileSync(join(deployDir, "clawhq.yaml"), "v2");
    const b = archiveDeployment(deployDir);

    expect(a.archivePath).not.toBe(b.archivePath);
    expect(existsSync(a.archivePath)).toBe(true);
    expect(existsSync(b.archivePath)).toBe(true);
    expect(readFileSync(join(a.archivePath, "clawhq.yaml"), "utf-8")).toBe("v1");
    expect(readFileSync(join(b.archivePath, "clawhq.yaml"), "utf-8")).toBe("v2");
  });

  it("archive includes dotfiles (.env and similar)", () => {
    // #27 claimed dotfiles are lost — they are not, because renameSync
    // moves the inode not its contents. Pin this as a regression test.
    mkdirSync(deployDir, { recursive: true });
    writeFileSync(join(deployDir, "clawhq.yaml"), "");
    writeFileSync(join(deployDir, ".env"), "SECRET=x");
    writeFileSync(join(deployDir, ".clawhq-secrets"), "y");

    const result = archiveDeployment(deployDir);

    expect(readFileSync(join(result.archivePath, ".env"), "utf-8")).toBe("SECRET=x");
    expect(readFileSync(join(result.archivePath, ".clawhq-secrets"), "utf-8")).toBe("y");
  });
});
