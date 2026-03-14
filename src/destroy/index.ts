/**
 * Verified destruction module.
 *
 * Implements the complete destruction sequence with dry-run preview,
 * deployment name confirmation, step-by-step teardown, and signed
 * destruction manifest with cryptographic proof.
 *
 * See docs/PRODUCT.md → Decommission phase for user stories.
 */

export type {
  DestroyOptions,
  DestroyResult,
  DestroyStep,
  DestructionManifest,
  DestructionManifestEntry,
  DryRunItem,
  DryRunResult,
  StepStatus,
} from "./types.js";

export { DestroyError } from "./types.js";

export { destroy, dryRun } from "./destroy.js";

export {
  buildDestructionManifest,
  generateManifestId,
  verifyManifest,
} from "./manifest.js";
