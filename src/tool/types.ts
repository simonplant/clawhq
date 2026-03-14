/**
 * CLI tool management types.
 *
 * Tools are CLI binaries installed into the agent's Docker image (e.g.,
 * himalaya, jq, yq, ripgrep). ClawHQ tracks which tools are installed,
 * manages Dockerfile fragments, and provides install/remove operations.
 *
 * This is distinct from workspace tools (src/workspace/tools/) which are
 * shell scripts generated for integration use, and from skills
 * (src/skill/) which are OpenClaw extensibility plugins.
 */

export type ToolInstallMethod = "binary" | "apt";

export interface ToolDefinition {
  /** Short name used as identifier (e.g., "jq", "himalaya"). */
  name: string;
  /** Human-readable description. */
  description: string;
  /** How this tool is installed: binary download or apt package. */
  installMethod: ToolInstallMethod;
  /** apt package name (when installMethod === "apt"). */
  aptPackage?: string;
  /** Command to verify the tool is installed (e.g., "jq --version"). */
  verifyCmd: string;
  /** Whether this tool is always included in every build. */
  alwaysIncluded: boolean;
  /** Tags for discoverability (e.g., ["json", "data"]). */
  tags: string[];
}

export interface InstalledTool {
  /** Tool name (matches ToolDefinition.name). */
  name: string;
  /** When the tool was added to the deployment config. */
  installedAt: string;
  /** Whether the tool was explicitly installed or auto-included. */
  explicit: boolean;
}

export interface ToolRegistry {
  tools: InstalledTool[];
}

export interface ToolContext {
  openclawHome: string;
  clawhqDir: string;
}

export class ToolError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}
