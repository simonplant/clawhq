/**
 * Identity governance — token budget, staleness detection, consistency checking.
 */

export {
  checkBudget,
  checkConsistency,
  checkStaleness,
  estimateTokens,
  formatBudgetReport,
  formatConsistencyReport,
  formatIdentityReport,
  formatStalenessReport,
  runGovernanceCheck,
} from "./governance.js";
export type {
  BudgetReport,
  ConsistencyReport,
  Contradiction,
  FileTokenReport,
  IdentityContext,
  IdentityGovernanceConfig,
  IdentityReport,
  StalenessEntry,
  StalenessReport,
  ThresholdLevel,
} from "./types.js";
