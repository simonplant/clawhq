import type { Command } from "commander";

import chalk from "chalk";
import ora from "ora";

import { detectLegacyInstallation, install, migrateDeployDir } from "../../build/installer/index.js";

import { CommandError } from "../errors.js";
import { renderError } from "../ux.js";
import { formatPrereqCheck } from "./helpers.js";

export function registerInstallCommands(program: Command, defaultDeployDir: string): void {
  program
    .command("install")
    .description("Full platform install — prerequisites, engine, scaffold")
    .option("--from-source", "Zero-trust: clone, audit, build from source")
    .option("--repo <url>", "OpenClaw repository URL (for --from-source)")
    .option("--ref <ref>", "Git ref to check out (for --from-source)")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (opts: { fromSource?: boolean; repo?: string; ref?: string; deployDir: string }) => {
      try {
        const isFromSource = opts.fromSource ?? false;
        console.log(chalk.bold(`\nclawhq install${isFromSource ? " --from-source" : ""}\n`));

        // Step 1: Check prerequisites
        const spinner = ora("Checking prerequisites…");
        spinner.start();

        const result = await install({
          deployDir: opts.deployDir,
          fromSource: isFromSource,
          repoUrl: opts.repo,
          ref: opts.ref,
          onProgress: (phase, detail) => {
            spinner.text = detail;
          },
        });

        spinner.stop();

        // Display prereq results
        console.log(chalk.bold("Prerequisites"));
        for (const check of result.prereqs.checks) {
          formatPrereqCheck(check);
        }
        console.log("");

        if (!result.prereqs.passed) {
          console.log(chalk.red("✘ Prerequisites not met. Fix the issues above and run again."));
          throw new CommandError("", 1);
        }

        // Step 2–3: Scaffold + config (already done by install())
        console.log(chalk.green(`✔ Directory scaffolded at ${opts.deployDir}`));
        console.log(chalk.green(`✔ Config written to ${result.configPath}`));

        // Engine clone result (always shown — engine is always cloned)
        if (result.sourceBuild?.success && !isFromSource) {
          console.log(chalk.green(`✔ Engine source cloned to ${result.sourceBuild.sourceDir}`));
        }

        // From-source specific output
        if (isFromSource && result.sourceBuild) {
          if (result.sourceBuild.success) {
            console.log(chalk.green(`✔ Engine built from source at ${result.sourceBuild.sourceDir}`));
            if (result.sourceBuild.imageDigest) {
              console.log(chalk.dim(`  Image digest: ${result.sourceBuild.imageDigest}`));
            }
          } else {
            console.log(chalk.red(`✘ From-source build failed: ${result.sourceBuild.error}`));
            throw new CommandError("", 1);
          }

          // Verification result
          if (result.verify) {
            if (result.verify.match) {
              console.log(chalk.green(`✔ ${result.verify.detail}`));
            } else if (result.verify.releaseDigest) {
              console.log(chalk.yellow(`⚠ ${result.verify.detail}`));
            } else {
              console.log(chalk.dim(`  ${result.verify.detail}`));
            }
          }
        }

        if (!result.success) {
          console.log(chalk.red(`\n✘ Install failed: ${result.error}`));
          throw new CommandError("", 1);
        }

        // Next-step guidance
        console.log(chalk.bold("\nWhat's next?\n"));
        console.log(`  1. ${chalk.bold("clawhq init --guided")}    Choose a blueprint and configure your agent`);
        console.log(`  2. ${chalk.bold("clawhq build")}             Build the Docker image`);
        console.log(`  3. ${chalk.bold("clawhq up")}                Deploy and start your agent`);
        console.log("");
        console.log(chalk.dim(`  Deployment directory: ${opts.deployDir}`));
        console.log(chalk.dim(`  Install method: ${isFromSource ? "from-source (zero-trust)" : "cache (default)"}`));
        if (isFromSource && result.sourceBuild?.sourceDir) {
          console.log(chalk.dim(`  Source directory: ${result.sourceBuild.sourceDir}`));
          console.log(chalk.dim("  You can audit the source code before proceeding."));
        }
        console.log("");
      } catch (error) {
        if (error instanceof CommandError) throw error;
        console.error(renderError(error));
        throw new CommandError("", 1);
      }
    });

  program
    .command("migrate")
    .description("Migrate legacy ~/.openclaw/ installation to ~/.clawhq/")
    .option("-d, --deploy-dir <path>", "Target deployment directory", defaultDeployDir)
    .option("--source <path>", "Legacy source directory to migrate from")
    .option("--remove-source", "Remove the legacy directory after successful migration")
    .action(async (opts: { deployDir: string; source?: string; removeSource?: boolean }) => {
      try {
        console.log(chalk.bold("\nclawhq migrate\n"));

        // Check for legacy installation
        const legacy = detectLegacyInstallation(opts.source);
        if (!legacy) {
          const searchDir = opts.source ?? "~/.openclaw";
          console.log(chalk.green(`✔ No legacy installation found at ${searchDir} — nothing to migrate.`));
          console.log("");
          return;
        }

        console.log(chalk.yellow(`Found legacy installation at ${legacy}`));
        console.log(`Target: ${opts.deployDir}\n`);

        const spinner = ora("Migrating deployment directory…");
        spinner.start();

        const result = migrateDeployDir({
          sourceDir: opts.source,
          targetDir: opts.deployDir,
          removeSource: opts.removeSource ?? false,
          onProgress: (_step, detail) => {
            spinner.text = detail;
          },
        });

        spinner.stop();

        if (!result.success) {
          console.log(chalk.red(`✘ Migration failed: ${result.error}`));
          throw new CommandError("", 1);
        }

        console.log(chalk.green(`✔ Migrated ${result.itemsMigrated} items to ${result.targetDir}`));
        if (result.targetExisted) {
          console.log(chalk.dim("  Merged into existing deployment directory"));
        }
        if (result.sourceRemoved) {
          console.log(chalk.dim(`  Removed legacy directory: ${result.sourceDir}`));
        } else if (result.sourceDir !== result.targetDir) {
          console.log(chalk.dim(`  Legacy directory preserved at: ${result.sourceDir}`));
          console.log(chalk.dim("  Use --remove-source to delete it after verifying the migration"));
        }

        console.log(chalk.bold("\nWhat's next?\n"));
        console.log(`  ${chalk.bold("clawhq doctor")}    Verify the migrated installation`);
        console.log("");
      } catch (error) {
        if (error instanceof CommandError) throw error;
        console.error(renderError(error));
        throw new CommandError("", 1);
      }
    });
}
