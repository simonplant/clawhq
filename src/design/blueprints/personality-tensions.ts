/**
 * Personality tension detection.
 *
 * Detects conflicting dimension combinations that produce incoherent
 * agent behavior. Tensions warn, never block — the user can proceed
 * after acknowledgment.
 */

import type { PersonalityDimensions } from "./types.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type TensionSeverity = "conflict" | "warning";

export interface TensionRule {
  readonly id: string;
  readonly severity: TensionSeverity;
  readonly description: string;
  readonly test: (dims: PersonalityDimensions) => boolean;
}

export interface DetectedTension {
  readonly id: string;
  readonly severity: TensionSeverity;
  readonly description: string;
}

// ── Tension Rules ────────────────────────────────────────────────────────────

export const TENSION_RULES: readonly TensionRule[] = [
  {
    id: "T-01",
    severity: "conflict",
    description: "Paralysis — high proactivity with high caution means the agent wants to act but constantly second-guesses",
    test: (d) => d.proactivity >= 4 && d.caution >= 4,
  },
  {
    id: "T-02",
    severity: "warning",
    description: "Whiplash — high warmth with high directness can feel warm then suddenly blunt",
    test: (d) => d.warmth >= 4 && d.directness >= 4,
  },
  {
    id: "T-03",
    severity: "conflict",
    description: "Compression conflict — deep analysis cannot fit in minimal responses",
    test: (d) => d.verbosity <= 2 && d.analyticalDepth >= 4,
  },
  {
    id: "T-04",
    severity: "warning",
    description: "Stiff warmth — formal structure with personal warmth (can work for some roles)",
    test: (d) => d.formality >= 4 && d.warmth >= 4,
  },
  {
    id: "T-05",
    severity: "warning",
    description: "Buried actions — high proactivity with low directness buries important actions in soft language",
    test: (d) => d.proactivity >= 4 && d.directness <= 2,
  },
  {
    id: "T-06",
    severity: "warning",
    description: "Bold corporate — bold action with corporate tone is unusual",
    test: (d) => d.caution <= 2 && d.formality >= 4,
  },
  {
    id: "T-07",
    severity: "warning",
    description: "Verbose blunt — lots of unhedged content may feel aggressive",
    test: (d) => d.verbosity >= 4 && d.directness >= 4,
  },
] as const;

// ── Detection ────────────────────────────────────────────────────────────────

/**
 * Detect personality tensions in a set of dimensions.
 *
 * Returns all triggered tensions sorted by severity (conflicts first).
 */
export function detectTensions(dims: PersonalityDimensions): DetectedTension[] {
  const triggered: DetectedTension[] = [];

  for (const rule of TENSION_RULES) {
    if (rule.test(dims)) {
      triggered.push({
        id: rule.id,
        severity: rule.severity,
        description: rule.description,
      });
    }
  }

  // Conflicts first, then warnings
  return triggered.sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === "conflict" ? -1 : 1;
  });
}

/**
 * Check if tensions include any conflicts (not just warnings).
 */
export function hasConflicts(tensions: readonly DetectedTension[]): boolean {
  return tensions.some((t) => t.severity === "conflict");
}
