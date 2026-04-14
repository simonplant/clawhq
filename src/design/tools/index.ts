/**
 * Tools module - generates workspace CLI tool wrappers from blueprints.
 *
 * Tools are the agent's HANDS - what it can DO in the world. Each tool is
 * a thin CLI wrapper (bash or python3) that delegates to an underlying
 * integration (himalaya, caldav, Todoist API, etc.).
 *
 * Blueprint-driven generation means tools are consistent with what the
 * identity and skills expect. Adding a new integration means writing a
 * wrapper, not modifying the agent.
 */

import { FILE_MODE_EXEC } from "../../config/defaults.js";
import type { Blueprint } from "../blueprints/types.js";

import { generateApproveActionTool } from "./approve-action.js";
import { generateEmailTool } from "./email.js";
import { generateGhTool } from "./gh.js";
import { generateBacklogTool } from "./backlog.js";
import { generateHaTool } from "./ha.js";
import { generateIcalTool } from "./ical.js";
import { generateJournalTool } from "./journal.js";
import { generatePlaidTool } from "./plaid.js";
import { generateQuoteTool } from "./quote.js";
import { generateSanitizeTool } from "./sanitize.js";
import { generateSubstackTool } from "./substack.js";
import { generateTavilyTool } from "./tavily.js";
import { generateTodoistTool } from "./todoist.js";
import { generateVaultTool } from "./vault.js";
import { generateXTool } from "./x.js";

// ── Types ───────────────────────────────────────────────────────────────────

/** Generated tool wrapper with content and metadata for writing. */
export interface ToolFileContent {
  /** Tool name matching blueprint toolbelt entry (e.g. "email", "ical"). */
  readonly name: string;
  /** Relative path within deploy directory (e.g. "workspace/tools/email"). */
  readonly relativePath: string;
  /** Script content (bash or python3). */
  readonly content: string;
  /** File permission mode - always FILE_MODE_EXEC (0o755, executable). */
  readonly mode: number;
}

// ── Registry ────────────────────────────────────────────────────────────────

/**
 * Map of tool names to their content generators.
 *
 * Every tool referenced in any blueprint YAML must have an entry here.
 * The generator returns the full script content for the tool wrapper.
 */
export const TOOL_GENERATORS: Readonly<Record<string, () => string>> = {
  backlog: generateBacklogTool,
  calendar: generateIcalTool,
  email: generateEmailTool,
  gh: generateGhTool,
  home: generateHaTool,
  journal: generateJournalTool,
  plaid: generatePlaidTool,
  quote: generateQuoteTool,
  search: generateTavilyTool,
  substack: generateSubstackTool,
  tasks: generateTodoistTool,
  vault: generateVaultTool,
  x: generateXTool,
};

// ── Generator ───────────────────────────────────────────────────────────────

/**
 * Generate all tool wrappers for a blueprint.
 *
 * Reads the blueprint's toolbelt, generates a wrapper for each tool,
 * and returns them ready for writing to workspace/tools/.
 *
 * Tool names in the output match the blueprint's toolbelt entries exactly,
 * ensuring consistency with AGENTS.md tool references.
 */
export function generateToolWrappers(blueprint: Blueprint): ToolFileContent[] {
  const wrappers: ToolFileContent[] = [];

  for (const tool of blueprint.toolbelt.tools) {
    const generator = TOOL_GENERATORS[tool.name];
    if (!generator) {
      throw new Error(
        `Unknown tool "${tool.name}" in blueprint "${blueprint.name}". ` +
          `Known tools: ${Object.keys(TOOL_GENERATORS).join(", ")}`,
      );
    }

    wrappers.push({
      name: tool.name,
      relativePath: `workspace/tools/${tool.name}`,
      content: generator(),
      mode: FILE_MODE_EXEC,
    });
  }

  // Always include the approve-action platform tool - required for the
  // approval gate that high-stakes actions (send, reply, delete) route through.
  if (blueprint.autonomy_model.requires_approval.length > 0) {
    wrappers.push({
      name: "approve-action",
      relativePath: "workspace/tools/approve-action",
      content: generateApproveActionTool(),
      mode: FILE_MODE_EXEC,
    });
  }

  // Always include the sanitize platform tool - ClawWall prompt injection
  // firewall. Every deployment gets sanitize on PATH so external-facing
  // tools can pipe content through it.
  wrappers.push({
    name: "sanitize",
    relativePath: "workspace/tools/sanitize",
    content: generateSanitizeTool(),
    mode: FILE_MODE_EXEC,
  });

  return wrappers;
}
