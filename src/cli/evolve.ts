import { Command } from "commander";

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
} from "../internal/autonomy/index.js";
import type { AutonomyContext } from "../internal/autonomy/index.js";
import {
  type EvolveContext,
  EvolveError,
  formatAudit,
  formatHistory,
  getHistory,
  loadHistory,
  rollbackChange,
} from "../workspace/evolve-history.js";

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
