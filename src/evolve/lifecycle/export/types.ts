/**
 * Portable export type definitions.
 *
 * Covers self-documented export bundles containing identity files,
 * memory archive, workspace snapshot, config (secrets redacted),
 * integration manifest, interaction history, and build manifest.
 */

export interface ExportFileEntry {
  path: string;
  size: number;
  hash: string;
}

export interface ExportManifest {
  exportId: string;
  timestamp: string;
  version: number;
  flags: {
    maskPii: boolean;
    noMemory: boolean;
  };
  files: ExportFileEntry[];
  totalSize: number;
}

export interface ExportOptions {
  /** OpenClaw home directory (default: ~/.openclaw) */
  openclawHome: string;
  /** Output directory for the export bundle */
  outputDir: string;
  /** Apply PII masking to all exported files */
  maskPii?: boolean;
  /** Export only identity + config (skip memory and workspace) */
  noMemory?: boolean;
}

export interface ExportResult {
  exportId: string;
  archivePath: string;
  manifest: ExportManifest;
}

export class ExportError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ExportError";
  }
}
