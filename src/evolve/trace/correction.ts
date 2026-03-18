/**
 * Trace correction — bridges the trace system with preference learning.
 *
 * When a user disagrees with a decision (from trace context), this module
 * creates a preference signal and feeds it into the learning pipeline.
 */

import {
  classifyCorrection,
  createSignal,
  recordSignal,
} from "../learning/index.js";
import type { LearningContext, PreferenceSignal } from "../learning/index.js";

import type { DecisionEntry, TraceCorrection } from "./types.js";

/**
 * Determine the best identity file target based on the decision's factors.
 * Rules come from AGENTS.md, preferences from USER.md.
 */
function inferTargetIdentity(entry: DecisionEntry): string {
  const hasRule = entry.factors.some((f) => f.kind === "rule");
  const hasPreference = entry.factors.some((f) => f.kind === "preference");

  // If the correction contradicts a preference, target USER.md
  if (hasPreference) return "USER.md";
  // If it contradicts a rule, target AGENTS.md
  if (hasRule) return "AGENTS.md";
  // Default to USER.md for context-driven decisions
  return "USER.md";
}

/**
 * Derive a category from the decision's action type.
 */
function inferCategory(entry: DecisionEntry): string {
  return entry.actionType.replace(/_/g, "-");
}

/**
 * Process a user correction from trace context and feed it into
 * the preference learning pipeline.
 *
 * Returns the created preference signal.
 */
export async function processCorrection(
  correction: TraceCorrection,
  entry: DecisionEntry,
  learningCtx: LearningContext,
): Promise<PreferenceSignal> {
  const signalType = classifyCorrection(correction.correctionText);
  const targetIdentity = inferTargetIdentity(entry);
  const category = inferCategory(entry);

  const signal = createSignal({
    actionType: entry.actionType,
    originalDecision: entry.summary,
    correction: correction.correctionText,
    appliedToIdentity: targetIdentity,
    category,
    signalType,
  });

  await recordSignal(learningCtx, signal);

  return signal;
}
