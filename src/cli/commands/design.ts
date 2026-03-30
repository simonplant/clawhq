import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import type { Command } from "commander";

import chalk from "chalk";
import ora from "ora";
import { parse as yamlParse } from "yaml";

import { validateBundle } from "../../config/validate.js";
import {
  allTemplatesToChoices,
  loadAllBuiltinBlueprints,
  loadBlueprint,
  validateBlueprint,
} from "../../design/blueprints/index.js";
import type { Blueprint } from "../../design/blueprints/index.js";
import {
  createInquirerPrompter,
  generateBundle,
  runSmartInference,
  runWizard,
  SmartInferenceAbortError,
  WizardAbortError,
  writeBundle,
} from "../../design/configure/index.js";

import { CommandError } from "../errors.js";
import { renderError } from "../ux.js";
import { bundleToFiles } from "./helpers.js";

/** Print a full blueprint preview to stdout. */
function printBlueprintPreview(bp: Blueprint): void {
  const slug = bp.name.toLowerCase().replace(/\s+/g, "-");
  const dim = chalk.dim;
  const bold = chalk.bold;

  console.log(bold(`\n${bp.name}`) + dim(` (${slug} v${bp.version})`));
  console.log(dim("═".repeat(60)));

  // Use case
  console.log(bold("\nUse Case"));
  console.log(`  Replaces:  ${bp.use_case_mapping.replaces}`);
  console.log(`  Tagline:   ${bp.use_case_mapping.tagline}`);
  console.log(`  ${bp.use_case_mapping.description.trim()}`);

  // Day in the life
  console.log(bold("\nDay in the Life"));
  console.log(`  ${bp.use_case_mapping.day_in_the_life.trim()}`);

  // Personality
  console.log(bold("\nPersonality"));
  console.log(`  Tone:          ${bp.personality.tone}`);
  console.log(`  Style:         ${bp.personality.style}`);
  console.log(`  Relationship:  ${bp.personality.relationship}`);
  console.log(`  Boundaries:    ${bp.personality.boundaries}`);

  // Security
  console.log(bold("\nSecurity"));
  console.log(`  Posture:        ${bp.security_posture.posture}`);
  console.log(`  Egress:         ${bp.security_posture.egress}`);
  console.log(`  Identity mount: ${bp.security_posture.identity_mount}`);

  // Egress Domains
  console.log(bold("\nEgress Domains"));
  if (bp.security_posture.egress_domains.length > 0) {
    for (const domain of bp.security_posture.egress_domains) {
      console.log(`  ${chalk.cyan(domain)}`);
    }
  } else {
    console.log(`  ${dim("none")}`);
  }

  // Tools
  console.log(bold("\nTools"));
  for (const tool of bp.toolbelt.tools) {
    const req = tool.required ? chalk.green("required") : dim("optional");
    console.log(`  ${chalk.cyan(tool.name)} [${tool.category}] ${req}`);
    console.log(`    ${dim(tool.description)}`);
  }

  // Skills
  console.log(bold("\nSkills"));
  for (const skill of bp.toolbelt.skills) {
    const req = skill.required ? chalk.green("required") : dim("optional");
    console.log(`  ${chalk.cyan(skill.name)} ${req}`);
    console.log(`    ${dim(skill.description)}`);
  }

  // Cron
  console.log(bold("\nCron Schedule"));
  console.log(`  Heartbeat:     ${bp.cron_config.heartbeat || dim("none")}`);
  console.log(`  Work session:  ${bp.cron_config.work_session || dim("none")}`);
  console.log(`  Morning brief: ${bp.cron_config.morning_brief || dim("none")}`);

  // Autonomy
  console.log(bold("\nAutonomy"));
  console.log(`  Default level:      ${bp.autonomy_model.default}`);
  console.log(`  Requires approval:  ${bp.autonomy_model.requires_approval.join(", ")}`);

  // Memory
  console.log(bold("\nMemory Policy"));
  console.log(`  Hot: ${bp.memory_policy.hot_max} / ${bp.memory_policy.hot_retention}`);
  console.log(`  Warm: ${bp.memory_policy.warm_retention}  Cold: ${bp.memory_policy.cold_retention}`);
  console.log(`  Summarization: ${bp.memory_policy.summarization}`);

  // Integrations
  console.log(bold("\nIntegrations"));
  console.log(`  Required:     ${bp.integration_requirements.required.join(", ")}`);
  console.log(`  Recommended:  ${bp.integration_requirements.recommended.join(", ")}`);
  if (bp.integration_requirements.optional.length > 0) {
    console.log(`  Optional:     ${bp.integration_requirements.optional.join(", ")}`);
  }

  // Channels
  console.log(bold("\nChannels"));
  console.log(`  Supported: ${bp.channels.supported.join(", ")}`);
  console.log(`  Default:   ${bp.channels.default}`);

  // Monitoring
  console.log(bold("\nMonitoring"));
  console.log(`  Heartbeat:    ${bp.monitoring.heartbeat_frequency}`);
  console.log(`  Checks:       ${bp.monitoring.checks.join(", ")}`);
  console.log(`  Quiet hours:  ${bp.monitoring.quiet_hours}`);
  console.log(`  Alert on:     ${bp.monitoring.alert_on.join(", ")}`);

  // Model routing
  console.log(bold("\nModel Routing"));
  console.log(`  Default:     ${bp.model_routing_strategy.default_provider}`);
  console.log(`  Local model: ${bp.model_routing_strategy.local_model_preference}`);
  console.log(`  Escalate:    ${bp.model_routing_strategy.cloud_escalation_categories.join(", ")}`);

  console.log("");
}

export function registerDesignCommands(program: Command, defaultDeployDir: string): void {
  program
    .command("init")
    .description("Interactive setup — choose blueprint, configure, forge agent")
    .option("--guided", "Run the guided setup wizard (default)")
    .option("--smart", "AI-powered config inference via local Ollama")
    .option("-b, --blueprint <name>", "Pre-select a blueprint by name")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--air-gapped", "Run in air-gapped mode (no internet)")
    .option("--ollama-model <model>", "Ollama model for --smart inference")
    .action(async (opts: {
      guided?: boolean;
      smart?: boolean;
      blueprint?: string;
      deployDir: string;
      airGapped?: boolean;
      ollamaModel?: string;
    }) => {
      try {
        const prompter = await createInquirerPrompter();

        // Step 1: Collect answers via smart inference or guided wizard
        const answers = opts.smart
          ? await runSmartInference(prompter, {
              deployDir: opts.deployDir,
              ollamaModel: opts.ollamaModel,
            })
          : await runWizard(prompter, {
              blueprintName: opts.blueprint,
              deployDir: opts.deployDir,
              airGapped: opts.airGapped,
            });

        // Step 2: Generate deployment bundle
        const spinner = ora("Generating config…");
        spinner.start();

        const bundle = generateBundle(answers);

        // Step 3: Validate against all 14 landmine rules
        const report = validateBundle(bundle);
        if (!report.valid) {
          spinner.fail("Config validation failed");
          for (const err of report.errors) {
            console.error(chalk.red(`  ✘ ${err.rule}: ${err.message}`));
          }
          throw new CommandError("", 1);
        }

        // Step 4: Write files atomically
        const files = bundleToFiles(bundle, answers.blueprint, answers.customizationAnswers);
        const result = writeBundle(answers.deployDir, files);

        spinner.succeed(`Config written to ${result.deployDir}`);

        // Show warnings if any
        for (const warn of report.warnings) {
          console.log(chalk.yellow(`  ⚠ ${warn.rule}: ${warn.message}`));
        }

        console.log(chalk.green(`\n✔ Agent forged successfully`));
        console.log(chalk.dim(`  ${result.written.length} files written`));
        console.log(chalk.dim(`  All 14 landmine rules passed`));
        console.log(chalk.dim(`\n  Next: clawhq up`));
      } catch (error) {
        if (error instanceof CommandError) throw error;
        if (error instanceof WizardAbortError || error instanceof SmartInferenceAbortError) {
          console.log(chalk.yellow("\nSetup cancelled."));
          throw new CommandError("", 0);
        }
        console.error(renderError(error));
        throw new CommandError("", 1);
      }
    });

  const blueprint = program.command("blueprint").description("Browse and preview blueprints");

  blueprint
    .command("list")
    .description("Browse available blueprints")
    .action(async () => {
      const loaded = loadAllBuiltinBlueprints();
      if (loaded.length === 0) {
        console.log(chalk.yellow("No blueprints found."));
        throw new CommandError("", 1);
      }

      console.log(chalk.bold("\nAvailable Blueprints\n"));
      for (const { blueprint: bp } of loaded) {
        const slug = bp.name.toLowerCase().replace(/\s+/g, "-");
        console.log(
          `  ${chalk.bold.cyan(slug)}  ${chalk.dim("—")}  ${bp.use_case_mapping.tagline}`,
        );
        console.log(
          `    ${chalk.dim(`Replaces: ${bp.use_case_mapping.replaces}`)}`,
        );
        console.log(
          `    ${chalk.dim(`Security: ${bp.security_posture.posture} · Egress: ${bp.security_posture.egress} · Autonomy: ${bp.autonomy_model.default}`)}`,
        );
        console.log("");
      }

      console.log(chalk.dim(`  ${loaded.length} blueprints available`));
      console.log(chalk.dim("  Use: clawhq blueprint preview <name>\n"));
    });

  blueprint
    .command("preview")
    .description("Preview a blueprint's operational design")
    .argument("<name>", "Blueprint name")
    .action(async (name: string) => {
      try {
        const { blueprint: bp } = loadBlueprint(name);
        printBlueprintPreview(bp);
      } catch (error) {
        console.error(renderError(error));
        throw new CommandError("", 1);
      }
    });

  blueprint
    .command("validate")
    .description("Validate a blueprint YAML file against the specification")
    .argument("<file>", "Path to blueprint YAML file")
    .action(async (file: string) => {
      const resolved = resolve(file);
      if (!existsSync(resolved)) {
        console.error(chalk.red(`\n  ✘ File not found: ${resolved}\n`));
        throw new CommandError("", 1);
      }

      const stat = statSync(resolved);
      if (stat.size > 256 * 1024) {
        console.error(chalk.red(`\n  ✘ File exceeds 256 KB limit (${stat.size} bytes)\n`));
        throw new CommandError("", 1);
      }

      const content = readFileSync(resolved, "utf-8");
      let parsed: unknown;
      try {
        parsed = yamlParse(content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`\n  ✘ YAML parse error: ${msg}\n`));
        throw new CommandError("", 1);
      }

      if (parsed === null || parsed === undefined || typeof parsed !== "object" || Array.isArray(parsed)) {
        console.error(chalk.red("\n  ✘ Blueprint must be a YAML mapping (object), not a scalar or array\n"));
        throw new CommandError("", 1);
      }

      const report = validateBlueprint(parsed as Record<string, unknown>);
      const passed = report.results.filter((r) => r.passed).length;

      console.log(`\nValidating: ${chalk.bold(file)}\n`);
      console.log(`  ${chalk.green("✓")} ${passed} checks passed`);

      if (report.warnings.length > 0) {
        console.log(`  ${chalk.yellow("⚠")} ${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"}`);
        for (const w of report.warnings) {
          console.log(`    ${chalk.dim("-")} ${chalk.yellow(w.check)}: ${w.message}`);
        }
      }

      if (report.errors.length > 0) {
        console.log(`  ${chalk.red("✘")} ${report.errors.length} error${report.errors.length === 1 ? "" : "s"}`);
        for (const e of report.errors) {
          console.log(`    ${chalk.dim("-")} ${chalk.red(e.check)}: ${e.message}`);
        }
        console.log(chalk.red(`\nBlueprint is invalid (${report.errors.length} error${report.errors.length === 1 ? "" : "s"}).\n`));
        throw new CommandError("", 1);
      }

      if (report.warnings.length > 0) {
        console.log(chalk.green(`\nBlueprint is valid`) + chalk.dim(` (${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"}).\n`));
      } else {
        console.log(chalk.green(`\nBlueprint is valid.\n`));
      }
    });
}
