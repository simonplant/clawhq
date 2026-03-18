import chalk from "chalk";
import { Command } from "commander";

import {
  addService,
  formatServiceList,
  listServices,
  removeService,
} from "../build/service/manager.js";
import type { ServiceContext } from "../build/service/manager.js";
import { BUILTIN_SERVICES, ServiceError } from "../build/service/types.js";
import { recordChange } from "../evolve/history.js";

import { spinner, status } from "./ui.js";

function makeServiceCtx(opts: { home: string; clawhqDir: string }): ServiceContext {
  return {
    openclawHome: opts.home.replace(/^~/, process.env.HOME ?? "~"),
    clawhqDir: opts.clawhqDir.replace(/^~/, process.env.HOME ?? "~"),
  };
}

export function createServiceCommand(): Command {
  const serviceCmd = new Command("service")
    .description("Manage backing services — postgres, redis, qdrant")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--clawhq-dir <path>", "ClawHQ data directory", "~/.clawhq");

  serviceCmd
    .command("list", { isDefault: true })
    .description("List configured backing services with status")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const parentOpts = serviceCmd.opts() as { home: string; clawhqDir: string };
      const ctx = makeServiceCtx(parentOpts);

      try {
        const entries = await listServices(ctx);

        if (opts.json) {
          console.log(JSON.stringify(entries, null, 2));
        } else {
          console.log(formatServiceList(entries));
        }
      } catch (err: unknown) {
        console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });

  serviceCmd
    .command("add <name>")
    .description(
      `Add a backing service to docker-compose (${Object.keys(BUILTIN_SERVICES).join(", ")})`,
    )
    .action(async (name: string) => {
      const parentOpts = serviceCmd.opts() as { home: string; clawhqDir: string };
      const ctx = makeServiceCtx(parentOpts);

      try {
        const s = spinner(`${chalk.green("Deploy")} Adding service "${name}"...`);
        s.start();

        const result = await addService(ctx, name);

        s.succeed(
          `${chalk.green("Deploy")} ${status.pass} Service "${name}" added (${result.definition.image})`,
        );

        // Show injected env vars
        const envKeys = Object.keys(result.definition.agentEnvVars);
        if (envKeys.length > 0) {
          console.log("");
          console.log("  Env vars injected into .env:");
          for (const k of envKeys) {
            console.log(`    ${k}=${result.definition.agentEnvVars[k]}`);
          }
        }

        console.log("");
        console.log("  Run `clawhq up` to start the service alongside your agent.");

        // Record evolve change
        await recordChange(ctx, {
          changeType: "integration_add",
          target: `service:${name}`,
          previousState: "not configured",
          newState: `${name} (${result.definition.image})`,
          rollbackSnapshotId: null,
          requiresRebuild: false,
        });
      } catch (err: unknown) {
        if (err instanceof ServiceError) {
          console.error(`Error: ${err.message}`);
        } else {
          console.error(`Add failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exitCode = 1;
      }
    });

  serviceCmd
    .command("remove <name>")
    .description("Remove a backing service from docker-compose")
    .option("--delete-data", "Also remove persistent volumes (destroys data)")
    .action(async (name: string, opts: { deleteData?: boolean }) => {
      const parentOpts = serviceCmd.opts() as { home: string; clawhqDir: string };
      const ctx = makeServiceCtx(parentOpts);

      try {
        const result = await removeService(ctx, name, {
          deleteData: opts.deleteData,
        });

        console.log(`Service "${name}" removed from docker-compose.yml.`);
        if (result.volumesRemoved) {
          console.log("  Persistent volumes marked for removal.");
        } else {
          console.log("  Data volumes preserved. Use --delete-data to remove them.");
        }

        // Record evolve change
        await recordChange(ctx, {
          changeType: "integration_remove",
          target: `service:${name}`,
          previousState: `${name} (${result.definition.image})`,
          newState: "removed",
          rollbackSnapshotId: null,
          requiresRebuild: false,
        });
      } catch (err: unknown) {
        if (err instanceof ServiceError) {
          console.error(`Error: ${err.message}`);
        } else {
          console.error(`Remove failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exitCode = 1;
      }
    });

  return serviceCmd;
}
