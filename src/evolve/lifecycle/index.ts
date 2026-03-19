/**
 * Lifecycle module — export + destroy (data sovereignty guarantee).
 *
 * `clawhq export` produces a self-contained portable bundle with PII masking.
 * `clawhq destroy` wipes all local data with cryptographic proof of destruction.
 */

// Export
export { exportBundle } from "./export.js";

// Destroy
export { destroyAgent, verifyDestructionProof } from "./destroy.js";

// PII masking
export { isTextFile, maskPii } from "./mask.js";

// Formatters
export {
  formatDestroyJson,
  formatDestroyTable,
  formatExportJson,
  formatExportTable,
  formatVerifyResult,
} from "./format.js";

// Types
export type {
  DestroyedFile,
  DestroyOptions,
  DestroyResult,
  DestructionProof,
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
