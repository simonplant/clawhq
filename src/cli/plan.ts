/**
 * `clawhq init` and `clawhq template` commands — Plan phase.
 */

import { Command } from "commander";

import { runSmartInit } from "../inference/index.js";
import { createReadlineIO, runWizard } from "../init/index.js";
import {
  formatPreview,
  formatTemplateList as formatYamlTemplateList,
  generatePreview,
  loadBuiltInTemplates,
} from "../templates/index.js";

/**
 * Register Plan-phase commands (init, template) on the program.
 */
export function createPlanCommands(program: Command): void {
  program
    .command("init")
    .description("Initialize a new agent deployment")
    .option("--guided", "Run interactive guided questionnaire")
    .option("--smart", "AI-powered config inference via local Ollama model")
    .option("--ollama-host <url>", "Ollama API host", "http://localhost:11434")
    .option("--ollama-model <name>", "Ollama model to use", "llama3:8b")
    .option("--output <path>", "Output directory for generated config", "~/.openclaw")
    .action(async (opts: { guided?: boolean; smart?: boolean; ollamaHost: string; ollamaModel: string; output: string }) => {
      const outputDir = opts.output.replace(/^~/, process.env.HOME ?? "~");

      const { io, close } = createReadlineIO();
      try {
        if (opts.smart) {
          const result = await runSmartInit({
            io,
            outputDir,
            ollamaHost: opts.ollamaHost,
            ollamaModel: opts.ollamaModel,
          });

          if (result.writeResult.errors.length > 0) {
            process.exitCode = 1;
          }
        } else {
          if (!opts.guided) {
            console.log("Hint: Use `clawhq init --guided` for the interactive setup wizard.");
            console.log("      Use `clawhq init --smart` for AI-powered config inference.");
            console.log("");
            console.log("Starting guided setup...");
            console.log("");
          }

          const result = await runWizard(io, outputDir);

          if (result.writeResult.errors.length > 0) {
            process.exitCode = 1;
          }
        }
      } finally {
        close();
      }
    });

  const templateCmd = program
    .command("template")
    .description("Manage agent templates");

  templateCmd
    .command("list", { isDefault: true })
    .description("List available templates")
    .action(async () => {
      const results = await loadBuiltInTemplates();
      const templates = new Map<string, import("../templates/index.js").Template>();
      for (const [id, result] of results) {
        if (result.template) {
          templates.set(id, result.template);
        }
      }
      console.log("Available templates:\n");
      console.log(formatYamlTemplateList(templates));
    });

  templateCmd
    .command("preview <id>")
    .description("Preview a template's operational profile")
    .action(async (id: string) => {
      const results = await loadBuiltInTemplates();
      const result = results.get(id);

      if (!result || !result.template) {
        console.error(`Template "${id}" not found.`);
        console.error("Available templates:");
        for (const [tid] of results) {
          if (tid !== "_error") {
            console.error(`  - ${tid}`);
          }
        }
        process.exitCode = 1;
        return;
      }

      const preview = generatePreview(result.template);
      console.log(formatPreview(preview));
    });
}
