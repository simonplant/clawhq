import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isComplete,
  ledgerPath,
  listInProgress,
  loadLedger,
  markComplete,
  markFailed,
  markInProgress,
} from "./ledger.js";

let deployDir: string;

beforeEach(() => {
  deployDir = mkdtempSync(join(tmpdir(), "clawhq-ledger-test-"));
});

afterEach(() => {
  rmSync(deployDir, { recursive: true, force: true });
});

describe("loadLedger", () => {
  it("returns empty ledger when file doesn't exist", async () => {
    const ledger = await loadLedger(deployDir);
    expect(ledger.version).toBe(1);
    expect(ledger.applied).toEqual({});
  });

  it("throws on corrupt JSON — never silently returns empty", async () => {
    const path = ledgerPath(deployDir);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "not-json{{{", "utf-8");
    await expect(loadLedger(deployDir)).rejects.toThrow(/corrupt/);
  });

  it("throws on unsupported version", async () => {
    const path = ledgerPath(deployDir);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: 99, applied: {} }), "utf-8");
    await expect(loadLedger(deployDir)).rejects.toThrow(/unsupported version/);
  });
});

describe("markInProgress + markComplete", () => {
  it("records status transitions for a migration", async () => {
    let ledger = await markInProgress(deployDir, "m1", "v1", "v2");
    expect(ledger.applied["m1"]?.status).toBe("in_progress");
    expect(ledger.applied["m1"]?.fromVersion).toBe("v1");
    expect(ledger.applied["m1"]?.toVersion).toBe("v2");

    ledger = await markComplete(deployDir, "m1");
    expect(ledger.applied["m1"]?.status).toBe("complete");
  });

  it("persists across reloads", async () => {
    await markInProgress(deployDir, "m1", "v1", "v2");
    await markComplete(deployDir, "m1");

    const reloaded = await loadLedger(deployDir);
    expect(reloaded.applied["m1"]?.status).toBe("complete");
  });

  it("isComplete returns true only after markComplete", async () => {
    await markInProgress(deployDir, "m1", "v1", "v2");
    const midLedger = await loadLedger(deployDir);
    expect(isComplete(midLedger, "m1")).toBe(false);

    await markComplete(deployDir, "m1");
    const finalLedger = await loadLedger(deployDir);
    expect(isComplete(finalLedger, "m1")).toBe(true);
  });

  it("unknown migration id is never complete", async () => {
    await markComplete(deployDir, "m1");
    const ledger = await loadLedger(deployDir);
    expect(isComplete(ledger, "never-seen-this-one")).toBe(false);
  });
});

describe("markFailed", () => {
  it("keeps status at in_progress and records error text", async () => {
    await markInProgress(deployDir, "m1", "v1", "v2");
    const ledger = await markFailed(deployDir, "m1", "boom");
    expect(ledger.applied["m1"]?.status).toBe("in_progress");
    expect(ledger.applied["m1"]?.error).toBe("boom");
  });
});

describe("listInProgress", () => {
  it("returns only the ids whose status is in_progress", async () => {
    await markInProgress(deployDir, "m1", "v1", "v2");
    await markInProgress(deployDir, "m2", "v2", "v3");
    await markComplete(deployDir, "m1");

    const ledger = await loadLedger(deployDir);
    expect(listInProgress(ledger).sort()).toEqual(["m2"]);
  });
});
