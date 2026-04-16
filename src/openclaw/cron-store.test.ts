import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InvalidCronStoreError, loadCronStore, renderCronJobsFile, saveCronStore } from "./cron-store.js";

let testDir: string;
let storePath: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "clawhq-cronstore-test-"));
  storePath = join(testDir, "jobs.json");
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("loadCronStore", () => {
  it("returns empty envelope when file is missing (first-deploy semantics)", () => {
    const store = loadCronStore(storePath);
    expect(store).toEqual({ version: 1, jobs: [] });
  });

  it("loads a valid envelope", () => {
    writeFileSync(storePath, JSON.stringify({ version: 1, jobs: [{ id: "a" }, { id: "b" }] }));
    const store = loadCronStore(storePath);
    expect(store.version).toBe(1);
    expect(store.jobs).toHaveLength(2);
    expect((store.jobs[0] as { id: string }).id).toBe("a");
  });

  it("throws on bare JSON array (the Clawdius regression)", () => {
    writeFileSync(storePath, "[]");
    expect(() => loadCronStore(storePath)).toThrow(InvalidCronStoreError);
    expect(() => loadCronStore(storePath)).toThrow(/bare JSON array/i);
  });

  it("throws on missing jobs field", () => {
    writeFileSync(storePath, JSON.stringify({ version: 1 }));
    expect(() => loadCronStore(storePath)).toThrow(/jobs/i);
  });

  it("throws on non-array jobs field", () => {
    writeFileSync(storePath, JSON.stringify({ version: 1, jobs: "not an array" }));
    expect(() => loadCronStore(storePath)).toThrow(/non-array/i);
  });

  it("throws on null root", () => {
    writeFileSync(storePath, "null");
    expect(() => loadCronStore(storePath)).toThrow(/null/i);
  });

  it("throws on string root", () => {
    writeFileSync(storePath, '"a string"');
    expect(() => loadCronStore(storePath)).toThrow(/string/i);
  });

  it("throws on malformed JSON", () => {
    writeFileSync(storePath, "{ not json");
    expect(() => loadCronStore(storePath)).toThrow(/invalid JSON/i);
  });

  it("error message points users at clawhq apply", () => {
    writeFileSync(storePath, "[]");
    expect(() => loadCronStore(storePath)).toThrow(/clawhq apply/);
  });
});

describe("saveCronStore", () => {
  it("writes the canonical envelope", () => {
    saveCronStore(storePath, { version: 1, jobs: [{ id: "x" }] });
    const content = readFileSync(storePath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed).toEqual({ version: 1, jobs: [{ id: "x" }] });
    // Trailing newline
    expect(content.endsWith("\n")).toBe(true);
  });

  it("round-trips through load", () => {
    const original: { version: 1; jobs: Record<string, unknown>[] } = {
      version: 1,
      jobs: [
        { id: "heartbeat", enabled: true, state: {} },
        { id: "work-session", enabled: false, state: { lastRunAtMs: 123 } },
      ],
    };
    saveCronStore(storePath, original);
    const loaded = loadCronStore(storePath);
    expect(loaded).toEqual(original);
  });

  it("always emits envelope even for empty job list", () => {
    saveCronStore(storePath, { version: 1, jobs: [] });
    const content = readFileSync(storePath, "utf-8").trim();
    expect(content).not.toBe("[]");
    expect(JSON.parse(content)).toEqual({ version: 1, jobs: [] });
  });
});

describe("renderCronJobsFile", () => {
  it("wraps in envelope and adds state: {} to every job", () => {
    const content = renderCronJobsFile([
      { id: "a", name: "a", enabled: true, schedule: { kind: "cron", expr: "0 * * * *" }, delivery: { mode: "none" }, payload: { kind: "agentTurn", message: "x" }, sessionTarget: "isolated" },
    ]);
    const parsed = JSON.parse(content);
    expect(parsed.version).toBe(1);
    expect(parsed.jobs).toHaveLength(1);
    expect(parsed.jobs[0].state).toEqual({});
  });

  it("never emits a bare array, even for empty input", () => {
    const content = renderCronJobsFile([]);
    expect(content.trim().startsWith("{")).toBe(true);
  });

  it("strips ClawHQ-only fields (fallbacks, activeHours)", () => {
    const content = renderCronJobsFile([
      {
        id: "a", name: "a", enabled: true,
        schedule: { kind: "cron", expr: "0 * * * *" },
        delivery: { mode: "none" },
        payload: { kind: "agentTurn", message: "x" },
        sessionTarget: "isolated",
        fallbacks: ["sonnet"],
        activeHours: { start: 6, end: 23 },
      },
    ]);
    expect(content).not.toContain("fallbacks");
    expect(content).not.toContain("activeHours");
  });

  it("preserves existing state if already set on input", () => {
    const existing = { lastRunAtMs: 42 };
    const content = renderCronJobsFile([
      {
        id: "a", name: "a", enabled: true,
        schedule: { kind: "cron", expr: "0 * * * *" },
        delivery: { mode: "none" },
        payload: { kind: "agentTurn", message: "x" },
        sessionTarget: "isolated",
        state: existing,
      },
    ]);
    const parsed = JSON.parse(content);
    expect(parsed.jobs[0].state).toEqual(existing);
  });
});
