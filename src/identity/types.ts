/**
 * Types for identity governance — token budget tracking,
 * staleness detection, and consistency checking.
 */

/** Token count and budget status for a single identity file. */
export interface FileTokenReport {
  filename: string;
  path: string;
  tokenCount: number;
  /** Percentage of total budget consumed by this file. */
  budgetPercent: number;
}

/** Threshold warning level. */
export type ThresholdLevel = "ok" | "warning" | "critical";

/** Overall token budget report across all identity files. */
export interface BudgetReport {
  files: FileTokenReport[];
  totalTokens: number;
  budgetLimit: number;
  budgetPercent: number;
  threshold: ThresholdLevel;
}

/** Staleness status for a single identity file. */
export interface StalenessEntry {
  filename: string;
  path: string;
  lastModified: Date;
  daysSinceUpdate: number;
  stale: boolean;
}

/** Result of staleness detection across identity files. */
export interface StalenessReport {
  entries: StalenessEntry[];
  staleCount: number;
  staleDaysThreshold: number;
}

/** A potential contradiction found between identity files. */
export interface Contradiction {
  fileA: string;
  fileB: string;
  description: string;
}

/** Result of consistency checking across identity files. */
export interface ConsistencyReport {
  contradictions: Contradiction[];
  filesChecked: number;
}

/** Combined identity governance report. */
export interface IdentityReport {
  budget: BudgetReport;
  staleness: StalenessReport;
  consistency: ConsistencyReport;
}

/** Configuration for identity governance checks. */
export interface IdentityGovernanceConfig {
  /** Maximum token budget (default: 20000 for bootstrapMaxChars). */
  budgetLimit?: number;
  /** Warning threshold as fraction (default: 0.7). */
  warningThreshold?: number;
  /** Critical threshold as fraction (default: 0.9). */
  criticalThreshold?: number;
  /** Days without update before flagging as stale (default: 30). */
  staleDays?: number;
}

export interface IdentityContext {
  /** Path to OpenClaw home directory (contains workspace/). */
  openclawHome: string;
}
