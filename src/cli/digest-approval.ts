import { Command } from "commander";

import type { ApprovalCategory } from "../approval/index.js";
import {
  approve as approveAction,
  enqueue,
  formatApprovalJson,
  formatApprovalSummary,
  formatApprovalTable,
  getPending,
  getQueueSummary,
  notifyTelegram,
  readQueue,
  reject as rejectAction,
} from "../approval/index.js";
import {
  formatDigestJson,
  formatDigestTable,
  generateDigest,
} from "../digest/index.js";

export function createDigestApprovalCommands(program: Command): void {
  program
    .command("digest")
    .description("Show human-readable activity summary")
    .option("--json", "Output as JSON")
    .option("--privacy", "Privacy mode: summarize by category without showing content")
    .option("--since <date>", "Only include entries since this date (ISO 8601)")
    .option("--until <date>", "Only include entries until this date (ISO 8601)")
    .option("--config <path>", "OpenClaw home directory", "~/.openclaw")
    .action(async (opts) => {
      try {
        const report = await generateDigest({
          openclawHome: opts.config,
          since: opts.since,
          until: opts.until,
          privacyMode: opts.privacy ?? false,
        });

        if (opts.json) {
          console.log(formatDigestJson(report));
        } else {
          console.log(formatDigestTable(report));
        }
      } catch (err: unknown) {
        console.error(
          `Digest failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });

  const approvalCmd = program
    .command("approval")
    .description("Manage the approval queue for high-stakes actions");

  approvalCmd
    .command("list")
    .description("List approval queue entries")
    .option("--json", "Output as JSON")
    .option("--all", "Show all entries, not just pending")
    .option("--config <path>", "OpenClaw home directory", "~/.openclaw")
    .action(async (opts) => {
      try {
        const entries = opts.all
          ? await readQueue({ openclawHome: opts.config })
          : await getPending({ openclawHome: opts.config });

        if (opts.json) {
          console.log(formatApprovalJson(entries));
        } else {
          console.log(formatApprovalTable(entries));
        }
      } catch (err: unknown) {
        console.error(
          `Failed to list approvals: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });

  approvalCmd
    .command("summary")
    .description("Show approval queue summary")
    .option("--config <path>", "OpenClaw home directory", "~/.openclaw")
    .action(async (opts) => {
      try {
        const summary = await getQueueSummary({ openclawHome: opts.config });
        console.log(formatApprovalSummary(summary));
      } catch (err: unknown) {
        console.error(
          `Failed to get summary: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });

  approvalCmd
    .command("approve <id>")
    .description("Approve a pending action")
    .option("--config <path>", "OpenClaw home directory", "~/.openclaw")
    .action(async (id: string, opts) => {
      try {
        const result = await approveAction(id, { openclawHome: opts.config });
        console.log(result.message);
        if (!result.changed) process.exitCode = 1;
      } catch (err: unknown) {
        console.error(
          `Approve failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });

  approvalCmd
    .command("reject <id>")
    .description("Reject a pending action (reason stored as preference signal)")
    .option("--reason <reason>", "Rejection reason")
    .option("--config <path>", "OpenClaw home directory", "~/.openclaw")
    .action(async (id: string, opts) => {
      try {
        const result = await rejectAction(id, opts.reason, { openclawHome: opts.config });
        console.log(result.message);
        if (!result.changed) process.exitCode = 1;
      } catch (err: unknown) {
        console.error(
          `Reject failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });

  approvalCmd
    .command("add <category> <description>")
    .description("Add an approval request (for testing/integration)")
    .option("--details <details>", "Additional details")
    .option("--notify", "Send Telegram notification")
    .option("--config <path>", "OpenClaw home directory", "~/.openclaw")
    .action(async (category: string, description: string, opts) => {
      try {
        const entry = await enqueue(
          category as ApprovalCategory,
          description,
          opts.details,
          { openclawHome: opts.config },
        );
        console.log(`Queued approval: ${entry.id}`);
        console.log(`  Category: ${entry.category}`);
        console.log(`  Description: ${entry.description}`);

        if (opts.notify) {
          const home = (opts.config as string).replace(/^~/, process.env.HOME ?? "~");
          const envPath = `${home}/.env`;
          const notifyResult = await notifyTelegram(entry, envPath);
          console.log(`  Telegram: ${notifyResult.message}`);
        }
      } catch (err: unknown) {
        console.error(
          `Enqueue failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });
}
