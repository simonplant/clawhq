/**
 * CLI tool subcommand — `clawhq tool install/list/remove`.
 *
 * Manages CLI binaries in the agent's Docker image. This is separate from
 * workspace tools (integration scripts) and skills (OpenClaw plugins).
 */

import type { Command } from "commander";

import { isAllowlisted, loadAllowlist } from "../security/vetting.js";
import type { ToolContext } from "../tool/index.js";
import {
  formatToolList,
  installTool,
  listTools,
  removeToolOp,
  ToolError,
} from "../tool/index.js";
import { recordChange } from "../workspace/evolve-history.js";

function makeToolCtx(opts: { home: string; clawhqDir: string }): ToolContext {
  return {
    openclawHome: opts.home.replace(/^~/, process.env.HOME ?? "~"),
    clawhqDir: opts.clawhqDir.replace(/^~/, process.env.HOME ?? "~"),
  };
}

/**
 * Register the `tool` subcommand group on the given program.
 */
export function registerToolCommand(program: Command): void {
  const toolCmd = program
    .command("tool")
    .description("Manage CLI tools — install, list, remove binaries in the agent image")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--clawhq-dir <path>", "ClawHQ data directory", "~/.clawhq");

  toolCmd
    .command("list", { isDefault: true })
    .description("List all known tools with installation status")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const parentOpts = toolCmd.opts() as { home: string; clawhqDir: string };
      const ctx = makeToolCtx(parentOpts);

      try {
        const entries = await listTools(ctx);

        if (opts.json) {
          console.log(JSON.stringify(entries, null, 2));
        } else {
          console.log(formatToolList(entries));
        }
      } catch (err: unknown) {
        console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });

  toolCmd
    .command("install <name>")
    .description("Install a CLI tool into the agent's Docker image")
    .option("--force", "Override allowlist check for non-allowlisted packages")
    .action(async (name: string, opts: { force?: boolean }) => {
      const parentOpts = toolCmd.opts() as { home: string; clawhqDir: string };
      const ctx = makeToolCtx(parentOpts);

      try {
        // Check tool allowlist
        const allowlist = await loadAllowlist(ctx.clawhqDir);
        if (!isAllowlisted(allowlist, name)) {
          console.warn(`WARNING: Package "${name}" is not on the known-safe allowlist.`);
          console.warn("Non-allowlisted packages have not been vetted and may pose security risks.");
          console.warn("");
          if (!opts.force) {
            console.error(
              `Installation blocked. To override, run: clawhq tool install ${name} --force`,
            );
            process.exitCode = 1;
            return;
          }
          console.warn("Proceeding with --force override...");
          console.warn("");
        }

        const result = await installTool(ctx, name);

        // Record evolve change
        await recordChange(ctx, {
          changeType: "tool_install",
          target: result.tool.name,
          previousState: "not installed",
          newState: `installed (${result.definition.installMethod})`,
          rollbackSnapshotId: result.tool.name,
          requiresRebuild: true,
        });

        console.log(`Tool "${result.tool.name}" installed.`);
        console.log(`  ${result.definition.description}`);
        if (result.requiresRebuild) {
          console.log("");
          console.log("Run `clawhq build` to rebuild the agent image with this tool.");
        }
      } catch (err: unknown) {
        if (err instanceof ToolError) {
          console.error(`Error: ${err.message}`);
        } else {
          console.error(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exitCode = 1;
      }
    });

  toolCmd
    .command("remove <name>")
    .description("Remove a CLI tool from the agent's Docker image")
    .action(async (name: string) => {
      const parentOpts = toolCmd.opts() as { home: string; clawhqDir: string };
      const ctx = makeToolCtx(parentOpts);

      try {
        const result = await removeToolOp(ctx, name);

        // Record evolve change
        await recordChange(ctx, {
          changeType: "tool_remove",
          target: result.tool.name,
          previousState: "installed",
          newState: "removed",
          rollbackSnapshotId: result.tool.name,
          requiresRebuild: true,
        });

        console.log(`Tool "${result.tool.name}" removed.`);
        if (result.requiresRebuild) {
          console.log("");
          console.log("Run `clawhq build` to rebuild the agent image without this tool.");
        }
      } catch (err: unknown) {
        if (err instanceof ToolError) {
          console.error(`Error: ${err.message}`);
        } else {
          console.error(`Remove failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exitCode = 1;
      }
    });
}
