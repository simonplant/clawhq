/**
 * `clawhq migrate` subcommand — import data from other AI assistants.
 *
 * Supports:
 * - ChatGPT export ZIP files (conversation history → USER.md + warm memory)
 * - Google Assistant Takeout exports (routines → cron/jobs.json)
 */

import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";

import { Command } from "commander";

import {
  convertRoutines,
  parseGoogleAssistantExport,
  writeCronJobs,
} from "../internal/migrate/google-assistant/index.js";
import type { ConversionResult } from "../internal/migrate/google-assistant/index.js";
import {
  buildConversationTexts,
  extract,
  maskExtractedItems,
  MigrateError,
  parseExport,
  reviewItems,
  appendToUserMd,
  writeToWarmMemory,
} from "../internal/migrate/index.js";
import type { MigrateIO } from "../internal/migrate/index.js";

const SUPPORTED_SOURCES = ["chatgpt", "google-assistant"];

/**
 * Create a MigrateIO backed by readline for interactive terminal use.
 */
function createTerminalIO(): { io: MigrateIO; close: () => void } {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const io: MigrateIO = {
    print(message: string): void {
      console.log(message);
    },
    prompt(question: string): Promise<string> {
      return new Promise((resolve) => {
        rl.question(question, resolve);
      });
    },
  };

  return { io, close: () => rl.close() };
}

/**
 * Format a conversion result for display.
 */
function formatConversionResult(result: ConversionResult, index: number): string {
  const lines: string[] = [];
  const num = index + 1;

  lines.push(`\n--- Routine ${num}: ${result.routine.name} ---`);
  lines.push(`  Trigger: ${result.routine.trigger.type}${result.routine.trigger.time ? ` at ${result.routine.trigger.time}` : ""}${result.routine.trigger.days?.length ? ` on ${result.routine.trigger.days.join(", ")}` : ""}`);
  lines.push(`  Actions: ${result.routine.actions.map((a) => a.type).join(", ")}`);

  if (result.mappable && result.cronJob) {
    lines.push(`  Status: MAPPABLE`);
    lines.push(`  Cron expression: ${result.cronJob.expr}`);
    lines.push(`  Task: ${result.cronJob.task}`);
  } else {
    lines.push(`  Status: UNMAPPABLE`);
    lines.push(`  Reason: ${result.reason}`);
  }

  if (result.unmappableActions.length > 0) {
    lines.push(`  Unmappable actions:`);
    for (const ua of result.unmappableActions) {
      lines.push(`    - ${ua.action.type}: ${ua.reason}`);
      lines.push(`      Suggestion: ${ua.suggestion}`);
    }
  }

  return lines.join("\n");
}

/**
 * Run the Google Assistant routine import flow.
 */
async function runGoogleAssistantMigrate(
  exportPath: string,
  openclawHome: string,
  io: MigrateIO,
): Promise<void> {
  // Step 1: Parse
  io.print("Parsing Google Assistant export...");
  const parsed = await parseGoogleAssistantExport(exportPath);
  io.print(`Found ${parsed.routines.length} routine(s) in ${parsed.sourcePath}.`);

  if (parsed.routines.length === 0) {
    io.print("No routines found in export. Nothing to import.");
    return;
  }

  // Step 2: Convert
  io.print("\nConverting routines to cron jobs...");
  const results = convertRoutines(parsed.routines);

  const mappable = results.filter((r) => r.mappable);
  const unmappable = results.filter((r) => !r.mappable);

  io.print(`  Mappable:   ${mappable.length} routine(s)`);
  io.print(`  Unmappable: ${unmappable.length} routine(s)`);

  // Step 3: Display all results
  for (let i = 0; i < results.length; i++) {
    io.print(formatConversionResult(results[i], i));
  }

  if (mappable.length === 0) {
    io.print("\nNo routines could be converted to cron jobs. Nothing to write.");
    return;
  }

  // Step 4: Interactive approval
  io.print("\n--- Review Mappable Routines ---");
  const approved: ConversionResult[] = [];

  for (const result of mappable) {
    const cronJob = result.cronJob;
    if (!cronJob) continue;

    const answer = await io.prompt(
      `\nApprove "${result.routine.name}" (cron: ${cronJob.expr})? [y/n/e(dit)] `,
    );
    const choice = answer.trim().toLowerCase();

    if (choice === "y" || choice === "yes") {
      approved.push(result);
    } else if (choice === "e" || choice === "edit") {
      const newTask = await io.prompt("  Enter new task prompt: ");
      if (newTask.trim()) {
        cronJob.task = newTask.trim();
      }
      approved.push(result);
    } else {
      io.print(`  Skipped "${result.routine.name}".`);
    }
  }

  if (approved.length === 0) {
    io.print("\nNo routines approved. Nothing to write.");
    return;
  }

  // Step 5: Write to cron/jobs.json
  io.print("\nWriting approved cron jobs...");
  const jobs = approved
    .map((r) => r.cronJob)
    .filter((j): j is NonNullable<typeof j> => j != null);
  const { total, added, replaced } = await writeCronJobs(openclawHome, jobs);

  io.print(`\nMigration complete:`);
  io.print(`  Cron jobs added:    ${added}`);
  io.print(`  Cron jobs replaced: ${replaced}`);
  io.print(`  Total cron jobs:    ${total}`);
}

/**
 * Run the ChatGPT conversation import flow.
 */
async function runChatGPTMigrate(
  file: string,
  openclawHome: string,
  tokenBudget: number,
  io: MigrateIO,
): Promise<void> {
  // Step 1: Parse
  io.print("Parsing ChatGPT export...");
  const parsed = await parseExport(file);
  io.print(
    `Found ${parsed.conversations.length} conversation(s), ` +
    `${parsed.userMessageCount} user message(s), ` +
    `${parsed.assistantMessageCount} assistant message(s).`,
  );

  if (parsed.conversations.length === 0) {
    io.print("No conversations found in export. Nothing to import.");
    return;
  }

  // Step 2: Build conversation texts
  const texts = buildConversationTexts(parsed.conversations);

  // Step 3: Extract facts/preferences
  io.print("\nExtracting facts and preferences...");
  const { items: rawItems } = extract(texts);
  io.print(
    `Extracted ${rawItems.length} item(s) using pattern matching.`,
  );

  if (rawItems.length === 0) {
    io.print("No extractable facts or preferences found. Nothing to import.");
    return;
  }

  // Step 4: PII detection and masking
  io.print("\nScanning for PII...");
  const { items: maskedItems, totalPIIFound, itemsWithPII } = maskExtractedItems(rawItems);
  if (totalPIIFound > 0) {
    io.print(
      `Masked ${totalPIIFound} PII instance(s) across ${itemsWithPII} item(s).`,
    );
  } else {
    io.print("No PII detected.");
  }

  // Step 5: Interactive review
  const reviewed = await reviewItems(maskedItems, io);

  const approved = reviewed.filter(
    (r) => r.decision === "approve" || r.decision === "edit",
  );

  if (approved.length === 0) {
    io.print("\nNo items approved. Nothing to write.");
    return;
  }

  // Step 6: Write to USER.md and warm memory
  io.print("\nWriting approved items...");
  const userMdCount = await appendToUserMd(openclawHome, reviewed, tokenBudget);
  const memoryCount = await writeToWarmMemory(openclawHome, reviewed);

  io.print(`\nMigration complete:`);
  io.print(`  USER.md:      ${userMdCount} entries added`);
  io.print(`  Warm memory:  ${memoryCount} entries written`);
}

/**
 * Create the `migrate` command with `--from chatgpt` and `--from google-assistant` support.
 */
export function createMigrateCommand(): Command {
  const migrateCmd = new Command("migrate")
    .description("Import data from other AI assistants (chatgpt, google-assistant)")
    .requiredOption("--from <source>", `Source platform (${SUPPORTED_SOURCES.join(", ")})`)
    .option("--openclaw-home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--token-budget <chars>", "Max chars for USER.md additions", "20000")
    .argument("<file>", "Export file or directory path")
    .action(async (file: string, opts: {
      from: string;
      openclawHome: string;
      tokenBudget: string;
    }) => {
      if (!SUPPORTED_SOURCES.includes(opts.from)) {
        console.error(
          `Unsupported source: ${opts.from}. Supported: ${SUPPORTED_SOURCES.join(", ")}`,
        );
        process.exitCode = 1;
        return;
      }

      // Validate export path exists
      try {
        await stat(file);
      } catch {
        console.error(`Export path not found: ${file}`);
        process.exitCode = 1;
        return;
      }

      const openclawHome = opts.openclawHome.replace(/^~/, process.env.HOME ?? "~");
      const tokenBudget = parseInt(opts.tokenBudget, 10);

      const { io, close } = createTerminalIO();

      try {
        if (opts.from === "google-assistant") {
          await runGoogleAssistantMigrate(file, openclawHome, io);
        } else {
          await runChatGPTMigrate(file, openclawHome, tokenBudget, io);
        }
      } catch (err: unknown) {
        if (err instanceof MigrateError) {
          console.error(`Migration failed: ${err.message} (${err.code})`);
        } else {
          console.error(
            `Migration failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        process.exitCode = 1;
      } finally {
        close();
      }
    });

  return migrateCmd;
}
