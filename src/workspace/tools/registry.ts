/**
 * Tool registry — maps integration selections to workspace tools.
 *
 * Each integration category enables specific CLI tools.
 * The tasks tool is always included (every agent needs a work queue).
 */

import type { IntegrationSetup } from "../../init/types.js";
import type { TasksToolOptions } from "./tasks.js";
import { generateEmailTool, type EmailToolOptions } from "./email.js";
import { generateIcalTool } from "./ical.js";
import { generateQuoteTool } from "./quote.js";
import { generateTasksTool } from "./tasks.js";
import { generateTavilyTool } from "./tavily.js";
import { generateTodoistTool } from "./todoist.js";
import { generateTodoistSyncTool } from "./todoist-sync.js";

/** Integration category → tool names mapping */
const INTEGRATION_TOOLS: Record<string, string[]> = {
  email: ["email"],
  calendar: ["ical"],
  tasks: ["todoist", "todoist-sync"],
  research: ["tavily"],
  // markets has no integration category — included via template checks
};

/** Tools that require specific binaries in the Dockerfile */
export const TOOL_BINARY_DEPS: Record<string, string[]> = {
  email: ["himalaya"],
  todoist: ["python3"],
  ical: ["python3", "curl"],
  quote: ["curl", "jq"],
  tavily: ["curl", "jq"],
  "todoist-sync": ["curl", "jq"],
  tasks: ["jq"],
};

export interface ToolRegistryOptions {
  integrations: IntegrationSetup[];
  tasksOptions?: TasksToolOptions;
  emailOptions?: EmailToolOptions;
  includeMarkets?: boolean;
}

export interface GeneratedTools {
  tools: Record<string, string>;        // filename → script content
  requiredBinaries: Set<string>;         // binaries needed in Dockerfile
}

/**
 * Generate all workspace tools based on enabled integrations.
 */
export function generateWorkspaceTools(options: ToolRegistryOptions): GeneratedTools {
  const tools: Record<string, string> = {};
  const requiredBinaries = new Set<string>();

  // Tasks tool is always included
  tools["tasks"] = generateTasksTool(options.tasksOptions);
  for (const bin of TOOL_BINARY_DEPS["tasks"]) {
    requiredBinaries.add(bin);
  }

  // Map integrations to tools
  const enabledCategories = new Set(
    options.integrations
      .filter((i) => i.credential)
      .map((i) => i.category),
  );

  for (const [category, toolNames] of Object.entries(INTEGRATION_TOOLS)) {
    if (!enabledCategories.has(category)) continue;

    for (const toolName of toolNames) {
      const script = generateToolByName(toolName, options);
      if (script) {
        tools[toolName] = script;
        for (const bin of TOOL_BINARY_DEPS[toolName] ?? []) {
          requiredBinaries.add(bin);
        }
      }
    }
  }

  // Markets tool — included if template monitoring checks include "markets"
  // or explicitly requested
  if (options.includeMarkets) {
    tools["quote"] = generateQuoteTool();
    for (const bin of TOOL_BINARY_DEPS["quote"]) {
      requiredBinaries.add(bin);
    }
  }

  return { tools, requiredBinaries };
}

function generateToolByName(name: string, options: ToolRegistryOptions): string | null {
  switch (name) {
    case "email": return generateEmailTool(options.emailOptions);
    case "ical": return generateIcalTool();
    case "todoist": return generateTodoistTool();
    case "todoist-sync": return generateTodoistSyncTool();
    case "tavily": return generateTavilyTool();
    case "quote": return generateQuoteTool();
    case "tasks": return generateTasksTool(options.tasksOptions);
    default: return null;
  }
}

/**
 * Get the list of enabled tool names for documentation generation.
 */
export function getEnabledToolNames(options: ToolRegistryOptions): string[] {
  const names = ["tasks"];
  const enabledCategories = new Set(
    options.integrations
      .filter((i) => i.credential)
      .map((i) => i.category),
  );

  for (const [category, toolNames] of Object.entries(INTEGRATION_TOOLS)) {
    if (enabledCategories.has(category)) {
      names.push(...toolNames);
    }
  }

  if (options.includeMarkets) {
    names.push("quote");
  }

  return names;
}
