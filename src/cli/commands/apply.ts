/**
 * `clawhq apply` CLI command — idempotent config regeneration.
 *
 * Reads clawhq.yaml, re-derives all config files, preserves credentials
 * and stateful data. Safe to run any time.
 */

import chalk from "chalk";
import type { Command } from "commander";
import ora from "ora";

import { readCurrentPosture, getPostureConfig, DEFAULT_POSTURE } from "../../build/docker/index.js";
import { GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";
import { apply } from "../../evolve/apply/index.js";
import type { ApplyProgress } from "../../evolve/apply/index.js";
import { CommandError } from "../errors.js";
import { ensureInstalled } from "../ux.js";

export function registerApplyCommand(program: Command, defaultDeployDir: string): void {
  program
    .command("apply")
    .description("Regenerate config from clawhq.yaml — idempotent, preserves credentials and state")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--restart", "Restart the agent after applying")
    .option("--dry-run", "Show what would change without writing")
    .action(async (opts: {
      deployDir: string;
      restart?: boolean;
      dryRun?: boolean;
    }) => {
      ensureInstalled(opts.deployDir);

      const spinner = ora();

      const onProgress = (event: ApplyProgress): void => {
        const label = chalk.dim(`[${event.step}]`);
        switch (event.status) {
          case "running":
            spinner.start(`${label} ${event.message}`);
            break;
          case "done":
            spinner.succeed(`${label} ${event.message}`);
            break;
          case "failed":
            spinner.fail(`${label} ${event.message}`);
            break;
        }
      };

      try {
        if (opts.dryRun) {
          console.log(chalk.dim("\n  Dry run — no files will be written\n"));
        }

        const result = await apply({
          deployDir: opts.deployDir,
          dryRun: opts.dryRun,
          onProgress,
        });

        spinner.stop();

        if (!result.success) {
          console.error(chalk.red(`\n  ✘ Apply failed: ${result.error}\n`));
          throw new CommandError("", 1);
        }

        // Report
        const { report } = result;
        console.log("");

        if (report.added.length > 0) {
          console.log(chalk.green(`  ${report.added.length} file(s) added`));
          for (const f of report.added) {
            console.log(chalk.dim(`    + ${f}`));
          }
        }

        if (report.changed.length > 0) {
          console.log(chalk.yellow(`  ${report.changed.length} file(s) changed`));
          for (const f of report.changed) {
            console.log(chalk.dim(`    ~ ${f}`));
          }
        }

        if (report.unchanged.length > 0) {
          console.log(chalk.dim(`  ${report.unchanged.length} file(s) unchanged`));
        }

        if (report.skipped.length > 0) {
          console.log(chalk.dim(`  ${report.skipped.length} file(s) skipped (stateful)`));
        }

        if (opts.dryRun) {
          console.log(chalk.dim("\n  Dry run complete — no files were written"));
        } else if (report.added.length + report.changed.length === 0) {
          console.log(chalk.green("\n  ✔ Already up to date"));
        } else {
          console.log(chalk.green("\n  ✔ Config applied"));
        }

        // Restart if requested
        if (opts.restart && !opts.dryRun) {
          console.log("");
          const restartSpinner = ora("Restarting agent…").start();
          try {
            const { join } = await import("node:path");
            const { readEnvValue } = await import("../../secure/credentials/env-store.js");
            const gatewayToken = readEnvValue(join(opts.deployDir, "engine", ".env"), "OPENCLAW_GATEWAY_TOKEN") ?? "";
            const { restart } = await import("../../build/launcher/index.js");

            const currentPosture = readCurrentPosture(opts.deployDir) ?? DEFAULT_POSTURE;
            const postureConfig = getPostureConfig(currentPosture);

            // Only pass runtime if runsc is actually available on this host
            let runtime = postureConfig.runtime;
            if (runtime === "runsc") {
              try {
                const { execFile: ef } = await import("node:child_process");
                const { promisify: p } = await import("node:util");
                await p(ef)("runsc", ["--version"], { timeout: 5000 });
              } catch {
                runtime = undefined;
              }
            }

            const restartResult = await restart({
              deployDir: opts.deployDir,
              gatewayToken,
              gatewayPort: GATEWAY_DEFAULT_PORT,
              runtime,
              autoFirewall: postureConfig.autoFirewall,
              immutableIdentity: postureConfig.immutableIdentity,
            });
            if (restartResult.success) {
              restartSpinner.succeed("Agent restarted");
            } else {
              restartSpinner.fail(`Restart failed: ${restartResult.error}`);
            }
          } catch (err) {
            restartSpinner.fail(`Restart failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } catch (error) {
        spinner.stop();
        if (error instanceof CommandError) throw error;
        console.error(chalk.red(`\n  ✘ ${error instanceof Error ? error.message : String(error)}\n`));
        throw new CommandError("", 1);
      }
    });
}
