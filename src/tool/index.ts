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
  patchDockerfile,
  removeToolOp,
} from "./tool.js";
export type { InstallResult, PatchResult, RemoveResult } from "./tool.js";
export type {
  InstalledTool,
  ToolContext,
  ToolDefinition,
  ToolInstallMethod,
  ToolRegistry,
} from "./types.js";
export { ToolError } from "./types.js";
