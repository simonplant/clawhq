#!/usr/bin/env node
/**
 * Shadow-mode scenario runner — regression-check the alert pipeline
 * against canonical fixtures without touching Tradier, Telegram, or the DB.
 *
 * Usage:
 *   npx tsx src/trading/shadow-cli.ts [scenarios-dir]
 *
 * Default dir: src/trading/scenarios. Exits 0 if every scenario matches
 * its expected trace, 1 otherwise. Designed for pre-commit and CI — the
 * bar for shipping changes to risk.ts, detector.ts, pipeline.ts is a
 * clean shadow run.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  diffTrace,
  materializeScenario,
  replayScenario,
  summarizeTrace,
  type ScenarioFile,
} from "./shadow.js";

interface ScenarioRun {
  file: string;
  name: string;
  ok: boolean;
  problems: string[];
  trace: string;
}

function discoverScenarios(dir: string): string[] {
  const stat = statSync(dir);
  if (!stat.isDirectory()) return [dir];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(dir, f));
}

function runOne(path: string): ScenarioRun {
  const raw = readFileSync(path, "utf-8");
  let file: ScenarioFile;
  try {
    file = JSON.parse(raw) as ScenarioFile;
  } catch (err) {
    return {
      file: path,
      name: "<parse-failed>",
      ok: false,
      problems: [`parse: ${err instanceof Error ? err.message : String(err)}`],
      trace: "",
    };
  }
  const { scenario, expected } = materializeScenario(file);
  const result = replayScenario(scenario);
  const { ok, problems } = diffTrace(result, expected);
  return {
    file: path,
    name: file.name,
    ok,
    problems,
    trace: summarizeTrace(result),
  };
}

function main(): number {
  const dir = resolve(process.argv[2] ?? "src/trading/scenarios");
  let paths: string[];
  try {
    paths = discoverScenarios(dir);
  } catch (err) {
    process.stderr.write(
      `error: cannot read ${dir}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  if (paths.length === 0) {
    process.stderr.write(`no scenarios found under ${dir}\n`);
    return 1;
  }

  let failures = 0;
  for (const p of paths) {
    const run = runOne(p);
    const status = run.ok ? "✓" : "✗";
    process.stdout.write(`${status} ${run.name}  (${p})\n`);
    if (!run.ok) {
      failures++;
      for (const problem of run.problems) {
        process.stdout.write(`    ${problem}\n`);
      }
      process.stdout.write("    trace:\n");
      for (const line of run.trace.split("\n")) {
        process.stdout.write(`    ${line}\n`);
      }
    }
  }

  const total = paths.length;
  process.stdout.write(
    `\n${total - failures}/${total} scenarios passed${failures ? ` — ${failures} failed` : ""}\n`,
  );
  return failures === 0 ? 0 : 1;
}

process.exit(main());
