/**
 * Conversational refinement loop for AI-powered config inference.
 *
 * Shows the user a plain-language summary of the inferred config,
 * then allows them to adjust any aspect conversationally before
 * generating the final config.
 */

import type { TemplateChoice, WizardIO } from "../configure/types.js";

import { OllamaClient } from "./ollama.js";
import { formatProposal, parseInferenceResponse } from "./parser.js";
import { buildRefinementPrompt } from "./prompt.js";
import type { InferenceResult, OllamaMessage } from "./types.js";

const MAX_REFINEMENT_TURNS = 10;

/**
 * Run the conversational refinement loop.
 *
 * Shows the proposal, asks if the user wants changes,
 * and applies adjustments via the LLM until satisfied.
 */
export async function refineProposal(
  io: WizardIO,
  client: OllamaClient,
  result: InferenceResult,
  templates: TemplateChoice[],
  conversationHistory: OllamaMessage[],
): Promise<InferenceResult> {
  let current = result;

  for (let turn = 0; turn < MAX_REFINEMENT_TURNS; turn++) {
    io.log("");
    io.log(formatProposal(current, templates));
    io.log("");

    const satisfied = await io.confirm("Does this look right?", true);
    if (satisfied) return current;

    const adjustment = await io.prompt(
      "What would you like to change?",
    );

    if (!adjustment) return current;

    io.log("");
    io.log("Adjusting...");

    const currentJson = JSON.stringify(current, null, 2);
    const refinementPrompt = buildRefinementPrompt(currentJson, adjustment);

    conversationHistory.push({ role: "user", content: refinementPrompt });

    try {
      const response = await client.chat(conversationHistory);
      conversationHistory.push({ role: "assistant", content: response });

      const updated = parseInferenceResponse(response, templates);
      if (updated) {
        current = updated;
      } else {
        io.log("Could not parse the adjustment. Keeping current config.");
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      io.log(`Adjustment failed: ${msg}`);
      io.log("Keeping current config.");
    }
  }

  io.log("Maximum refinement turns reached. Proceeding with current config.");
  return current;
}
