/**
 * AI-powered config inference for `clawhq init --smart`.
 *
 * Takes a natural language description of what the user needs, sends it to
 * local Ollama with blueprint context, and returns a WizardAnswers object
 * compatible with the guided wizard's output.
 *
 * All inference runs locally via Ollama — zero data leaves the machine.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import chalk from "chalk";

import { loadAllBuiltinBlueprints, loadBlueprint } from "../blueprints/loader.js";
import type { LoadedBlueprint } from "../blueprints/loader.js";

import { generate, isOllamaAvailable, listOllamaModels, OllamaError } from "./ollama.js";
import type { OllamaOptions } from "./ollama.js";
import type { Prompter } from "./wizard.js";
import type { WizardAnswers } from "./types.js";

// ── Types ──────────────────────────────────────────────────────────────────

/** Options for smart inference. */
export interface SmartOptions {
  /** Override the deployment directory. */
  readonly deployDir?: string;

  /** Ollama base URL (default: http://127.0.0.1:11434). */
  readonly ollamaUrl?: string;

  /** Ollama model to use for inference (default: auto-detect or llama3:8b). */
  readonly ollamaModel?: string;
}

/** Structured inference result from Ollama. */
interface InferenceResult {
  readonly blueprint: string;
  readonly channel: string;
  readonly integrations: string[];
  readonly reasoning: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_DEPLOY_DIR = join(homedir(), ".clawhq");
const DEFAULT_GATEWAY_PORT = 18789;
const DEFAULT_LOCAL_MODEL = "llama3:8b";

// ── Smart Inference ────────────────────────────────────────────────────────

/**
 * Run AI-powered config inference.
 *
 * 1. Checks Ollama is available
 * 2. Prompts user for a natural language description
 * 3. Sends description + blueprint context to Ollama
 * 4. Parses structured response into blueprint selection + integrations
 * 5. Returns WizardAnswers ready for generateBundle()
 *
 * @param prompter — Prompt implementation for user interaction
 * @param options — Smart inference options
 * @returns WizardAnswers compatible with the guided wizard
 */
export async function runSmartInference(
  prompter: Prompter,
  options: SmartOptions = {},
): Promise<WizardAnswers> {
  const deployDir = options.deployDir ?? DEFAULT_DEPLOY_DIR;

  console.log(chalk.bold("\n⚡ ClawHQ Smart Setup\n"));
  console.log(chalk.dim("Describe what you need. Ollama will infer the right blueprint and integrations."));
  console.log(chalk.dim("All inference runs locally — zero data leaves your machine.\n"));

  // Step 1: Verify Ollama is running
  const ollamaUrl = options.ollamaUrl;
  const available = await isOllamaAvailable(ollamaUrl);
  if (!available) {
    throw new SmartInferenceError(
      "Ollama is not running. Start it with: ollama serve\n" +
      "  Install: https://ollama.com\n" +
      "  Fallback: use clawhq init --guided for manual setup",
    );
  }

  // Step 2: Select or detect model
  const model = await resolveModel(ollamaUrl, options.ollamaModel);
  console.log(chalk.green(`✓ Ollama connected — using ${model}\n`));

  // Step 3: Get user description
  const description = await prompter.input({
    message: "Describe what you want your agent to do:",
  });

  if (!description.trim()) {
    throw new SmartInferenceError(
      "No description provided. Try again or use clawhq init --guided",
    );
  }

  // Step 4: Load blueprints and build context
  const blueprints = loadAllBuiltinBlueprints();
  if (blueprints.length === 0) {
    throw new SmartInferenceError(
      "No blueprints found. Ensure configs/templates/ contains blueprint YAML files.",
    );
  }

  // Step 5: Run inference
  console.log(chalk.dim("\nAnalyzing your description…"));
  const ollamaOpts: OllamaOptions = { baseUrl: ollamaUrl, model };
  const result = await infer(description, blueprints, ollamaOpts);

  // Step 6: Load selected blueprint
  const slug = result.blueprint.toLowerCase().replace(/\s+/g, "-");
  let loaded: ReturnType<typeof loadBlueprint>;
  try {
    loaded = loadBlueprint(slug);
  } catch {
    // If exact match fails, try fuzzy matching
    loaded = fuzzyMatchBlueprint(result.blueprint, blueprints);
  }

  const blueprint = loaded.blueprint;

  // Step 7: Determine channel
  const channel = resolveChannel(result.channel, blueprint);

  // Step 8: Map inferred integrations to credential collection
  const integrations = mapIntegrations(result.integrations, blueprint);

  // Step 9: Show inference result and confirm
  console.log(chalk.bold("\n📋 Inferred Configuration"));
  console.log(chalk.dim("─".repeat(40)));
  console.log(`  Blueprint:     ${chalk.cyan(blueprint.name)}`);
  console.log(`  Channel:       ${channel}`);
  console.log(`  Model:         local (${model})`);
  console.log(`  Deploy to:     ${deployDir}`);
  console.log(`  Port:          ${DEFAULT_GATEWAY_PORT}`);
  console.log(`  Integrations:  ${Object.keys(integrations).length > 0 ? Object.keys(integrations).join(", ") : "none"}`);
  console.log(chalk.dim("─".repeat(40)));
  if (result.reasoning) {
    console.log(chalk.dim(`  Reasoning: ${result.reasoning}`));
  }

  const confirmed = await prompter.confirm({
    message: "Generate config and forge agent?",
    default: true,
  });

  if (!confirmed) {
    throw new SmartInferenceAbortError();
  }

  return {
    blueprint,
    blueprintPath: loaded.sourcePath,
    channel,
    modelProvider: "local",
    localModel: model,
    gatewayPort: DEFAULT_GATEWAY_PORT,
    deployDir,
    airGapped: false,
    integrations,
  };
}

// ── Inference Engine ───────────────────────────────────────────────────────

/**
 * Build the inference prompt and parse the response.
 */
async function infer(
  description: string,
  blueprints: LoadedBlueprint[],
  ollamaOpts: OllamaOptions,
): Promise<InferenceResult> {
  const prompt = buildInferencePrompt(description, blueprints);

  let rawResponse: string;
  try {
    rawResponse = await generate(prompt, ollamaOpts);
  } catch (err) {
    if (err instanceof OllamaError) {
      throw new SmartInferenceError(`Ollama inference failed: ${err.message}`);
    }
    throw err;
  }

  return parseInferenceResponse(rawResponse, blueprints);
}

/**
 * Build the prompt that tells Ollama about available blueprints
 * and asks it to select the best match.
 */
function buildInferencePrompt(
  description: string,
  blueprints: LoadedBlueprint[],
): string {
  const blueprintSummaries = blueprints.map((b) => {
    const bp = b.blueprint;
    const slug = bp.name.toLowerCase().replace(/\s+/g, "-");
    const intReq = bp.integration_requirements;
    return [
      `- slug: "${slug}"`,
      `  name: "${bp.name}"`,
      `  tagline: "${bp.use_case_mapping.tagline}"`,
      `  replaces: "${bp.use_case_mapping.replaces}"`,
      `  channels: [${bp.channels.supported.join(", ")}]`,
      `  default_channel: "${bp.channels.default}"`,
      `  integrations_required: [${intReq.required.join(", ")}]`,
      `  integrations_recommended: [${intReq.recommended.join(", ")}]`,
    ].join("\n");
  }).join("\n\n");

  return `You are a configuration assistant for ClawHQ, an AI agent platform. Given a user's description of what they want their agent to do, select the best matching blueprint and suggest integrations.

AVAILABLE BLUEPRINTS:
${blueprintSummaries}

USER DESCRIPTION:
"${description}"

Respond with ONLY a JSON object (no markdown, no explanation outside the JSON):
{
  "blueprint": "<slug of the best matching blueprint>",
  "channel": "<best messaging channel for this use case>",
  "integrations": [<list of integration names the user will need>],
  "reasoning": "<one sentence explaining why this blueprint was chosen>"
}

Rules:
- blueprint MUST be one of the slugs listed above
- channel MUST be one the blueprint supports
- integrations should include relevant required and recommended integrations from the blueprint
- Keep reasoning to one short sentence`;
}

/**
 * Parse the Ollama response into a structured InferenceResult.
 * Handles common LLM output quirks (markdown fences, extra text).
 */
function parseInferenceResponse(
  raw: string,
  blueprints: LoadedBlueprint[],
): InferenceResult {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");

  // Try to extract JSON object from the response
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Fallback: pick the first blueprint
    return fallbackResult(blueprints);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    return {
      blueprint: typeof parsed["blueprint"] === "string" ? parsed["blueprint"] : blueprints[0]!.blueprint.name,
      channel: typeof parsed["channel"] === "string" ? parsed["channel"] : "telegram",
      integrations: Array.isArray(parsed["integrations"])
        ? (parsed["integrations"] as unknown[]).filter((i): i is string => typeof i === "string")
        : [],
      reasoning: typeof parsed["reasoning"] === "string" ? parsed["reasoning"] : "",
    };
  } catch {
    return fallbackResult(blueprints);
  }
}

function fallbackResult(blueprints: LoadedBlueprint[]): InferenceResult {
  const first = blueprints[0]!;
  return {
    blueprint: first.blueprint.name.toLowerCase().replace(/\s+/g, "-"),
    channel: first.blueprint.channels.default,
    integrations: [
      ...first.blueprint.integration_requirements.required,
      ...first.blueprint.integration_requirements.recommended,
    ],
    reasoning: "Could not parse inference response — using first available blueprint",
  };
}

// ── Resolution Helpers ─────────────────────────────────────────────────────

/**
 * Resolve which Ollama model to use.
 * Priority: explicit option > first available model > default.
 */
async function resolveModel(
  baseUrl?: string,
  explicitModel?: string,
): Promise<string> {
  if (explicitModel) return explicitModel;

  const models = await listOllamaModels(baseUrl);
  if (models.length > 0 && models[0] !== undefined) {
    return models[0];
  }

  return DEFAULT_LOCAL_MODEL;
}

/**
 * Resolve the messaging channel from inference result.
 * Falls back to the blueprint's default if the inferred channel isn't supported.
 */
function resolveChannel(inferred: string, blueprint: { channels: { supported: readonly string[]; default: string } }): string {
  const normalized = inferred.toLowerCase().trim();
  if (blueprint.channels.supported.includes(normalized)) {
    return normalized;
  }
  return blueprint.channels.default;
}

/**
 * Fuzzy-match a blueprint name from the inference result
 * against available blueprints.
 */
function fuzzyMatchBlueprint(
  name: string,
  blueprints: LoadedBlueprint[],
): LoadedBlueprint {
  const normalized = name.toLowerCase().replace(/[-_\s]+/g, "");

  // Try substring match
  for (const b of blueprints) {
    const bNorm = b.blueprint.name.toLowerCase().replace(/[-_\s]+/g, "");
    if (bNorm.includes(normalized) || normalized.includes(bNorm)) {
      return b;
    }
  }

  // Fallback to first blueprint
  if (blueprints[0] === undefined) {
    throw new SmartInferenceError("No blueprints available for matching.");
  }
  return blueprints[0];
}

/**
 * Map inferred integration names to the credential structure
 * expected by WizardAnswers. Returns empty credentials — the user
 * will configure them via `clawhq creds` after init.
 */
function mapIntegrations(
  inferred: string[],
  blueprint: { integration_requirements: { required: readonly string[]; recommended: readonly string[] } },
): Record<string, Record<string, string>> {
  // Include all required integrations plus any inferred ones that match recommended
  const result: Record<string, Record<string, string>> = {};

  // Always include required integrations (empty creds — user configures later)
  for (const name of blueprint.integration_requirements.required) {
    result[name] = {};
  }

  // Add inferred integrations that are in the recommended list
  const recommended = new Set(blueprint.integration_requirements.recommended);
  for (const name of inferred) {
    const normalized = name.toLowerCase();
    if (recommended.has(normalized) && !result[normalized]) {
      result[normalized] = {};
    }
  }

  return result;
}

// ── Errors ─────────────────────────────────────────────────────────────────

/** Smart inference encountered an unrecoverable error. */
export class SmartInferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmartInferenceError";
  }
}

/** User cancelled the smart inference flow. */
export class SmartInferenceAbortError extends SmartInferenceError {
  constructor(message: string = "Setup cancelled") {
    super(message);
    this.name = "SmartInferenceAbortError";
  }
}
