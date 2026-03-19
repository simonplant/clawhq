/**
 * Interactive setup wizard for `clawhq init --guided`.
 *
 * Guides a non-technical user from blueprint selection to a valid config:
 * 1. Choose a blueprint
 * 2. Answer customization questions (if blueprint defines them)
 * 3. Select messaging channel
 * 4. Detect air-gapped mode
 * 5. Configure model routing (local/cloud)
 * 6. Set gateway port and deploy directory
 * 7. Collect integration credentials
 * 8. Confirm and generate
 *
 * Air-gapped mode: skips cloud model selection, remote validation, and any
 * cloud-dependent steps. Everything works offline with local models.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import chalk from "chalk";

import { GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";
import { allTemplatesToChoices } from "../blueprints/choice.js";
import {
  loadAllBuiltinBlueprints,
  loadBlueprint,
} from "../blueprints/loader.js";
import type { Blueprint, BlueprintChoice } from "../blueprints/types.js";

import type { WizardAnswers, WizardOptions } from "./types.js";

// ── Prompter Interface ───────────────────────────────────────────────────────

/** Abstraction over interactive prompts for testability. */
export interface Prompter {
  select<T>(opts: { message: string; choices: { name: string; value: T; description?: string }[] }): Promise<T>;
  input(opts: { message: string; default?: string }): Promise<string>;
  confirm(opts: { message: string; default?: boolean }): Promise<boolean>;
}

// ── Default Prompter (uses @inquirer/prompts) ────────────────────────────────

/** Create a prompter backed by @inquirer/prompts. */
export async function createInquirerPrompter(): Promise<Prompter> {
  const { select, input, confirm } = await import("@inquirer/prompts");
  return {
    select: <T>(opts: { message: string; choices: { name: string; value: T; description?: string }[] }) =>
      select<T>(opts),
    input: (opts: { message: string; default?: string }) =>
      input(opts),
    confirm: (opts: { message: string; default?: boolean }) =>
      confirm(opts),
  };
}

// ── Wizard ───────────────────────────────────────────────────────────────────

const DEFAULT_DEPLOY_DIR = join(homedir(), ".clawhq");
const DEFAULT_GATEWAY_PORT = GATEWAY_DEFAULT_PORT;
const DEFAULT_LOCAL_MODEL = "llama3:8b";

/**
 * Run the interactive setup wizard.
 *
 * @param prompter — Prompt implementation (production: inquirer, tests: mock)
 * @param options — Pre-filled options to skip certain steps
 * @returns Completed wizard answers ready for config generation
 */
export async function runWizard(
  prompter: Prompter,
  options: WizardOptions = {},
): Promise<WizardAnswers> {
  console.log(chalk.bold("\n🔧 ClawHQ Setup Wizard\n"));
  console.log(chalk.dim("Let's forge your agent. This takes about 2 minutes.\n"));

  // Step 1: Blueprint selection
  const { blueprint, blueprintPath } = await selectBlueprint(prompter, options);
  console.log(chalk.green(`\n✓ Blueprint: ${blueprint.name}`));

  // Step 2: Customization questions (if blueprint defines them)
  const customizationAnswers = await askCustomizationQuestions(prompter, blueprint);

  // Step 3: Channel selection
  const channel = await selectChannel(prompter, blueprint);
  console.log(chalk.green(`✓ Channel: ${channel}`));

  // Step 4: Air-gapped mode detection
  const airGapped = options.airGapped ?? await detectAirGapped(prompter);

  // Step 5: Model routing
  const { modelProvider, localModel } = await configureModels(
    prompter,
    blueprint,
    airGapped,
  );
  console.log(chalk.green(`✓ Model: ${modelProvider === "local" ? localModel : "cloud provider"}`));

  // Step 6: Deploy directory and gateway port
  const deployDir = options.deployDir ?? await prompter.input({
    message: "Deploy directory:",
    default: DEFAULT_DEPLOY_DIR,
  });

  const portStr = await prompter.input({
    message: "Gateway port:",
    default: String(DEFAULT_GATEWAY_PORT),
  });
  const gatewayPort = parseInt(portStr, 10) || DEFAULT_GATEWAY_PORT;

  // Step 7: Integration credentials
  const integrations = await collectIntegrations(prompter, blueprint, airGapped);

  // Step 8: Confirmation
  console.log(chalk.bold("\n📋 Configuration Summary"));
  console.log(chalk.dim("─".repeat(40)));
  console.log(`  Blueprint:  ${blueprint.name}`);
  console.log(`  Channel:    ${channel}`);
  console.log(`  Model:      ${modelProvider === "local" ? `local (${localModel})` : "cloud"}`);
  console.log(`  Deploy to:  ${deployDir}`);
  console.log(`  Port:       ${gatewayPort}`);
  console.log(`  Air-gapped: ${airGapped ? "yes" : "no"}`);
  const intCount = Object.keys(integrations).length;
  if (intCount > 0) {
    console.log(`  Integrations: ${intCount} configured`);
  }
  console.log(chalk.dim("─".repeat(40)));

  const confirmed = await prompter.confirm({
    message: "Generate config and forge agent?",
    default: true,
  });

  if (!confirmed) {
    throw new WizardAbortError("Setup cancelled by user");
  }

  return {
    blueprint,
    blueprintPath,
    channel,
    modelProvider,
    localModel,
    gatewayPort,
    deployDir,
    airGapped,
    integrations,
    customizationAnswers,
  };
}

// ── Wizard Steps ─────────────────────────────────────────────────────────────

async function selectBlueprint(
  prompter: Prompter,
  options: WizardOptions,
): Promise<{ blueprint: Blueprint; blueprintPath: string }> {
  // If pre-selected, load directly
  if (options.blueprintName) {
    const loaded = loadBlueprint(options.blueprintName);
    return { blueprint: loaded.blueprint, blueprintPath: loaded.sourcePath };
  }

  // Load all built-in blueprints
  const loaded = loadAllBuiltinBlueprints();
  if (loaded.length === 0) {
    throw new WizardError("No blueprints found. Ensure configs/blueprints/ contains blueprint YAML files.");
  }

  const choices = allTemplatesToChoices(loaded);
  const choiceItems = choices.map((c: BlueprintChoice) => ({
    name: `${c.name} — ${c.tagline}`,
    value: c.value,
    description: c.description,
  }));

  const selected = await prompter.select({
    message: "Choose a blueprint for your agent:",
    choices: choiceItems,
  });

  // Find the loaded blueprint matching the selection
  const match = loaded.find(
    (l) => l.blueprint.name.toLowerCase().replace(/\s+/g, "-") === selected,
  );
  if (!match) {
    throw new WizardError(`Blueprint "${selected}" not found after selection`);
  }

  return { blueprint: match.blueprint, blueprintPath: match.sourcePath };
}

async function askCustomizationQuestions(
  prompter: Prompter,
  blueprint: Blueprint,
): Promise<Record<string, string>> {
  const questions = blueprint.customization_questions;
  if (!questions || questions.length === 0) {
    return {};
  }

  console.log(chalk.bold("\n📝 Customize your agent"));

  const answers: Record<string, string> = {};

  for (const q of questions) {
    let answer: string;

    if (q.type === "select" && q.options && q.options.length > 0) {
      answer = await prompter.select<string>({
        message: q.prompt,
        choices: q.options.map((opt) => ({
          name: opt,
          value: opt,
        })),
      });
    } else {
      answer = await prompter.input({
        message: q.prompt,
        default: q.default,
      });
    }

    answers[q.id] = answer;
    console.log(chalk.green(`  ✓ ${q.id}: ${answer}`));
  }

  return answers;
}

async function selectChannel(
  prompter: Prompter,
  blueprint: Blueprint,
): Promise<string> {
  const supported = blueprint.channels.supported;

  if (supported.length === 1 && supported[0] !== undefined) {
    return supported[0];
  }

  return prompter.select({
    message: "Choose your messaging channel:",
    choices: supported.map((ch) => ({
      name: ch.charAt(0).toUpperCase() + ch.slice(1),
      value: ch,
    })),
  });
}

async function detectAirGapped(prompter: Prompter): Promise<boolean> {
  return prompter.confirm({
    message: "Running in air-gapped mode (no internet)?",
    default: false,
  });
}

async function configureModels(
  prompter: Prompter,
  blueprint: Blueprint,
  airGapped: boolean,
): Promise<{ modelProvider: "local" | "cloud"; localModel: string }> {
  // Air-gapped mode: local only, no choice
  if (airGapped) {
    const localModel = await prompter.input({
      message: "Local model (Ollama):",
      default: blueprint.model_routing_strategy.local_model_preference || DEFAULT_LOCAL_MODEL,
    });
    return { modelProvider: "local", localModel };
  }

  const modelProvider = await prompter.select<"local" | "cloud">({
    message: "Model routing:",
    choices: [
      { name: "Local (Ollama) — data stays on your machine", value: "local" as const },
      { name: "Cloud — better quality, data leaves machine", value: "cloud" as const },
    ],
  });

  const localModel = modelProvider === "local"
    ? await prompter.input({
        message: "Local model (Ollama):",
        default: blueprint.model_routing_strategy.local_model_preference || DEFAULT_LOCAL_MODEL,
      })
    : DEFAULT_LOCAL_MODEL;

  return { modelProvider, localModel };
}

async function collectIntegrations(
  prompter: Prompter,
  blueprint: Blueprint,
  airGapped: boolean,
): Promise<Record<string, Record<string, string>>> {
  const integrations: Record<string, Record<string, string>> = {};
  const required = blueprint.integration_requirements.required;
  const recommended = blueprint.integration_requirements.recommended;

  // Required integrations — must configure
  for (const name of required) {
    // In air-gapped mode, skip cloud-dependent integrations
    if (airGapped && isCloudIntegration(name)) {
      console.log(chalk.yellow(`  ⊘ Skipping ${name} (cloud-dependent, air-gapped mode)`));
      continue;
    }

    console.log(chalk.bold(`\n  Configure ${name} (required):`));
    const creds = await collectCredentialsForIntegration(prompter, name);
    if (Object.keys(creds).length > 0) {
      integrations[name] = creds;
    }
  }

  // Recommended integrations — optional
  for (const name of recommended) {
    if (airGapped && isCloudIntegration(name)) {
      console.log(chalk.yellow(`  ⊘ Skipping ${name} (cloud-dependent, air-gapped mode)`));
      continue;
    }

    const configure = await prompter.confirm({
      message: `Configure ${name}? (recommended)`,
      default: false,
    });

    if (configure) {
      const creds = await collectCredentialsForIntegration(prompter, name);
      if (Object.keys(creds).length > 0) {
        integrations[name] = creds;
      }
    }
  }

  return integrations;
}

/** Collect credentials for a single integration. */
async function collectCredentialsForIntegration(
  prompter: Prompter,
  integration: string,
): Promise<Record<string, string>> {
  const fields = integrationFields(integration);
  const creds: Record<string, string> = {};

  for (const field of fields) {
    const value = await prompter.input({
      message: `  ${field.label}:`,
      default: field.default,
    });
    if (value.trim()) {
      creds[field.key] = value.trim();
    }
  }

  return creds;
}

// ── Integration Credential Templates ─────────────────────────────────────────

interface CredentialField {
  readonly key: string;
  readonly label: string;
  readonly default?: string;
}

/** Known credential fields per integration type. */
function integrationFields(integration: string): CredentialField[] {
  const templates: Record<string, CredentialField[]> = {
    email: [
      { key: "IMAP_HOST", label: "IMAP host" },
      { key: "IMAP_USER", label: "IMAP username" },
      { key: "IMAP_PASS", label: "IMAP password" },
      { key: "SMTP_HOST", label: "SMTP host" },
      { key: "SMTP_USER", label: "SMTP username" },
      { key: "SMTP_PASS", label: "SMTP password" },
    ],
    calendar: [
      { key: "CALDAV_URL", label: "CalDAV URL" },
      { key: "CALDAV_USER", label: "CalDAV username" },
      { key: "CALDAV_PASS", label: "CalDAV password" },
    ],
    messaging: [
      { key: "BOT_TOKEN", label: "Bot token" },
    ],
    tasks: [
      { key: "API_TOKEN", label: "API token" },
    ],
    notes: [
      { key: "API_TOKEN", label: "API token" },
    ],
  };

  return templates[integration.toLowerCase()] ?? [
    { key: "API_KEY", label: `${integration} API key` },
  ];
}

/** Check if an integration requires cloud connectivity. */
function isCloudIntegration(name: string): boolean {
  // These integrations require outbound network access
  const cloudDeps = new Set([
    "web-search", "tavily", "openai", "anthropic",
    "cloud-storage", "remote-monitoring",
  ]);
  return cloudDeps.has(name.toLowerCase());
}

// ── Errors ───────────────────────────────────────────────────────────────────

/** Wizard encountered an unrecoverable error. */
export class WizardError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WizardError";
  }
}

/** User cancelled the wizard. */
export class WizardAbortError extends WizardError {
  constructor(message: string = "Setup cancelled") {
    super(message);
    this.name = "WizardAbortError";
  }
}
