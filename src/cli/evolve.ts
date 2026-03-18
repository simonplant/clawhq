import { Command } from "commander";

import {
  buildReviewSummary,
  formatReviewSummary,
  identityFilePath,
  readIdentityFile,
  saveIdentityFile,
  simpleDiff,
} from "../design/governance/review.js";
import {
  type AutonomyConfig,
  AutonomyError,
  DEFAULT_AUTONOMY_CONFIG,
  formatDryRun,
  formatRecommendations,
  generateRecommendations,
  acceptRecommendation,
  loadStore as loadAutonomyStore,
  rejectRecommendation,
} from "../evolve/autonomy/index.js";
import type { AutonomyContext } from "../evolve/autonomy/index.js";
import { recordChange } from "../evolve/history.js";
import {
  type EvolveContext,
  EvolveError,
  formatAudit,
  formatHistory,
  getHistory,
  loadHistory,
  rollbackChange,
} from "../evolve/history.js";

function makeEvolveCtx(opts: { home: string; clawhqDir: string }): EvolveContext {
  return {
    openclawHome: opts.home.replace(/^~/, process.env.HOME ?? "~"),
    clawhqDir: opts.clawhqDir.replace(/^~/, process.env.HOME ?? "~"),
  };
}

export function createEvolveCommand(): Command {
  const evolveCmd = new Command("evolve")
    .description("Manage agent capabilities — history, rollback")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--clawhq-dir <path>", "ClawHQ data directory", "~/.clawhq");

  evolveCmd
    .command("history", { isDefault: true })
    .description("Show all Evolve changes with IDs, timestamps, change type, and rollback status")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const parentOpts = evolveCmd.opts() as { home: string; clawhqDir: string };
      const ctx = makeEvolveCtx(parentOpts);

      try {
        const history = await loadHistory(ctx);
        const entries = getHistory(history);

        if (opts.json) {
          console.log(JSON.stringify(entries, null, 2));
        } else {
          console.log(formatHistory(entries));
        }
      } catch (err: unknown) {
        console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });

  evolveCmd
    .command("rollback <change-id>")
    .description("Reverse a specific Evolve change by restoring previous state")
    .action(async (changeId: string) => {
      const parentOpts = evolveCmd.opts() as { home: string; clawhqDir: string };
      const ctx = makeEvolveCtx(parentOpts);

      try {
        console.log(`Rolling back change ${changeId}...`);
        const result = await rollbackChange(ctx, changeId);

        console.log(`Change "${changeId}" rolled back.`);
        console.log(`  Type: ${result.change.changeType}`);
        console.log(`  Target: ${result.change.target}`);
        console.log(`  Restored: ${result.change.previousState}`);

        if (result.requiresRebuild) {
          console.log("");
          console.log("This rollback affected container image dependencies.");
          console.log("Run `clawhq build` to rebuild the agent image.");
        }
      } catch (err: unknown) {
        if (err instanceof EvolveError) {
          console.error(`Error: ${err.message}`);
        } else {
          console.error(`Rollback failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exitCode = 1;
      }
    });

  evolveCmd
    .command("audit")
    .description("Show full change history with sources, timestamps, vetting results, and rollback status")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const parentOpts = evolveCmd.opts() as { home: string; clawhqDir: string };
      const ctx = makeEvolveCtx(parentOpts);

      try {
        const history = await loadHistory(ctx);
        const entries = getHistory(history);

        if (opts.json) {
          console.log(JSON.stringify(entries, null, 2));
        } else {
          console.log(formatAudit(entries));
        }
      } catch (err: unknown) {
        console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });

  // Identity governance review
  evolveCmd
    .command("identity")
    .description("Review identity file health — token budget, staleness, consistency")
    .option("--json", "Output as JSON")
    .option("--edit <filename>", "Edit a specific identity file (e.g. AGENTS.md)")
    .option("--new-content <content>", "New content for the file (non-interactive edit)")
    .action(async (opts: { json?: boolean; edit?: string; newContent?: string }) => {
      const parentOpts = evolveCmd.opts() as { home: string; clawhqDir: string };
      const ctx = makeEvolveCtx(parentOpts);
      const identityCtx = { openclawHome: ctx.openclawHome };

      try {
        // Build and show the review summary
        const summary = await buildReviewSummary(identityCtx);

        if (opts.edit) {
          // Edit mode: apply new content to a specific file
          const filePath = identityFilePath(identityCtx, opts.edit);
          const originalContent = await readIdentityFile(filePath);

          if (!originalContent) {
            console.error(`Identity file not found: ${opts.edit}`);
            process.exitCode = 1;
            return;
          }

          if (!opts.newContent) {
            // Show current content for reference (user provides content via --new-content)
            console.log(`Current content of ${opts.edit}:`);
            console.log("---");
            console.log(originalContent);
            console.log("---");
            console.log("");
            console.log("To edit, provide new content with --new-content or use your editor:");
            console.log(`  $EDITOR ~/.openclaw/workspace/${opts.edit}`);
            console.log("Then run `clawhq evolve identity` to verify.");
            return;
          }

          // Show diff before saving
          const diff = simpleDiff(originalContent, opts.newContent, opts.edit);
          if (!diff) {
            console.log("No changes detected.");
            return;
          }

          console.log("Changes to apply:");
          console.log("");
          console.log(diff);
          console.log("");

          // Save with customizations preservation
          const result = await saveIdentityFile(filePath, opts.newContent);

          if (result.saved) {
            // Record in evolve history for rollback
            await recordChange(ctx, {
              changeType: "identity_update",
              target: opts.edit,
              previousState: `${originalContent.length} chars`,
              newState: `${opts.newContent.length} chars`,
              rollbackSnapshotId: JSON.stringify({
                filePath: `workspace/${opts.edit}`,
                content: originalContent,
              }),
              requiresRebuild: false,
            });

            console.log(`Saved ${opts.edit}. Change recorded in evolve history.`);
          }
          return;
        }

        // Default: show review summary
        if (opts.json) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log(formatReviewSummary(summary));
        }
      } catch (err: unknown) {
        console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });

  // Autonomy tuning (Evolve sub-feature)
  const autonomyCmd = evolveCmd
    .command("autonomy")
    .description("Analyze approval patterns and recommend autonomy changes")
    .option("--dry-run", "Preview what would be recommended without persisting")
    .option("--json", "Output as JSON")
    .option("--min-sample <n>", "Minimum decisions before recommending", "10")
    .option("--auto-approve-threshold <n>", "Approval rate threshold for auto-approve (0-1)", "0.95")
    .option("--require-approval-threshold <n>", "Rejection rate threshold for require-approval (0-1)", "0.50")
    .action(async (opts: {
      dryRun?: boolean;
      json?: boolean;
      minSample?: string;
      autoApproveThreshold?: string;
      requireApprovalThreshold?: string;
    }) => {
      const parentOpts = evolveCmd.opts() as { home: string; clawhqDir: string };
      const ctx: AutonomyContext = {
        openclawHome: parentOpts.home.replace(/^~/, process.env.HOME ?? "~"),
        clawhqDir: parentOpts.clawhqDir.replace(/^~/, process.env.HOME ?? "~"),
      };

      const config: AutonomyConfig = {
        ...DEFAULT_AUTONOMY_CONFIG,
        minimumSampleSize: parseInt(opts.minSample ?? "10", 10),
        autoApproveThreshold: parseFloat(opts.autoApproveThreshold ?? "0.95"),
        requireApprovalThreshold: parseFloat(opts.requireApprovalThreshold ?? "0.50"),
      };

      try {
        const result = await generateRecommendations(ctx, config);

        if (opts.dryRun) {
          if (opts.json) {
            console.log(JSON.stringify(result.allPending, null, 2));
          } else {
            console.log(formatDryRun(result.allPending));
          }
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify({
            new: result.recommendations,
            allPending: result.allPending,
          }, null, 2));
        } else {
          if (result.recommendations.length > 0) {
            console.log(`Generated ${result.recommendations.length} new recommendation(s).`);
            console.log("");
          }
          console.log(formatRecommendations(result.allPending));
        }
      } catch (err: unknown) {
        if (err instanceof AutonomyError) {
          console.error(`Error: ${err.message}`);
        } else {
          console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exitCode = 1;
      }
    });

  autonomyCmd
    .command("accept <recommendation-id>")
    .description("Accept an autonomy recommendation")
    .action(async (recommendationId: string) => {
      const parentOpts = evolveCmd.opts() as { home: string; clawhqDir: string };
      const ctx: AutonomyContext = {
        openclawHome: parentOpts.home.replace(/^~/, process.env.HOME ?? "~"),
        clawhqDir: parentOpts.clawhqDir.replace(/^~/, process.env.HOME ?? "~"),
      };

      try {
        const result = await acceptRecommendation(ctx, recommendationId);
        console.log(result.message);
      } catch (err: unknown) {
        if (err instanceof AutonomyError) {
          console.error(`Error: ${err.message}`);
        } else {
          console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exitCode = 1;
      }
    });

  autonomyCmd
    .command("reject <recommendation-id>")
    .description("Reject an autonomy recommendation (applies cooldown)")
    .action(async (recommendationId: string) => {
      const parentOpts = evolveCmd.opts() as { home: string; clawhqDir: string };
      const ctx: AutonomyContext = {
        openclawHome: parentOpts.home.replace(/^~/, process.env.HOME ?? "~"),
        clawhqDir: parentOpts.clawhqDir.replace(/^~/, process.env.HOME ?? "~"),
      };

      try {
        const result = await rejectRecommendation(ctx, recommendationId);
        console.log(result.message);
      } catch (err: unknown) {
        if (err instanceof AutonomyError) {
          console.error(`Error: ${err.message}`);
        } else {
          console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exitCode = 1;
      }
    });

  autonomyCmd
    .command("list")
    .description("List all pending autonomy recommendations")
    .option("--json", "Output as JSON")
    .option("--all", "Show all recommendations including resolved")
    .action(async (opts: { json?: boolean; all?: boolean }) => {
      const parentOpts = evolveCmd.opts() as { home: string; clawhqDir: string };
      const ctx: AutonomyContext = {
        openclawHome: parentOpts.home.replace(/^~/, process.env.HOME ?? "~"),
        clawhqDir: parentOpts.clawhqDir.replace(/^~/, process.env.HOME ?? "~"),
      };

      try {
        const store = await loadAutonomyStore(ctx);
        const recs = opts.all
          ? store.recommendations
          : store.recommendations.filter((r) => r.status === "pending");

        if (opts.json) {
          console.log(JSON.stringify(recs, null, 2));
        } else {
          console.log(formatRecommendations(recs));
        }
      } catch (err: unknown) {
        console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });

  return evolveCmd;
}
