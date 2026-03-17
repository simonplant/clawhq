import { Command } from "commander";

import {
  collectMemoryHealth,
  fallbackSummarize,
  runAllTransitions,
  searchMemory,
} from "../internal/memory/index.js";
import type { MemoryHealthReport, MemoryTierName } from "../internal/memory/index.js";

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
    .description("Memory lifecycle management — status, compaction, and search")
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

  memCmd
    .command("search <query>")
    .description(
      "Search across warm and cold memory tiers for matching entries",
    )
    .option("--since <date>", "Only show entries created on or after this ISO date")
    .option("--tier <tier>", "Restrict to a specific tier (hot, warm, cold)")
    .option("--json", "Output as JSON")
    .action(
      async (
        query: string,
        opts: { since?: string; tier?: string; json?: boolean },
      ) => {
        const parentOpts = memCmd.opts() as { home: string };
        const homePath = parentOpts.home.replace(
          /^~/,
          process.env.HOME ?? "~",
        );

        // Validate --tier if provided
        const validTiers: MemoryTierName[] = ["hot", "warm", "cold"];
        if (opts.tier && !validTiers.includes(opts.tier as MemoryTierName)) {
          console.error(
            `Error: invalid tier "${opts.tier}" — must be one of: hot, warm, cold`,
          );
          process.exitCode = 1;
          return;
        }

        // Validate --since if provided
        if (opts.since && isNaN(new Date(opts.since).getTime())) {
          console.error(
            `Error: invalid date "${opts.since}" — use ISO format (e.g. 2026-01-01)`,
          );
          process.exitCode = 1;
          return;
        }

        try {
          const results = await searchMemory(homePath, query, {
            since: opts.since,
            tiers: opts.tier
              ? [opts.tier as MemoryTierName]
              : undefined,
          });

          if (opts.json) {
            console.log(
              JSON.stringify(
                results.map((r) => ({
                  id: r.entry.id,
                  tier: r.tier,
                  score: r.score,
                  createdAt: r.entry.createdAt,
                  content: r.entry.content,
                  category: r.entry.category,
                  tags: r.entry.tags,
                })),
                null,
                2,
              ),
            );
            return;
          }

          if (results.length === 0) {
            console.log(`No matches found for "${query}".`);
            return;
          }

          console.log(
            `Found ${results.length} match${results.length === 1 ? "" : "es"}:\n`,
          );

          // Table header
          console.log(
            `  ${"TIER".padEnd(6)} ${"TIMESTAMP".padEnd(22)} ${"SNIPPET".padEnd(82)} ID`,
          );
          console.log(`  ${"─".repeat(6)} ${"─".repeat(22)} ${"─".repeat(82)} ${"─".repeat(20)}`);

          for (const r of results) {
            const tier = r.tier.padEnd(6);
            const ts = r.entry.createdAt.slice(0, 19).padEnd(22);
            const snippet = truncate(r.entry.content, 80).padEnd(82);
            const id = r.entry.id;
            console.log(`  ${tier} ${ts} ${snippet} ${id}`);
          }
        } catch (err: unknown) {
          console.error(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exitCode = 1;
        }
      },
    );

  return memCmd;
}

function truncate(text: string, maxLen: number): string {
  // Collapse newlines and extra whitespace for display
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= maxLen) return flat;
  return flat.slice(0, maxLen - 1) + "…";
}
