/**
 * CLI tool management — install, list, remove agent CLI tools.
 */

export { formatToolList } from "./format.js";
export {
  addTool,
  findKnownTool,
  findTool,
  KNOWN_TOOLS,
  loadRegistry,
  removeTool,
  saveRegistry,
} from "./registry.js";
export type { ToolListEntry } from "./tool.js";
export {
  getRequiredBinaries,
  installTool,
  listTools,
  removeToolOp,
} from "./tool.js";
export type { InstallResult, RemoveResult } from "./tool.js";
export type {
  InstalledTool,
  ToolContext,
  ToolDefinition,
  ToolError,
  ToolInstallMethod,
  ToolRegistry,
} from "./types.js";
export { ToolError } from "./types.js";
