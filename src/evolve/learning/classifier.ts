/**
 * Correction classifier — determines whether a user correction is a
 * preference (recurring pattern), boundary (hard rule), or one-time override.
 */

import type { PreferenceSignal, SignalType } from "./types.js";
import { BOUNDARY_INDICATORS, ONE_TIME_INDICATORS } from "./types.js";

/**
 * Classify a correction into a signal type based on the correction text.
 *
 * Priority order:
 * 1. Boundary indicators take highest priority (safety-critical)
 * 2. One-time indicators override preference classification
 * 3. Everything else defaults to "preference"
 */
export function classifyCorrection(correctionText: string): SignalType {
  const lower = correctionText.toLowerCase();

  // Boundaries take priority — safety-critical
  for (const indicator of BOUNDARY_INDICATORS) {
    if (lower.includes(indicator)) {
      return "boundary";
    }
  }

  // One-time overrides
  for (const indicator of ONE_TIME_INDICATORS) {
    if (lower.includes(indicator)) {
      return "one-time";
    }
  }

  // Default: treat as a learnable preference
  return "preference";
}

/**
 * Create a PreferenceSignal from a user correction.
 */
export function createSignal(params: {
  actionType: string;
  originalDecision: string;
  correction: string;
  appliedToIdentity: string;
  category: string;
  signalType?: SignalType;
}): PreferenceSignal {
  const signalType = params.signalType ?? classifyCorrection(params.correction);
  const now = new Date();

  return {
    id: `sig-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: now.toISOString(),
    actionType: params.actionType,
    originalDecision: params.originalDecision,
    correction: params.correction,
    signalType,
    appliedToIdentity: params.appliedToIdentity,
    category: params.category,
  };
}
