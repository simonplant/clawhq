/**
 * Tool registry — maps tool names to their content generators.
 *
 * Re-exports the TOOL_GENERATORS from src/design/tools/ so the evolve
 * module can generate tool scripts on demand during `clawhq tool install`.
 *
 * Every tool available for install must be listed here.
 */

import { generateBacklogTool } from "../../design/tools/backlog.js";
import { generateEmailTool } from "../../design/tools/email.js";
import { generateIcalTool } from "../../design/tools/ical.js";
import { generateQuoteTool } from "../../design/tools/quote.js";
import { generateTavilyTool } from "../../design/tools/tavily.js";
import { generateTodoistTool } from "../../design/tools/todoist.js";

/**
 * Registry of available tools and their generators.
 *
 * Tool names are generic capabilities (tasks, calendar, search),
 * not provider names (todoist, ical, tavily).
 */
export const TOOL_REGISTRY: Readonly<Record<string, () => string>> = {
  backlog: generateBacklogTool,
  calendar: generateIcalTool,
  email: generateEmailTool,
  tasks: generateTodoistTool,
  search: generateTavilyTool,
  quote: generateQuoteTool,
};

/** List all available tool names from the registry. */
export function availableToolNames(): string[] {
  return Object.keys(TOOL_REGISTRY);
}
