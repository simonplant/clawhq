/**
 * `clawhq smoke` — lightweight per-tool liveness check.
 *
 * Runs a safe read-only probe against every workspace tool in the
 * active profile's toolbelt via `docker exec`. Prints a compact
 * status table, emits JSON on `--json`, and (with `--notify`) pings
 * Telegram when tool state transitions against the last run.
 *
 * Designed for a 5-min system-cron cadence:
 *   *\/5 * * * * clawhq --agent clawdius smoke --notify >/dev/null 2>&1
 *
 * Zero LLM tokens per run. Sequential docker exec with a 5s timeout
 * per tool — ~30s total for the 21-tool life-ops profile.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import chalk from "chalk";
import type { Command } from "commander";
import { parse as parseYaml } from "yaml";

import { requireOpenclawContainer } from "../../build/docker/container.js";
import { loadProfile } from "../../design/catalog/loader.js";
import { readEnvValue } from "../../secure/credentials/env-store.js";
import {
  detectTransitions,
  formatTransitionsForTelegram,
  loadSmokeState,
  notifyTelegram,
  runSmoke,
  saveSmokeState,
  specsForProfile,
} from "../../operate/smoke/index.js";
import type { SmokeReport, SmokeState } from "../../operate/smoke/index.js";
import { CommandError } from "../errors.js";

export function registerSmokeCommand(program: Command, defaultDeployDir: string): void {
  program
    .command("smoke")
    .description("Run a lightweight liveness probe against every workspace tool")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Emit the report as JSON instead of a table")
    .option("--notify", "Post to Telegram when tool state transitions against the last run")
    .action(async (opts: { deployDir: string; json?: boolean; notify?: boolean }) => {
      const profileId = readProfileIdFromClawhqYaml(opts.deployDir);
      const profile = loadProfile(profileId);
      const specs = specsForProfile(profile);

      const container = await requireOpenclawContainer({ deployDir: opts.deployDir });
      const report = await runSmoke(container, specs);

      // Transition detection — always runs; notification is opt-in.
      const previous = loadSmokeState(opts.deployDir);
      const { transitions, streaks } = detectTransitions(report, previous);

      // Persist state for next run.
      const nextState: SmokeState = { lastReport: report, streaks };
      saveSmokeState(opts.deployDir, nextState);

      // Render.
      if (opts.json) {
        console.log(JSON.stringify({ report, transitions }, null, 2));
      } else {
        renderTable(report);
        if (transitions.length > 0) {
          console.log("");
          console.log(chalk.bold(`Transitions since last run (${transitions.length}):`));
          for (const t of transitions) {
            const tag =
              t.kind === "recovered" ? chalk.green("RECOVERED") :
              t.kind === "new-failure" ? chalk.red("NEW FAIL") :
              chalk.yellow("STILL FAILING");
            const streak = t.streakCount ? chalk.dim(` (${t.streakCount}×)`) : "";
            const reason = t.reason ? chalk.dim(` — ${t.reason.slice(0, 80)}`) : "";
            console.log(`  ${tag} ${chalk.bold(t.tool)}${streak}${reason}`);
          }
        }
      }

      // Notify.
      if (opts.notify && transitions.length > 0) {
        const message = formatTransitionsForTelegram(transitions, container);
        const botToken = readEnvValue(join(opts.deployDir, "engine", ".env"), "TELEGRAM_BOT_TOKEN");
        const chatId = readEnvValue(join(opts.deployDir, "engine", ".env"), "TELEGRAM_CHAT_ID");
        if (!botToken || !chatId) {
          if (!opts.json) {
            console.error(chalk.yellow("⚠ --notify set but TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing — skipping"));
          }
        } else {
          const outcome = await notifyTelegram(botToken, chatId, message);
          if (!outcome.sent && !opts.json) {
            console.error(chalk.yellow(`⚠ Telegram notify failed: ${outcome.error}`));
          }
        }
      }

      if (report.failCount > 0) {
        throw new CommandError("", 1);
      }
    });
}

/** Pull `composition.profile` out of the deployment's clawhq.yaml. */
function readProfileIdFromClawhqYaml(deployDir: string): string {
  const path = join(deployDir, "clawhq.yaml");
  const raw = readFileSync(path, "utf-8");
  const parsed = parseYaml(raw) as { composition?: { profile?: string } } | null;
  const profile = parsed?.composition?.profile;
  if (!profile) {
    throw new Error(
      `composition.profile not found in ${path}. Run \`clawhq init\` or add it manually.`,
    );
  }
  return profile;
}

// ── Table rendering ─────────────────────────────────────────────────────────

function renderTable(report: SmokeReport): void {
  console.log(chalk.bold(`\nTool smoke — ${report.container} @ ${report.timestamp}\n`));
  const width = Math.max(...report.results.map((r) => r.tool.length), 4);
  for (const r of report.results) {
    const status = r.ok ? chalk.green("✔ ok  ") : chalk.red("✘ fail");
    const dur = chalk.dim(`${r.durationMs.toString().padStart(4)}ms`);
    const reason = r.ok ? "" : chalk.dim(` ${r.stderr.slice(0, 60)}`);
    console.log(`  ${status}  ${r.tool.padEnd(width)}  ${dur}${reason}`);
  }
  const summary = report.failCount === 0
    ? chalk.green(`\n  All ${report.results.length} tools passing.`)
    : chalk.red(`\n  ${report.failCount} of ${report.results.length} tools failing.`);
  console.log(summary);
}
