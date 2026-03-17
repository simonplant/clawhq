import { resolve } from "node:path";

import chalk from "chalk";
import { Command } from "commander";

import { destroy, dryRun } from "../destroy/destroy.js";
import type { DestroyStep } from "../destroy/types.js";
import { createExport } from "../export/export.js";

import { spinner, status } from "./ui.js";

export function createDecommissionCommands(program: Command): void {
  program
    .command("export")
    .description("Export portable agent bundle")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--output <path>", "Output directory for export bundle", ".")
    .option("--mask-pii", "Apply PII masking to all exported files")
    .option("--no-memory", "Export only identity and config (skip memory)")
    .action(async (opts: {
      home: string;
      output: string;
      maskPii?: boolean;
      memory?: boolean;
    }) => {
      const homePath = opts.home.replace(/^~/, process.env.HOME ?? "~");
      const outputDir = resolve(opts.output);

      // Commander parses --no-memory as memory: false
      const noMemory = opts.memory === false;

      const flags: string[] = [];
      if (opts.maskPii) flags.push("PII masking");
      if (noMemory) flags.push("identity + config only");
      const flagsNote = flags.length > 0 ? ` (${flags.join(", ")})` : "";
      const exportSpinner = spinner(`${chalk.magenta("Operate")} Creating export bundle${flagsNote}...`);
      exportSpinner.start();

      try {
        const result = await createExport({
          openclawHome: homePath,
          outputDir,
          maskPii: opts.maskPii,
          noMemory,
        });

        exportSpinner.succeed(`${chalk.magenta("Operate")} ${status.pass} Export created: ${result.exportId}`);
        console.log(`  Files: ${result.manifest.files.length}`);
        console.log(`  Archive: ${result.archivePath}`);

        if (opts.maskPii) {
          console.log("  PII masking: applied");
        }
        if (noMemory) {
          console.log("  Memory: excluded");
        }
      } catch (err: unknown) {
        exportSpinner.fail(`${chalk.magenta("Operate")} ${status.fail} Export failed`);
        console.error(
          err instanceof Error ? err.message : String(err),
        );
        process.exitCode = 1;
      }
    });
  program
    .command("destroy")
    .description("Verified agent destruction")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--compose <path>", "Path to docker-compose.yml")
    .option("--image-tag <tag>", "Agent image tag to remove")
    .option("--base-tag <tag>", "Base image tag to remove")
    .option("--bridge <iface>", "Docker bridge interface for firewall", "docker0")
    .option("--clawhq-dir <path>", "ClawHQ config directory", "~/.clawhq")
    .option("--keep-export", "Preserve export bundle")
    .option("--dry-run", "Show what will be destroyed without destroying")
    .option("--name <name>", "Deployment name (for confirmation)")
    .action(async (opts: {
      home: string;
      compose?: string;
      imageTag?: string;
      baseTag?: string;
      bridge: string;
      clawhqDir: string;
      keepExport?: boolean;
      dryRun?: boolean;
      name?: string;
    }) => {
      const homePath = opts.home.replace(/^~/, process.env.HOME ?? "~");
      const clawhqDir = opts.clawhqDir.replace(/^~/, process.env.HOME ?? "~");

      const destroyOpts = {
        openclawHome: homePath,
        composePath: opts.compose,
        imageTag: opts.imageTag,
        baseTag: opts.baseTag,
        bridgeInterface: opts.bridge,
        clawhqConfigDir: clawhqDir,
        keepExport: opts.keepExport,
        deploymentName: opts.name,
      };

      // Dry-run mode: show what will be destroyed
      if (opts.dryRun) {
        console.log("Destruction dry-run — the following will be destroyed:");
        console.log("");

        const preview = await dryRun(destroyOpts);

        for (const item of preview.items) {
          const prefix = item.autoDestroy ? "  [auto]  " : "  [manual]";
          console.log(`${prefix} ${item.label}`);
          console.log(`           ${item.location}`);
          if (item.manualAction) {
            console.log(`           Action: ${item.manualAction}`);
          }
        }

        console.log("");
        console.log(`Backup exists: ${preview.hasBackup ? "yes" : "NO"}`);
        console.log(`Export exists: ${preview.hasExport ? "yes" : "NO"}`);

        if (!preview.hasBackup && !preview.hasExport) {
          console.log("");
          console.log("WARNING: No backup or export found.");
          console.log("Consider running `clawhq backup create` or `clawhq export` first.");
        }

        console.log("");
        console.log(`To destroy, run: clawhq destroy --name "${preview.deploymentName}"`);
        return;
      }

      // Confirmation: deployment name must be provided
      if (!opts.name) {
        // Show dry-run first so user knows what will be destroyed
        const preview = await dryRun(destroyOpts);

        if (!preview.hasBackup && !preview.hasExport) {
          console.error("No backup or export found. Create one first:");
          console.error("  clawhq backup create");
          console.error("  clawhq export");
          process.exitCode = 1;
          return;
        }

        console.error("Deployment name required for confirmation.");
        console.error(`Run: clawhq destroy --name "${preview.deploymentName}"`);
        console.error("Use --dry-run to preview what will be destroyed.");
        process.exitCode = 1;
        return;
      }

      // Execute destruction
      const destroySpinner = spinner(`${chalk.magenta("Operate")} Destroying deployment "${opts.name}"...`);
      destroySpinner.start();

      try {
        const result = await destroy(destroyOpts);

        if (result.success) {
          destroySpinner.succeed(`${chalk.magenta("Operate")} ${status.pass} Destruction complete`);
        } else {
          destroySpinner.fail(`${chalk.magenta("Operate")} ${status.fail} Destruction failed`);
        }

        const total = result.steps.length;
        for (let i = 0; i < total; i++) {
          const step = result.steps[i] as DestroyStep;
          const icon = step.status === "done" ? "OK" : step.status === "skipped" ? "SKIP" : "FAIL";
          const duration = step.durationMs >= 1000
            ? `${(step.durationMs / 1000).toFixed(1)}s`
            : `${step.durationMs}ms`;
          console.log(`[${i + 1}/${total}] ${icon}  ${step.name} (${duration}): ${step.message}`);
        }

        console.log("");
        if (result.success) {
          const totalMs = result.steps.reduce((sum, s) => sum + s.durationMs, 0);
          const duration = totalMs >= 1000
            ? `${(totalMs / 1000).toFixed(1)}s`
            : `${totalMs}ms`;
          console.log(`Destruction completed successfully (${duration})`);
          if (result.manifest) {
            console.log(`Manifest: ${result.manifest.manifestId}`);
            console.log(`Verification hash: ${result.manifest.verification.hash}`);
          }
        } else {
          const failures = result.steps.filter((s) => s.status === "failed");
          console.log(`Destruction failed (${failures.length} error${failures.length > 1 ? "s" : ""})`);
          for (const f of failures) {
            console.log(`  ${f.name}: ${f.message}`);
          }
          process.exitCode = 1;
        }
      } catch (err: unknown) {
        destroySpinner.fail(`${chalk.magenta("Operate")} ${status.fail} Destruction failed`);
        console.error(
          err instanceof Error ? err.message : String(err),
        );
        process.exitCode = 1;
      }
    });
}
