/**
 * Tools module — tool installation framework.
 *
 * `clawhq tool install <name>` adds a tool from the registry, writes it
 * to workspace/tools/, updates the manifest, and triggers a Stage 2
 * Docker rebuild so the container picks it up automatically.
 */

// Lifecycle
export { addCustomTool, installTool, listTools, removeTool } from "./lifecycle.js";

// Registry
export { availableToolNames, TOOL_REGISTRY } from "./registry.js";

// Manifest
export { loadToolManifest } from "./manifest.js";

// List formatting
export { formatToolList, formatToolListJson } from "./list.js";

// Types
export type {
  ToolAddOptions,
  ToolInstallOptions,
  ToolInstallResult,
  ToolListOptions,
  ToolListResult,
  ToolManifest,
  ToolManifestEntry,
  ToolRemoveOptions,
  ToolRemoveResult,
} from "./types.js";
