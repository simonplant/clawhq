import { Command } from "commander";

import { createReadlineIO } from "../init/index.js";
import {
  activateSkill,
  applySkillUpdate,
  formatSkillList,
  formatSkillSummary,
  formatVetResult,
  loadRegistry,
  removeSkillOp,
  resolveSource,
  stageSkillInstall,
  stageSkillUpdate,
} from "../skill/index.js";
import type { SkillContext } from "../skill/index.js";
import { SkillError } from "../skill/types.js";
import {
  formatVettingResult,
  runVettingPipeline,
} from "../security/vetting.js";
import { recordChange } from "../workspace/evolve-history.js";

function makeSkillCtx(opts: { home: string; clawhqDir: string }): SkillContext {
  return {
    openclawHome: opts.home.replace(/^~/, process.env.HOME ?? "~"),
    clawhqDir: opts.clawhqDir.replace(/^~/, process.env.HOME ?? "~"),
  };
}

export function createSkillCommand(): Command {
  const skillCmd = new Command("skill")
    .description("Manage agent skills — install, list, update, remove")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--clawhq-dir <path>", "ClawHQ data directory", "~/.clawhq");

  skillCmd
    .command("list", { isDefault: true })
    .description("List installed skills with version, source, status, and last-used timestamp")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const parentOpts = skillCmd.opts() as { home: string; clawhqDir: string };
      const ctx = makeSkillCtx(parentOpts);
      const registry = await loadRegistry(ctx);

      if (opts.json) {
        console.log(JSON.stringify(registry.skills, null, 2));
      } else {
        console.log(formatSkillList(registry.skills));
      }
    });

  skillCmd
    .command("install <source>")
    .description("Install a skill from a local path, URL, or registry name")
    .option("--force", "Skip approval prompt")
    .action(async (source: string, opts: { force?: boolean }) => {
      const parentOpts = skillCmd.opts() as { home: string; clawhqDir: string };
      const ctx = makeSkillCtx(parentOpts);

      try {
        // Stage: fetch + vet
        console.log(`Fetching skill from ${source}...`);
        const { manifest, vetResult, stagingDir } = await stageSkillInstall(ctx, source);

        // Show summary and basic vet results
        console.log("");
        console.log(formatSkillSummary(
          manifest.name,
          manifest.version,
          manifest.description,
          manifest.files,
          manifest.requiresContainerDeps,
        ));
        console.log(formatVetResult(vetResult));

        // Run supply chain vetting pipeline
        const resolved = resolveSource(source);
        const vtApiKey = process.env.VIRUSTOTAL_API_KEY;
        const vettingResult = await runVettingPipeline(
          stagingDir,
          manifest.files,
          resolved.source,
          resolved.uri,
          { virusTotalApiKey: vtApiKey },
        );
        console.log("");
        console.log(formatVettingResult(vettingResult));
        console.log("");

        // Block on vetting failure (basic vet OR supply chain scan)
        if (!vetResult.passed || !vettingResult.passed) {
          console.error("Skill failed security vetting. Installation blocked.");
          const { rm: rmDir } = await import("node:fs/promises");
          await rmDir(stagingDir, { recursive: true, force: true });
          process.exitCode = 1;
          return;
        }

        // Approval gate
        if (!opts.force) {
          const { io, close } = createReadlineIO();
          try {
            const answer = await io.prompt("Install this skill? (yes/no): ");

            if (answer.toLowerCase() !== "yes" && answer.toLowerCase() !== "y") {
              console.log("Installation cancelled.");
              const { rm: rmDir } = await import("node:fs/promises");
              await rmDir(stagingDir, { recursive: true, force: true });
              return;
            }
          } finally {
            close();
          }
        }

        // Activate
        const result = await activateSkill(ctx, manifest, stagingDir, resolved.source, resolved.uri);

        // Record evolve change with vetting info
        await recordChange(ctx, {
          changeType: "skill_install",
          target: result.skill.name,
          previousState: "not installed",
          newState: `${result.skill.name}@${result.skill.version}`,
          rollbackSnapshotId: null,
          requiresRebuild: result.requiresRebuild,
          sourceUri: resolved.uri,
          vettingSummary: vettingResult.summary,
        });

        console.log(`Skill "${result.skill.name}" installed and activated.`);
        if (result.requiresRebuild) {
          console.log("");
          console.log("This skill requires container-level dependencies.");
          console.log("Run `clawhq build --stage2-only` to rebuild the agent image.");
        }
      } catch (err: unknown) {
        if (err instanceof SkillError) {
          console.error(`Error: ${err.message}`);
        } else {
          console.error(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exitCode = 1;
      }
    });

  skillCmd
    .command("remove <name>")
    .description("Remove an installed skill (rollback snapshot kept for 30 days)")
    .action(async (name: string) => {
      const parentOpts = skillCmd.opts() as { home: string; clawhqDir: string };
      const ctx = makeSkillCtx(parentOpts);

      try {
        const result = await removeSkillOp(ctx, name);

        // Record evolve change
        await recordChange(ctx, {
          changeType: "skill_remove",
          target: name,
          previousState: `${result.skill.name}@${result.skill.version}`,
          newState: "removed",
          rollbackSnapshotId: result.snapshotId,
          requiresRebuild: result.skill.requiresContainerDeps,
        });

        console.log(`Skill "${name}" removed.`);
        console.log(`  Rollback snapshot: ${result.snapshotId}`);
        console.log("  Snapshot expires in 30 days.");
        console.log("");
        console.log("TOOLS.md updated.");
      } catch (err: unknown) {
        if (err instanceof SkillError) {
          console.error(`Error: ${err.message}`);
        } else {
          console.error(`Remove failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exitCode = 1;
      }
    });

  skillCmd
    .command("update <name>")
    .description("Update a skill — vets new version before replacing (old version kept as rollback)")
    .option("--source <path>", "New source path or URL (defaults to original source)")
    .option("--force", "Skip approval prompt")
    .action(async (name: string, opts: { source?: string; force?: boolean }) => {
      const parentOpts = skillCmd.opts() as { home: string; clawhqDir: string };
      const ctx = makeSkillCtx(parentOpts);

      try {
        console.log(`Fetching update for "${name}"...`);
        const { manifest, vetResult, stagingDir } = await stageSkillUpdate(ctx, name, opts.source);

        console.log("");
        console.log(formatSkillSummary(
          manifest.name,
          manifest.version,
          manifest.description,
          manifest.files,
          manifest.requiresContainerDeps,
        ));
        console.log(formatVetResult(vetResult));
        console.log("");

        if (!vetResult.passed) {
          console.error("New version failed security vetting. Update blocked.");
          const { rm: rmDir } = await import("node:fs/promises");
          await rmDir(stagingDir, { recursive: true, force: true });
          process.exitCode = 1;
          return;
        }

        if (!opts.force) {
          const { io, close } = createReadlineIO();
          try {
            const answer = await io.prompt("Apply this update? (yes/no): ");

            if (answer.toLowerCase() !== "yes" && answer.toLowerCase() !== "y") {
              console.log("Update cancelled.");
              const { rm: rmDir } = await import("node:fs/promises");
              await rmDir(stagingDir, { recursive: true, force: true });
              return;
            }
          } finally {
            close();
          }
        }

        const result = await applySkillUpdate(ctx, name, manifest, stagingDir);

        // Record evolve change
        await recordChange(ctx, {
          changeType: "skill_update",
          target: name,
          previousState: `${name}@${result.previousVersion}`,
          newState: `${name}@${result.skill.version}`,
          rollbackSnapshotId: result.snapshotId,
          requiresRebuild: result.requiresRebuild,
        });

        console.log(`Skill "${name}" updated: ${result.previousVersion} -> ${result.skill.version}`);
        console.log(`  Rollback snapshot: ${result.snapshotId}`);
        if (result.requiresRebuild) {
          console.log("");
          console.log("This skill requires container-level dependencies.");
          console.log("Run `clawhq build --stage2-only` to rebuild the agent image.");
        }
      } catch (err: unknown) {
        if (err instanceof SkillError) {
          console.error(`Error: ${err.message}`);
        } else {
          console.error(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exitCode = 1;
      }
    });

  return skillCmd;
}
