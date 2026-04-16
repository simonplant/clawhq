/**
 * Pairing commands — approve/reject device pairing from inside the container.
 *
 * Wraps `openclaw pairing` CLI so the user never needs raw `docker exec`.
 * Everything goes through clawhq.
 */

import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import type { Command } from "commander";
import chalk from "chalk";

import { CommandError } from "../errors.js";
import { ensureInstalled } from "../ux.js";

const execFileAsync = promisify(execFile);

const PAIRING_TIMEOUT_MS = 10_000;

export function registerPairingCommands(program: Command, defaultDeployDir: string): void {
  const pairing = program
    .command("pairing")
    .description("Manage device pairing for messaging channels");

  pairing
    .command("approve")
    .description("Approve a pending pairing request")
    .argument("<channel>", "Channel type (telegram, whatsapp)")
    .argument("<code>", "Pairing code shown in the channel")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (channel: string, code: string, opts: { deployDir: string }) => {
      ensureInstalled(opts.deployDir);

      const composePath = join(opts.deployDir, "engine", "docker-compose.yml");

      try {
        const { stdout } = await execFileAsync(
          "docker",
          [
            "compose", "-f", composePath,
            "exec", "-T", "openclaw",
            "openclaw", "pairing", "approve", channel, code,
          ],
          { timeout: PAIRING_TIMEOUT_MS },
        );
        console.log(chalk.green("Pairing approved."));
        if (stdout.trim()) console.log(stdout.trim());
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("No pending pairing request")) {
          console.error(chalk.yellow("No pending pairing request for that code — it may have expired. Send a new message to get a fresh code."));
        } else if (msg.includes("is not running")) {
          console.error(chalk.red("Container is not running. Start with: clawhq up"));
        } else {
          console.error(chalk.red(`Pairing failed: ${msg}`));
        }
        throw new CommandError("", 1);
      }
    });

  pairing
    .command("list")
    .description("List pending pairing requests")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (opts: { deployDir: string }) => {
      ensureInstalled(opts.deployDir);

      const composePath = join(opts.deployDir, "engine", "docker-compose.yml");

      try {
        const { stdout } = await execFileAsync(
          "docker",
          [
            "compose", "-f", composePath,
            "exec", "-T", "openclaw",
            "openclaw", "pairing", "list",
          ],
          { timeout: PAIRING_TIMEOUT_MS },
        );
        console.log(stdout.trim() || "No pending pairing requests.");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("is not running")) {
          console.error(chalk.red("Container is not running. Start with: clawhq up"));
        } else {
          console.error(chalk.red(`Failed to list pairings: ${msg}`));
        }
        throw new CommandError("", 1);
      }
    });
}
