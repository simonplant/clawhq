/**
 * Tool registry — maps tool names to their content generators.
 *
 * Re-exports the TOOL_GENERATORS from src/design/tools/ so the evolve
 * module can generate tool scripts on demand during `clawhq tool install`.
 *
 * Every tool available for install must be listed here.
 */

import { generateEmailTool } from "../../design/tools/email.js";
import { generateIcalTool } from "../../design/tools/ical.js";
import { generateQuoteTool } from "../../design/tools/quote.js";
import { generateTasksTool } from "../../design/tools/tasks.js";
import { generateTavilyTool } from "../../design/tools/tavily.js";
import { generateTodoistSyncTool } from "../../design/tools/todoist-sync.js";
import { generateTodoistTool } from "../../design/tools/todoist.js";

/**
 * Registry of available tools and their generators.
 *
 * The approve-action tool is excluded — it's a platform tool that gets
 * added automatically when the blueprint requires approval gates.
 */
export const TOOL_REGISTRY: Readonly<Record<string, () => string>> = {
  email: generateEmailTool,
  ical: generateIcalTool,
  tasks: generateTasksTool,
  todoist: generateTodoistTool,
  "todoist-sync": generateTodoistSyncTool,
  tavily: generateTavilyTool,
  quote: generateQuoteTool,
};

/** List all available tool names from the registry. */
export function availableToolNames(): string[] {
  return Object.keys(TOOL_REGISTRY);
}
