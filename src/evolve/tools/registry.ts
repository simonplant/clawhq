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
import { generateGhTool } from "../../design/tools/gh.js";
import { generateHaTool } from "../../design/tools/ha.js";
import { generateIcalTool } from "../../design/tools/ical.js";
import { generateJournalTool } from "../../design/tools/journal.js";
import { generateQuoteTool } from "../../design/tools/quote.js";
import { generateSubstackTool } from "../../design/tools/substack.js";
import { generateTavilyTool } from "../../design/tools/tavily.js";
import { generateTodoistTool } from "../../design/tools/todoist.js";
import { generateVaultTool } from "../../design/tools/vault.js";
import { generateXTool } from "../../design/tools/x.js";

/**
 * Registry of available tools and their generators.
 *
 * Tool names are generic capabilities (tasks, calendar, search),
 * not provider names (todoist, ical, tavily).
 *
 * This mirrors TOOL_GENERATORS from src/design/tools/ — every
 * user-installable tool must be listed here.
 */
export const TOOL_REGISTRY: Readonly<Record<string, () => string>> = {
  backlog: generateBacklogTool,
  calendar: generateIcalTool,
  email: generateEmailTool,
  gh: generateGhTool,
  home: generateHaTool,
  journal: generateJournalTool,
  quote: generateQuoteTool,
  search: generateTavilyTool,
  substack: generateSubstackTool,
  tasks: generateTodoistTool,
  vault: generateVaultTool,
  x: generateXTool,
};

/** List all available tool names from the registry. */
export function availableToolNames(): string[] {
  return Object.keys(TOOL_REGISTRY);
}
