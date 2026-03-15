/**
 * Decision trace — "Why did you do that?"
 *
 * Records the rules, preferences, and context behind every agent action.
 * Users can query any action to understand the full decision chain,
 * get a natural-language explanation citing specific sources, and submit
 * corrections that feed into preference learning.
 */

export type {
  DecisionEntry,
  DecisionFactor,
  DecisionStore,
  Explanation,
  ExplanationCitation,
  FactorKind,
  TraceContext,
  TraceCorrection,
  TraceQuery,
  TraceResult,
} from "./types.js";
export { TraceError } from "./types.js";

export { loadDecisions, recordDecision, saveDecisions } from "./recorder.js";

export { queryTrace } from "./query.js";

export { explain, explainWithLLM, explainWithTemplate } from "./explain.js";

export { processCorrection } from "./correction.js";
