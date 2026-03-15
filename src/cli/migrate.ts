/**
 * `clawhq migrate` subcommand — import data from other AI assistants.
 *
 * Currently supports ChatGPT export ZIP files.
 * Uses regex-based pattern matching for fact/preference extraction.
 */

import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";

import { Command } from "commander";

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
 * Create the `migrate` command with `--from chatgpt` support.
 */
export function createMigrateCommand(): Command {
  const migrateCmd = new Command("migrate")
    .description("Import conversation history from other AI assistants")
    .requiredOption("--from <source>", "Source platform (chatgpt)")
    .option("--openclaw-home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--token-budget <chars>", "Max chars for USER.md additions", "20000")
    .argument("<file>", "Export file path (e.g., chatgpt-export.zip)")
    .action(async (file: string, opts: {
      from: string;
      openclawHome: string;
      tokenBudget: string;
    }) => {
      if (opts.from !== "chatgpt") {
        console.error(`Unsupported source: ${opts.from}. Currently supported: chatgpt`);
        process.exitCode = 1;
        return;
      }

      // Validate file exists
      try {
        const s = await stat(file);
        if (!s.isFile()) {
          console.error(`Not a file: ${file}`);
          process.exitCode = 1;
          return;
        }
      } catch {
        console.error(`File not found: ${file}`);
        process.exitCode = 1;
        return;
      }

      const openclawHome = opts.openclawHome.replace(/^~/, process.env.HOME ?? "~");
      const tokenBudget = parseInt(opts.tokenBudget, 10);

      const { io, close } = createTerminalIO();

      try {
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
