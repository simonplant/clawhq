/**
 * Lifecycle module — export + destroy (data sovereignty guarantee).
 *
 * `clawhq export` produces a self-contained portable bundle with PII masking.
 * `clawhq destroy` wipes all local data and produces a deletion receipt.
 */

// Export
export { exportBundle } from "./export.js";

// Destroy
export { destroyAgent } from "./destroy.js";

// PII masking
export { isTextFile, maskPii } from "./mask.js";

// Formatters
export {
  formatDestroyJson,
  formatDestroyTable,
  formatExportJson,
  formatExportTable,
} from "./format.js";

// Types
export type {
  DeletionReceipt,
  DestroyedFile,
  DestroyOptions,
  DestroyResult,
  ExportOptions,
  ExportResult,
  ExportStep,
  DestroyStep,
  LifecycleProgress,
  LifecycleProgressCallback,
  PiiCategory,
  PiiMatch,
  PiiMaskReport,
  StepStatus,
} from "./types.js";
