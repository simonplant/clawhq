import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import chalk from "chalk";
import type { Command } from "commander";
import ora from "ora";
import { parseDocument, parse as yamlParse } from "yaml";

import {
  loadAllBuiltinBlueprints,
  loadBlueprint,
  validateBlueprint,
} from "../../design/blueprints/index.js";
import type { Blueprint } from "../../design/blueprints/index.js";
import {
  compile,
  getDomains,
  getProvider,
  getProvidersForDomain,
  loadAllProfiles,
} from "../../design/catalog/index.js";
import {
  createInquirerPrompter,
  isCompositionConfig,
  loadAndCompileComposition,
  loadConfigFile,
  runSmartInference,
  runWizard,
  writeBundle,
} from "../../design/configure/index.js";
import { CommandError } from "../errors.js";
import { renderError } from "../ux.js";

import {
  applyEnsureFreshResult,
  ensureFreshOrReset,
  forgeFromAnswers,
  translateInitError,
} from "./init-run.js";

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
  console.log(`  Local model: ${bp.model_routing_strategy.local_model_preference ?? "(inherits OLLAMA_DEFAULT_MODEL)"}`);

  console.log("");
}

export function registerDesignCommands(program: Command, defaultDeployDir: string): void {
  program
    .command("init")
    .description("Interactive setup — choose blueprint, configure, forge agent")
    .option("--guided", "Run the guided setup wizard (default)")
    .option("--smart", "AI-powered config inference via local Ollama")
    .option("-c, --config <file>", "Non-interactive: load config from YAML file")
    .option("-b, --blueprint <name>", "Pre-select a blueprint by name")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--air-gapped", "Run in air-gapped mode (no internet)")
    .option("--ollama-model <model>", "Ollama model for --smart inference")
    .option("--reset", "Archive the existing deployment and re-forge from scratch")
    .action(async (opts: {
      guided?: boolean;
      smart?: boolean;
      config?: string;
      blueprint?: string;
      deployDir: string;
      airGapped?: boolean;
      ollamaModel?: string;
      reset?: boolean;
    }) => {
      try {
        // Protective guard: refuse to clobber an existing deployment unless
        // --reset is passed. See init-run.ts for rationale.
        applyEnsureFreshResult(
          ensureFreshOrReset(opts.deployDir, opts.reset === true),
          opts.deployDir,
        );

        // Legacy paths: --smart and --blueprint use the blueprint pipeline.
        if (opts.smart || opts.blueprint) {
          const prompter = await createInquirerPrompter();
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
          await forgeFromAnswers(answers);
          return;
        }

        if (opts.config) {
          // Composition configs compile directly; legacy blueprint configs
          // go through the shared forge pipeline.
          if (isCompositionConfig(opts.config)) {
            const compiled = loadAndCompileComposition(opts.config);
            console.log(chalk.green(`\n✔ Composition loaded from ${opts.config}`));
            console.log(chalk.dim(`  Profile:   ${compiled.profile.name}`));
            console.log(chalk.dim(`  Deploy to: ${opts.deployDir}`));

            const spinner = ora("Writing workspace…");
            spinner.start();
            const result = writeBundle(opts.deployDir, compiled.files);
            spinner.succeed(`Workspace written to ${result.deployDir}`);
            console.log(chalk.dim(`  ${result.written.length} files written`));
            console.log(chalk.green(`\n✔ Agent forged: ${compiled.profile.name}`));
            console.log(chalk.dim(`\n  Next: clawhq build -d ${opts.deployDir}`));
            return;
          }

          const answers = loadConfigFile(opts.config);
          console.log(chalk.green(`\n✔ Config loaded from ${opts.config}`));
          await forgeFromAnswers(answers);
          return;
        }

        // Interactive: composition-based wizard (primary path)
        const { select, input } = await import("@inquirer/prompts");

        console.log(chalk.bold("\n⚡ ClawHQ — Set Up Your Agent\n"));

        // Step 1: Pick profile
        const profiles = loadAllProfiles();
        const profileId = await select({
          message: "What should your agent do? (mission profile)",
          choices: profiles.map((p) => ({
            name: `${p.name} — ${p.description}`,
            value: p.id,
          })),
        });
        const profile = profiles.find((p) => p.id === profileId);
        if (!profile) throw new Error(`Profile ${profileId} not found`);

        // Step 2: Pick providers for each capability domain
        const providerSelections: Record<string, string> = {};
        const categoryToDomain: Record<string, string> = {
          communication: "email",
          productivity: "calendar",
          research: "search",
          core: "",
          data: "",
        };

        const seenDomains = new Set<string>();
        for (const tool of profile.tools) {
          const domain = categoryToDomain[tool.category];
          if (!domain || seenDomains.has(domain)) continue;
          seenDomains.add(domain);

          const available = getProvidersForDomain(domain);
          if (available.length === 0) continue;

          if (available.length === 1) {
            const onlyProvider = available[0];
            if (onlyProvider) {
              providerSelections[domain] = onlyProvider.id;
              console.log(chalk.dim(`  ${domain}: ${onlyProvider.name} (only option)`));
            }
          } else {
            providerSelections[domain] = await select({
              message: `${domain.charAt(0).toUpperCase() + domain.slice(1)} provider:`,
              choices: available.map((p) => ({
                name: `${p.name} (${p.protocol})`,
                value: p.id,
                description: p.setupNotes,
              })),
            });
          }
        }

        // Tasks provider
        const taskProviders = getProvidersForDomain("tasks");
        if (taskProviders.length > 0) {
          providerSelections["tasks"] = await select({
            message: "Tasks provider:",
            choices: taskProviders.map((p) => ({
              name: `${p.name} (${p.protocol})`,
              value: p.id,
            })),
          });
        }

        // Step 4: User info
        const userName = await input({ message: "Your name:", default: "User" });
        const timezone = await input({
          message: "Timezone:",
          default: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });

        // Step 5: Compile and write
        console.log(chalk.dim("\nForging agent…"));
        const spinner = ora("Compiling workspace…");
        spinner.start();

        const compiled = compile(
          { profile: profileId, providers: providerSelections },
          { name: userName, timezone, communication: "brief" },
          opts.deployDir,
        );

        const result = writeBundle(opts.deployDir, compiled.files);

        spinner.succeed(`Agent forged: ${compiled.profile.name}`);
        console.log(chalk.dim(`  ${result.written.length} files written to ${result.deployDir}`));
        console.log(chalk.green(`\n✔ Agent ready`));
        console.log(chalk.dim(`\n  Next: clawhq build -d ${opts.deployDir}`));
        console.log(chalk.dim(`  Then: clawhq up -d ${opts.deployDir}`));
      } catch (error) {
        throw translateInitError(error);
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

  // ── Compose Commands (Mission Profile × Personality) ──────────────────────

  const compose = program.command("compose").description("Mission profile composition — design your agent");

  compose
    .command("profiles")
    .description("List available mission profiles (WHAT your agent does)")
    .action(async () => {
      const profiles = loadAllProfiles();
      if (profiles.length === 0) {
        console.log(chalk.yellow("No profiles found."));
        return;
      }

      console.log(chalk.bold("\nMission Profiles — WHAT your agent does\n"));
      for (const p of profiles) {
        console.log(`  ${chalk.bold.cyan(p.id)}  ${chalk.dim("—")}  ${p.description}`);
        const toolNames = p.tools.map((t) => t.name).join(", ");
        console.log(chalk.dim(`    Tools: ${toolNames} · Skills: ${p.skills.join(", ")} · Security: ${p.security_posture}`));
        console.log("");
      }
      console.log(chalk.dim(`  ${profiles.length} profiles available`));
      console.log(chalk.dim("  Preview: clawhq compose preview <profile>\n"));
    });

  compose
    .command("providers")
    .description("List available integration providers (a la carte menu)")
    .argument("[domain]", "Filter by domain (email, calendar, tasks, search, etc.)")
    .action(async (domain?: string) => {
      const domains = domain ? [domain] : getDomains();

      console.log(chalk.bold("\nIntegration Providers — A La Carte Menu\n"));

      for (const d of domains) {
        const providers = getProvidersForDomain(d);
        if (providers.length === 0) continue;

        console.log(chalk.bold(`  ${d.charAt(0).toUpperCase() + d.slice(1)}`));
        for (const p of providers) {
          const authLabel = p.auth === "none" ? chalk.green("no auth") : chalk.dim(p.auth);
          const egress = p.egressDomains.length > 0 ? p.egressDomains.join(", ") : chalk.green("local");
          console.log(`    ${chalk.cyan(p.id)}  ${chalk.dim("—")}  ${p.name} (${p.protocol})`);
          console.log(chalk.dim(`      Auth: ${authLabel} · CLI: ${p.cli} · Egress: ${egress}`));
        }
        console.log("");
      }

      const totalProviders = getDomains().reduce((sum, d) => sum + getProvidersForDomain(d).length, 0);
      console.log(chalk.dim(`  ${totalProviders} providers across ${getDomains().length} domains`));
      console.log(chalk.dim("  Sovereign options marked with no auth / local egress\n"));
    });

  compose
    .command("create")
    .description("Interactive config builder — generates a config file (use 'clawhq init' to set up directly)")
    .option("-o, --output <path>", "Output config file path", "./config.yaml")
    .action(async (opts: { output: string }) => {
      try {
        const { select, input } = await import("@inquirer/prompts");

        console.log(chalk.bold("\n🔧 ClawHQ Compose — Build Your Agent\n"));
        console.log(chalk.dim("Tip: use 'clawhq init' to set up directly without a config file.\n"));

        // Step 1: Pick profile
        const profiles = loadAllProfiles();
        const profileId = await select({
          message: "Mission profile (WHAT your agent does):",
          choices: profiles.map((p) => ({
            name: `${p.name} — ${p.description}`,
            value: p.id,
          })),
        });

        // Step 2: Pick providers for each domain the profile needs
        const profile = profiles.find((p) => p.id === profileId);
        if (!profile) throw new Error(`Profile ${profileId} not found`);
        const domains = [...new Set(profile.tools.map((t) => t.category))];
        const providerSelections: Record<string, string> = {};

        // Map tool categories to provider domains
        const categoryToDomain: Record<string, string> = {
          communication: "email",
          productivity: "calendar",
          research: "search",
          core: "",
        };

        for (const category of domains) {
          const domain = categoryToDomain[category];
          if (!domain) continue;

          const available = getProvidersForDomain(domain);
          if (available.length === 0) continue;

          if (available.length === 1) {
            const onlyProvider = available[0];
            if (onlyProvider) {
              providerSelections[domain] = onlyProvider.id;
              console.log(chalk.dim(`  ${domain}: ${onlyProvider.name} (only option)`));
            }
          } else {
            providerSelections[domain] = await select({
              message: `${domain.charAt(0).toUpperCase() + domain.slice(1)} provider:`,
              choices: available.map((p) => ({
                name: `${p.name} (${p.protocol})`,
                value: p.id,
                description: p.setupNotes,
              })),
            });
          }
        }

        // Tasks provider
        const taskProviders = getProvidersForDomain("tasks");
        if (taskProviders.length > 0) {
          providerSelections["tasks"] = await select({
            message: "Tasks provider:",
            choices: taskProviders.map((p) => ({
              name: `${p.name} (${p.protocol})`,
              value: p.id,
            })),
          });
        }

        // Step 4: User info
        const userName = await input({ message: "Your name:", default: "User" });
        const timezone = await input({
          message: "Timezone:",
          default: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });

        // Step 5: Deploy dir
        const deployDir = await input({
          message: "Deploy directory:",
          default: "~/.clawhq",
        });

        // Generate YAML
        const providerLines = Object.entries(providerSelections)
          .map(([domain, id]) => `  ${domain}: ${id}`)
          .join("\n");

        const yaml = [
          `# Generated by clawhq compose create`,
          `# ${new Date().toISOString().split("T")[0]}`,
          ``,
          `profile: ${profileId}`,
          `deploy_dir: ${deployDir}`,
          ``,
          `providers:`,
          providerLines,
          ``,
          `user:`,
          `  name: ${userName}`,
          `  timezone: ${timezone}`,
          `  communication: brief`,
          ``,
          `# Personalize the default tone via soul_overrides (free text). Examples:`,
          `# soul_overrides: |`,
          `#   Humor is welcome. Swear when it fits. Be brutally honest.`,
          ``,
          `# Uncomment to configure Telegram:`,
          `# channels:`,
          `#   telegram:`,
          `#     bot_token: "your-bot-token"`,
          ``,
        ].join("\n");

        // Write config
        const { writeFileSync } = await import("node:fs");
        const { resolve } = await import("node:path");
        const outPath = resolve(opts.output);
        writeFileSync(outPath, yaml, "utf-8");

        console.log(chalk.green(`\n✔ Config written to ${outPath}`));
        console.log(chalk.dim(`  Profile:   ${profileId}`));
        console.log(chalk.dim(`  Providers: ${Object.values(providerSelections).join(", ")}`));
        console.log(chalk.bold(`\nNext steps:`));
        console.log(`  1. ${chalk.bold(`clawhq install -d ${deployDir}`)}`);
        console.log(`  2. ${chalk.bold(`clawhq init --config ${outPath} -d ${deployDir}`)}`);
        console.log(`  3. ${chalk.bold(`clawhq build -d ${deployDir}`)}`);
        console.log(`  4. ${chalk.bold(`clawhq up -d ${deployDir}`)}`);
        console.log("");
      } catch (error) {
        if (error instanceof Error && error.name === "ExitPromptError") {
          console.log(chalk.yellow("\nSetup cancelled."));
          throw new CommandError("", 0);
        }
        console.error(renderError(error));
        throw new CommandError("", 1);
      }
    });

  compose
    .command("preview")
    .description("Preview a profile composition (the canonical ClawHQ personality ships with every agent)")
    .argument("<profile>", "Mission profile ID")
    .action(async (profileId: string) => {
      try {
        const result = compile(
          { profile: profileId },
          { name: "User", timezone: "UTC", communication: "brief" },
          "~/.clawhq",
        );

        const { profile, personality } = result;
        const dim = chalk.dim;
        const bold = chalk.bold;

        console.log(bold(`\n${profile.name}`));
        console.log(dim("═".repeat(60)));

        console.log(bold("\nPersonality (canonical ClawHQ vector — not configurable)"));
        console.log(`  ${personality.description}`);
        console.log(`  ${dim(`Emoji: ${personality.identity.emoji}  Vibe: ${personality.identity.vibe}`)}`);

        console.log(bold("\nMission"));
        console.log(`  ${profile.description}`);
        console.log(`  ${dim(`Replaces: ${profile.replaces}`)}`);

        console.log(bold("\nTools"));
        for (const t of profile.tools) {
          const req = t.required ? chalk.green("required") : dim("optional");
          console.log(`  ${chalk.cyan(t.name)} [${t.category}] ${req}`);
        }

        console.log(bold("\nSkills"));
        console.log(`  ${profile.skills.join(", ") || dim("none")}`);

        console.log(bold("\nAutonomy"));
        console.log(`  Default: ${profile.autonomy_default}`);
        for (const d of profile.delegation) {
          const icon = d.tier === "execute" ? chalk.green("●") : d.tier === "propose" ? chalk.yellow("●") : chalk.red("●");
          console.log(`  ${icon} ${d.action} [${d.tier}]`);
        }

        console.log(bold("\nSecurity"));
        console.log(`  Posture: ${profile.security_posture}`);
        console.log(`  Egress:  ${profile.egress_domains.join(", ") || dim("none")}`);

        console.log(bold("\nVoice"));
        for (const v of personality.voice_examples.slice(0, 3)) {
          console.log(`  ${dim(">")} ${v}`);
        }

        console.log(bold("\nDay in the Life"));
        console.log(`  ${profile.day_in_the_life.trim()}`);

        console.log("");
      } catch (error) {
        console.error(renderError(error));
        throw new CommandError("", 1);
      }
    });

  compose
    .command("set-provider")
    .description("Set composition.providers.<domain> in clawhq.yaml (e.g. calendar icloud-cal)")
    .argument("<domain>", "Provider domain (email, calendar, tasks, search, etc.)")
    .argument("<id>", "Provider id (run `clawhq compose providers <domain>` to list)")
    .option("-d, --deploy-dir <path>", "Deployment directory", join(homedir(), ".clawhq"))
    .option("--dry-run", "Print the change without writing")
    .action(async (domain: string, id: string, opts: { deployDir: string; dryRun?: boolean }) => {
      try {
        const provider = getProvider(id);
        if (!provider) {
          throw new CommandError(`Unknown provider id: ${id}. Run \`clawhq compose providers ${domain}\` to list available.`, 1);
        }
        if (provider.domain !== domain) {
          throw new CommandError(
            `Provider ${id} is for domain "${provider.domain}", not "${domain}". Pick an id from \`clawhq compose providers ${domain}\`.`,
            1,
          );
        }

        const configPath = resolve(opts.deployDir, "clawhq.yaml");
        if (!existsSync(configPath)) {
          throw new CommandError(`No clawhq.yaml at ${configPath}. Run \`clawhq init\` first.`, 1);
        }

        const doc = parseDocument(readFileSync(configPath, "utf-8"));
        const path = ["composition", "providers", domain];
        const previous = doc.getIn(path);
        if (previous === id) {
          console.log(chalk.dim(`  composition.providers.${domain} is already "${id}" — no change.`));
          return;
        }
        doc.setIn(path, id);

        const output = doc.toString();
        if (opts.dryRun) {
          console.log(chalk.dim(`  (dry-run) would set composition.providers.${domain} = ${id} (was ${previous ?? "unset"})`));
          return;
        }

        const { writeFileSync } = await import("node:fs");
        writeFileSync(configPath, output, "utf-8");
        console.log(chalk.green(`✔ composition.providers.${domain}: ${previous ?? "unset"} → ${id}`));
        console.log(chalk.dim(`  Next: clawhq apply   (regenerates openclaw.json, allowlist, env)`));
      } catch (error) {
        if (error instanceof CommandError) throw error;
        console.error(renderError(error));
        throw new CommandError("", 1);
      }
    });
}
