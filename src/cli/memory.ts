import { Command } from "commander";

import {
  collectMemoryHealth,
  fallbackSummarize,
  runAllTransitions,
} from "../internal/memory/index.js";
import type { MemoryHealthReport } from "../internal/memory/index.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function formatStatus(report: MemoryHealthReport): string {
  const lines: string[] = [];

  lines.push("Memory Status");
  lines.push("=============");
  lines.push("");

  for (const tier of report.tiers) {
    const age =
      tier.oldestEntryAge != null && tier.newestEntryAge != null
        ? `  age: ${tier.newestEntryAge}–${tier.oldestEntryAge} days`
        : "";
    lines.push(
      `  ${tier.name.padEnd(5)} ${String(tier.entryCount).padStart(5)} entries   ${formatBytes(tier.sizeBytes).padStart(10)}${age}`,
    );
  }

  lines.push("");
  lines.push(
    `  Total: ${report.totalEntries} entries, ${formatBytes(report.totalSizeBytes)}`,
  );

  if (report.hotTierOverBudget) {
    lines.push("");
    lines.push("  ⚠ Hot tier is over budget — run `clawhq memory compact`");
  }

  if (report.pendingTransitions > 0) {
    lines.push(
      `  ${report.pendingTransitions} entries pending transition`,
    );
  }

  if (report.staleEntriesCount > 0) {
    lines.push(
      `  ${report.staleEntriesCount} stale entries (not accessed in 30+ days)`,
    );
  }

  return lines.join("\n");
}

export function createMemoryCommand(): Command {
  const memCmd = new Command("memory")
    .description("Memory lifecycle management — status and compaction")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw");

  memCmd
    .command("status", { isDefault: true })
    .description(
      "Show hot/warm/cold tier sizes with entry counts and total bytes",
    )
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const parentOpts = memCmd.opts() as { home: string };
      const homePath = parentOpts.home.replace(
        /^~/,
        process.env.HOME ?? "~",
      );

      try {
        const report = await collectMemoryHealth(homePath);

        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(formatStatus(report));
        }
      } catch (err: unknown) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });

  memCmd
    .command("compact")
    .description(
      "Trigger hot→warm→cold tier transitions and report results",
    )
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const parentOpts = memCmd.opts() as { home: string };
      const homePath = parentOpts.home.replace(
        /^~/,
        process.env.HOME ?? "~",
      );

      try {
        console.log("Running memory compaction...");
        const result = await runAllTransitions(homePath, {
          summarizer: (t: string) =>
            Promise.resolve(fallbackSummarize(t)),
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log("");
          console.log("Compaction complete:");
          console.log(`  Moved:      ${result.moved}`);
          console.log(`  Summarized: ${result.summarized}`);
          console.log(`  PII masked: ${result.piiMasked}`);
          console.log(`  Deleted:    ${result.deleted}`);

          const total =
            result.moved + result.summarized + result.piiMasked + result.deleted;
          if (total === 0) {
            console.log("");
            console.log("No entries needed transition.");
          }
        }
      } catch (err: unknown) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });

  return memCmd;
}
