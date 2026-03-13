/**
 * Portable export module.
 *
 * Produces self-documented portable bundles containing identity files,
 * memory archive, workspace snapshot, config (secrets redacted),
 * integration manifest, interaction history, and build manifest.
 *
 * See docs/PRODUCT.md → Decommission phase for user stories.
 */

export type {
  ExportFileEntry,
  ExportManifest,
  ExportOptions,
  ExportResult,
} from "./types.js";

export { ExportError } from "./types.js";

export { createExport } from "./export.js";

export {
  collectExportFiles,
  generateExportId,
  hashContent,
  readConfigRedacted,
} from "./collector.js";

export { generateBundleReadme } from "./readme.js";

export {
  maskPiiInDirectory,
  maskPiiInText,
  PII_PATTERNS,
} from "./pii.js";
