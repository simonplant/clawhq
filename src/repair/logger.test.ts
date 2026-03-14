import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { logRepairAction, readRepairLog } from "./logger.js";
import type { RepairActionResult } from "./types.js";

describe("repair logger", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "repair-log-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes repair action to log file", async () => {
    const result: RepairActionResult = {
      issue: "gateway_down",
      status: "repaired",
      action: "Container restart",
      message: "Container restarted",
      durationMs: 1500,
    };

    await logRepairAction(tempDir, result);

    const content = await readFile(join(tempDir, "repair.log"), "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.issue).toBe("gateway_down");
    expect(entry.action).toBe("Container restart");
    expect(entry.status).toBe("repaired");
    expect(entry.timestamp).toBeDefined();
  });

  it("appends multiple entries", async () => {
    const result1: RepairActionResult = {
      issue: "gateway_down",
      status: "repaired",
      action: "Container restart",
      message: "Restarted",
      durationMs: 1000,
    };
    const result2: RepairActionResult = {
      issue: "firewall_missing",
      status: "repaired",
      action: "Firewall reapply",
      message: "Applied",
      durationMs: 200,
    };

    await logRepairAction(tempDir, result1);
    await logRepairAction(tempDir, result2);

    const entries = await readRepairLog(tempDir);
    expect(entries).toHaveLength(2);
    expect(entries[0].issue).toBe("gateway_down");
    expect(entries[1].issue).toBe("firewall_missing");
  });

  it("returns empty array for missing log file", async () => {
    const entries = await readRepairLog(tempDir);
    expect(entries).toEqual([]);
  });
});
