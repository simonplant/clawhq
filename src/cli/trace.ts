/**
 * `clawhq trace` subcommand — query and explain agent decision traces.
 *
 * Allows users to ask "why did you do that?" for any agent action,
 * view decision history, and submit corrections.
 */

import { Command } from "commander";

import type { LearningContext } from "../evolve/learning/index.js";
import {
  explain,
  processCorrection,
  queryTrace,
  TraceError,
} from "../evolve/trace/index.js";
import type { DecisionEntry, TraceContext } from "../evolve/trace/index.js";

function resolveHome(path: string): string {
  return path.replace(/^~/, process.env.HOME ?? "~");
}

function formatEntry(entry: DecisionEntry): string {
  const lines: string[] = [];
  lines.push(`  ${entry.id}  [${entry.actionType}]  ${entry.timestamp}`);
  lines.push(`    Action:  ${entry.summary}`);
  lines.push(`    Outcome: ${entry.outcome}`);
  if (entry.factors.length > 0) {
    lines.push("    Factors:");
    for (const f of entry.factors) {
      lines.push(`      - [${f.kind}] ${f.content} (from ${f.source}, weight: ${f.weight})`);
    }
  }
  if (entry.parentId) {
    lines.push(`    Parent:  ${entry.parentId}`);
  }
  return lines.join("\n");
}

/**
 * Create the `trace` command for decision trace queries.
 */
export function createTraceCommand(): Command {
  const traceCmd = new Command("trace")
    .description("Query agent decision traces — ask 'why did you do that?'");

  traceCmd
    .command("why")
    .description("Explain why the agent took a specific action (by ID or keyword)")
    .argument("<query>", "Decision ID (dec-...) or keyword to search")
    .option("--clawhq-dir <path>", "ClawHQ data directory", "~/.clawhq")
    .option("--ollama-host <url>", "Ollama API host", "http://localhost:11434")
    .option("--ollama-model <name>", "Ollama model for explanation", "llama3:8b")
    .option("--no-explain", "Skip generating natural-language explanation")
    .action(async (query: string, opts: {
      clawhqDir: string;
      ollamaHost: string;
      ollamaModel: string;
      explain: boolean;
    }) => {
      const ctx: TraceContext = { clawhqDir: resolveHome(opts.clawhqDir) };

      try {
        // If it looks like a decision ID, query by ID; otherwise keyword search
        const isId = query.startsWith("dec-");
        const result = isId
          ? await queryTrace(ctx, { id: query })
          : await queryTrace(ctx, { keyword: query });

        if (result.entries.length === 0) {
          console.log(`No decisions found matching "${query}".`);
          return;
        }

        if (result.entries.length > 1) {
          console.log(`Found ${result.entries.length} matching decisions:\n`);
          for (const entry of result.entries) {
            console.log(formatEntry(entry));
            console.log();
          }
          console.log("Tip: use a decision ID (dec-...) for a detailed explanation.");
          return;
        }

        const entry = result.entries[0];

        console.log("Decision trace:");
        console.log(formatEntry(entry));

        if (result.chain.length > 1) {
          console.log("\nDecision chain:");
          for (const step of result.chain) {
            console.log(formatEntry(step));
          }
        }

        if (opts.explain) {
          console.log("\nGenerating explanation...");
          const { explanation, method } = await explain(
            entry,
            result.chain,
            opts.ollamaHost,
            opts.ollamaModel,
          );
          console.log(`\nExplanation (${method}):`);
          console.log(`  ${explanation.text}`);

          if (explanation.citations.length > 0) {
            console.log("\nCitations:");
            for (const cite of explanation.citations) {
              console.log(`  - [${cite.kind}] from ${cite.source}: "${cite.content}"`);
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof TraceError) {
          console.error(`Trace error: ${err.message} (${err.code})`);
        } else {
          console.error(
            `Failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        process.exitCode = 1;
      }
    });

  traceCmd
    .command("list")
    .description("List recent decision traces")
    .option("--action-type <type>", "Filter by action type")
    .option("--since <date>", "Show decisions after this date (ISO 8601)")
    .option("--before <date>", "Show decisions before this date (ISO 8601)")
    .option("--limit <n>", "Maximum entries to show", "20")
    .option("--clawhq-dir <path>", "ClawHQ data directory", "~/.clawhq")
    .action(async (opts: {
      actionType?: string;
      since?: string;
      before?: string;
      limit: string;
      clawhqDir: string;
    }) => {
      const ctx: TraceContext = { clawhqDir: resolveHome(opts.clawhqDir) };

      try {
        const result = await queryTrace(ctx, {
          actionType: opts.actionType,
          since: opts.since,
          before: opts.before,
          limit: parseInt(opts.limit, 10),
        });

        if (result.entries.length === 0) {
          console.log("No decisions found matching the criteria.");
          return;
        }

        console.log(`Found ${result.entries.length} decision(s):\n`);
        for (const entry of result.entries) {
          console.log(formatEntry(entry));
          console.log();
        }
      } catch (err: unknown) {
        console.error(
          `Failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });

  traceCmd
    .command("correct")
    .description("Submit a correction for a decision (feeds into preference learning)")
    .argument("<id>", "Decision ID to correct")
    .argument("<correction>", "What should have happened instead")
    .option("--clawhq-dir <path>", "ClawHQ data directory", "~/.clawhq")
    .option("--openclaw-home <path>", "OpenClaw home directory", "~/.openclaw")
    .action(async (id: string, correction: string, opts: {
      clawhqDir: string;
      openclawHome: string;
    }) => {
      const traceCtx: TraceContext = { clawhqDir: resolveHome(opts.clawhqDir) };
      const learningCtx: LearningContext = {
        openclawHome: resolveHome(opts.openclawHome),
        clawhqDir: resolveHome(opts.clawhqDir),
      };

      try {
        const result = await queryTrace(traceCtx, { id });
        const entry = result.entries[0];

        const signal = await processCorrection(
          {
            decisionId: id,
            correctionText: correction,
            timestamp: new Date().toISOString(),
          },
          entry,
          learningCtx,
        );

        console.log("Correction recorded:");
        console.log(`  Signal:   ${signal.id}`);
        console.log(`  Type:     ${signal.signalType}`);
        console.log(`  Category: ${signal.category}`);
        console.log(`  Target:   ${signal.appliedToIdentity}`);
        console.log("\nThis correction will feed into preference learning.");
      } catch (err: unknown) {
        if (err instanceof TraceError) {
          console.error(`Trace error: ${err.message} (${err.code})`);
        } else {
          console.error(
            `Failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        process.exitCode = 1;
      }
    });

  return traceCmd;
}
