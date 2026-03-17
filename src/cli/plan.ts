/**
 * `clawhq init` and `clawhq template` commands — Plan phase.
 */

import { Command } from "commander";

import { runSmartInit } from "../inference/index.js";
import { createReadlineIO, generate, getTemplateById, runWizard, writeBundle } from "../init/index.js";
import type { WizardAnswers } from "../init/index.js";
import {
  formatPreview,
  formatTemplateList as formatYamlTemplateList,
  formatTemplateShow,
  generatePreview,
  loadBuiltInTemplates,
} from "../templates/index.js";

import { markFirstRunComplete } from "./first-run.js";

/**
 * Run non-interactive init: use template defaults + CLI overrides,
 * skip the wizard entirely. For fleet provisioning / scripted use.
 */
async function runNonInteractive(opts: {
  name: string;
  template: string;
  output: string;
  timezone?: string;
}): Promise<void> {
  const template = await getTemplateById(opts.template);
  if (!template) {
    console.error(`Error: template "${opts.template}" not found`);
    process.exitCode = 1;
    return;
  }

  const timezone = opts.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const answers: WizardAnswers = {
    basics: {
      agentName: opts.name,
      timezone,
      wakingHoursStart: "06:00",
      wakingHoursEnd: "23:00",
    },
    template,
    integrations: [],
    modelRouting: {
      localOnly: true,
      cloudProviders: [],
      categories: [
        { category: "email", cloudAllowed: false },
        { category: "calendar", cloudAllowed: false },
        { category: "research", cloudAllowed: false },
        { category: "writing", cloudAllowed: false },
        { category: "coding", cloudAllowed: false },
      ],
    },
  };

  const config = generate(answers);

  if (!config.validationPassed) {
    const failures = config.validationResults.filter((r) => r.status === "fail");
    console.error(`Error: validation failed (${failures.length} rule(s))`);
    for (const f of failures) {
      console.error(`  ${f.rule}: ${f.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const outputDir = opts.output.replace(/^~/, process.env.HOME ?? "~");
  const writeResult = await writeBundle(config.bundle, outputDir);

  if (writeResult.errors.length > 0) {
    console.error(`Error: failed to write files`);
    for (const e of writeResult.errors) {
      console.error(`  ${e}`);
    }
    process.exitCode = 1;
    return;
  }

  await markFirstRunComplete("~/.clawhq");
  console.log(`ok ${opts.name} ${outputDir}`);
}

/**
 * Register Plan-phase commands (init, template) on the program.
 */
export function createPlanCommands(program: Command): void {
  program
    .command("init")
    .description("Initialize a new agent deployment")
    .option("--guided", "Run interactive guided questionnaire")
    .option("--smart", "AI-powered config inference via local Ollama model")
    .option("--non-interactive", "Skip wizard, use template defaults (for scripted provisioning)")
    .option("--name <name>", "Agent name (required for --non-interactive)")
    .option("--template <id>", "Template ID (required for --non-interactive)")
    .option("--timezone <tz>", "IANA timezone (default: system timezone)")
    .option("--ollama-host <url>", "Ollama API host", "http://localhost:11434")
    .option("--ollama-model <name>", "Ollama model to use", "llama3:8b")
    .option("--output <path>", "Output directory for generated config", "~/.openclaw")
    .action(async (opts: {
      guided?: boolean;
      smart?: boolean;
      nonInteractive?: boolean;
      name?: string;
      template?: string;
      timezone?: string;
      ollamaHost: string;
      ollamaModel: string;
      output: string;
    }) => {
      if (opts.nonInteractive) {
        if (!opts.name) {
          console.error("Error: --name is required with --non-interactive");
          process.exitCode = 1;
          return;
        }
        if (!opts.template) {
          console.error("Error: --template is required with --non-interactive");
          process.exitCode = 1;
          return;
        }
        await runNonInteractive({
          name: opts.name,
          template: opts.template,
          output: opts.output,
          timezone: opts.timezone,
        });
        return;
      }

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
          } else {
            await markFirstRunComplete("~/.clawhq");
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
          } else {
            await markFirstRunComplete("~/.clawhq");
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

  templateCmd
    .command("show <id>")
    .description("Show what a template installs — tools, skills, security, and data egress")
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

      console.log(formatTemplateShow(result.template));
    });
}
