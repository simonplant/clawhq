/**
 * Smart init orchestrator — `clawhq init --smart`.
 *
 * Takes a plain-language description of user needs, runs local LLM
 * inference via Ollama, presents the proposal for refinement, then
 * generates a validated config bundle.
 *
 * Falls back to the guided questionnaire if Ollama is unavailable.
 */

import { generate, type GeneratedConfig } from "../configure/generate.js";
import { INTEGRATION_DEFS, CLOUD_PROVIDER_DEFS, MODEL_CATEGORIES } from "../configure/steps.js";
import { formatSummary } from "../configure/summary.js";
import { getBuiltInTemplates, getTemplateById } from "../configure/templates.js";
import type {
  CloudProviderSetup,
  IntegrationSetup,
  ModelCategoryPolicy,
  ModelRoutingSetup,
  TemplateChoice,
  WizardAnswers,
  WizardIO,
} from "../configure/types.js";
import { runWizard } from "../configure/wizard.js";
import { writeBundle, type WriteResult } from "../configure/writer.js";

import { OllamaClient } from "./ollama.js";
import { parseInferenceResponse } from "./parser.js";
import { buildSystemPrompt } from "./prompt.js";
import { refineProposal } from "./refine.js";
import type { InferenceResult, OllamaMessage, SmartInitOptions } from "./types.js";

export interface SmartInitResult {
  answers: WizardAnswers;
  config: GeneratedConfig;
  writeResult: WriteResult;
  summary: string;
  usedInference: boolean;
}

/**
 * Run the smart init flow:
 * 1. Check Ollama availability
 * 2. If unavailable, fall back to guided wizard
 * 3. Collect user description
 * 4. Run inference via local LLM
 * 5. Show proposal and allow refinement
 * 6. Collect credentials for selected integrations
 * 7. Generate and validate config
 */
export async function runSmartInit(options: SmartInitOptions): Promise<SmartInitResult> {
  const { io, outputDir, ollamaHost, ollamaModel, validateCredential } = options;

  io.log("ClawHQ Init — AI-Powered Setup");
  io.log("===============================");
  io.log("");

  // Step 1: Check Ollama
  const client = new OllamaClient(ollamaHost, ollamaModel);
  const available = await client.isAvailable();

  if (!available) {
    io.log("Ollama is not available on this machine.");
    io.log("Falling back to guided questionnaire...");
    io.log("");

    const wizardResult = await runWizard(io, outputDir, { validateCredential });
    return {
      ...wizardResult,
      usedInference: false,
    };
  }

  const models = await client.listModels();
  const selectedModel = await client.selectModel();
  io.log(`Using local model: ${selectedModel} (${models.length} model(s) available)`);
  io.log("");

  // Step 2: Collect user description
  io.log("Describe what you want your AI agent to do.");
  io.log("Be specific about: what services to connect, how autonomous it should be,");
  io.log("and any boundaries (things it should never do).");
  io.log("");

  const description = await io.prompt(
    "What do you need?",
  );

  if (!description) {
    io.log("No description provided. Falling back to guided questionnaire...");
    io.log("");
    const wizardResult = await runWizard(io, outputDir, { validateCredential });
    return { ...wizardResult, usedInference: false };
  }

  // Step 3: Run inference
  io.log("");
  io.log("Analyzing your requirements...");

  const templates = await getBuiltInTemplates();
  const systemPrompt = buildSystemPrompt(templates);

  const conversationHistory: OllamaMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: description },
  ];

  let inferenceResult: InferenceResult | null = null;

  try {
    const response = await client.chat(conversationHistory);
    conversationHistory.push({ role: "assistant", content: response });
    inferenceResult = parseInferenceResponse(response, templates);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    io.log(`Inference failed: ${msg}`);
  }

  if (!inferenceResult) {
    io.log("Could not parse inference results. Falling back to guided questionnaire...");
    io.log("");
    const wizardResult = await runWizard(io, outputDir, { validateCredential });
    return { ...wizardResult, usedInference: false };
  }

  // Step 4: Refinement loop
  const refined = await refineProposal(
    io,
    client,
    inferenceResult,
    templates,
    conversationHistory,
  );

  // Step 5: Collect credentials for selected integrations
  io.log("");
  io.log("Credential Setup");
  io.log("─────────────────");
  io.log("");

  const integrations = await collectCredentials(io, refined, validateCredential);

  // Collect cloud provider credentials if needed
  const cloudProviders = await collectCloudCredentials(io, refined, validateCredential);

  // Step 6: Build WizardAnswers and generate config
  const template = await getTemplateById(refined.templateId);
  if (!template) {
    io.log(`Template "${refined.templateId}" not found. Falling back to guided questionnaire...`);
    io.log("");
    const wizardResult = await runWizard(io, outputDir, { validateCredential });
    return { ...wizardResult, usedInference: false };
  }

  const answers = buildWizardAnswers(refined, template, integrations, cloudProviders);

  io.log("");
  io.log("Generating configuration files...");

  const config = generate(answers);

  if (!config.validationPassed) {
    const failures = config.validationResults.filter((r) => r.status === "fail");
    io.log("");
    io.log(`WARNING: Validation failed (${failures.length} rule(s) violated).`);
    for (const f of failures) {
      io.log(`  ${f.rule}: ${f.message}`);
    }
    io.log("");
    io.log("Config will not be written until all validation rules pass.");

    return {
      answers,
      config,
      writeResult: { filesWritten: [], errors: ["Validation failed"] },
      summary: formatSummary(answers, config.validationResults, {
        filesWritten: [],
        errors: ["Validation failed — config not written"],
      }),
      usedInference: true,
    };
  }

  io.log("Validation passed. Writing files...");

  const writeResult = await writeBundle(config.bundle, outputDir);

  if (writeResult.errors.length > 0) {
    io.log("");
    io.log("ERROR: Some files could not be written:");
    for (const e of writeResult.errors) {
      io.log(`  ${e}`);
    }
  }

  const summary = formatSummary(answers, config.validationResults, writeResult);
  io.log(summary);

  return { answers, config, writeResult, summary, usedInference: true };
}

/**
 * Collect credentials for the integrations selected by inference.
 */
async function collectCredentials(
  io: WizardIO,
  result: InferenceResult,
  validateCredential?: (envVar: string, value: string) => Promise<boolean>,
): Promise<IntegrationSetup[]> {
  const integrations: IntegrationSetup[] = [];

  for (const category of result.integrations) {
    const def = INTEGRATION_DEFS.find((d) => d.category === category);
    if (!def) continue;

    const credential = await io.prompt(`  ${def.promptLabel}`, "");

    let validated = false;
    if (credential && validateCredential) {
      io.log("  Validating credential...");
      validated = await validateCredential(def.envVar, credential);
      io.log(validated ? "  Credential valid." : "  Warning: Credential validation failed. Proceeding anyway.");
    }

    integrations.push({
      provider: def.label,
      category: def.category,
      envVar: def.envVar,
      credential: credential ?? "",
      validated,
    });
  }

  return integrations;
}

/**
 * Collect credentials for cloud providers selected by inference.
 */
async function collectCloudCredentials(
  io: WizardIO,
  result: InferenceResult,
  validateCredential?: (envVar: string, value: string) => Promise<boolean>,
): Promise<CloudProviderSetup[]> {
  if (result.cloudProviders.length === 0) return [];

  io.log("");
  io.log("Cloud API credentials:");

  const providers: CloudProviderSetup[] = [];

  for (const providerId of result.cloudProviders) {
    const def = CLOUD_PROVIDER_DEFS.find((d) => d.provider === providerId);
    if (!def) continue;

    const credential = await io.prompt(`  ${def.promptLabel}`, "");

    let validated = false;
    if (credential && validateCredential) {
      io.log("  Validating credential...");
      validated = await validateCredential(def.envVar, credential);
      io.log(validated ? "  Credential valid." : "  Warning: Credential validation failed.");
    }

    providers.push({
      provider: def.provider,
      envVar: def.envVar,
      credential: credential ?? "",
      validated,
    });
  }

  return providers;
}

/**
 * Convert InferenceResult + collected credentials into WizardAnswers.
 */
function buildWizardAnswers(
  result: InferenceResult,
  template: TemplateChoice,
  integrations: IntegrationSetup[],
  cloudProviders: CloudProviderSetup[],
): WizardAnswers {
  const localOnly = result.cloudProviders.length === 0;

  const categories: ModelCategoryPolicy[] = MODEL_CATEGORIES.map((cat) => ({
    category: cat.category,
    cloudAllowed: result.cloudCategories.includes(cat.category),
  }));

  const modelRouting: ModelRoutingSetup = {
    localOnly,
    cloudProviders,
    categories,
  };

  return {
    basics: {
      agentName: result.agentName,
      timezone: result.timezone,
      wakingHoursStart: result.wakingHoursStart,
      wakingHoursEnd: result.wakingHoursEnd,
    },
    template,
    integrations,
    modelRouting,
  };
}
