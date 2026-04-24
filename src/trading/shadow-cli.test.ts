import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  diffTrace,
  materializeScenario,
  replayScenario,
  type ScenarioFile,
} from "./shadow.js";

describe("JSON scenario fixtures under src/trading/scenarios/", () => {
  it("every fixture replays clean", () => {
    const dir = "src/trading/scenarios";
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    expect(files.length).toBeGreaterThan(0);

    for (const f of files) {
      const raw = readFileSync(join(dir, f), "utf-8");
      const file = JSON.parse(raw) as ScenarioFile;
      const { scenario, expected } = materializeScenario(file);
      const result = replayScenario(scenario);
      const diff = diffTrace(result, expected);
      expect(diff.problems, `fixture ${f}`).toEqual([]);
    }
  });
});

describe("materializeScenario", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "shadow-cli-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("converts on-disk string matchers into real RegExps", () => {
    const file: ScenarioFile = {
      name: "test",
      brief: "## Orders\n(no orders today)\n",
      ticks: [],
      expected: [{ kind: "blocked", blockMatches: "daily loss" }],
    };
    const { expected } = materializeScenario(file);
    expect(expected[0]?.blockMatches).toBeInstanceOf(RegExp);
    expect(expected[0]?.blockMatches?.test("daily loss limit")).toBe(true);
  });

  it("produces a scenario that replayScenario can consume", () => {
    const path = join(tmp, "s.json");
    writeFileSync(
      path,
      JSON.stringify({
        name: "empty",
        brief: "no orders",
        ticks: [],
        expected: [],
      }),
      "utf-8",
    );
    const file = JSON.parse(readFileSync(path, "utf-8")) as ScenarioFile;
    const { scenario, expected } = materializeScenario(file);
    const result = replayScenario(scenario);
    const diff = diffTrace(result, expected);
    expect(diff.ok).toBe(true);
  });
});
