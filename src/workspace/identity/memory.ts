/**
 * MEMORY.md skeleton generator — sections for active situations, lessons, patterns.
 */

import type { WizardAnswers } from "../../init/types.js";

export function generateMemoryMd(answers: WizardAnswers): string {
  const { basics } = answers;

  return [
    "# MEMORY.md — Long-Term Memory",
    "",
    "Curated from daily logs. Review and maintain periodically.",
    "",
    "## Active Situations",
    "",
    "<!-- Current ongoing matters that need tracking across sessions -->",
    "",
    "## Lessons Learned",
    "",
    "<!-- Hard-won insights — things that failed, workarounds discovered -->",
    "",
    "## Patterns",
    "",
    "<!-- Recurring behaviors, preferences, and rhythms noticed over time -->",
    "",
    "## Key People",
    "",
    "<!-- Important contacts and relationships -->",
    "",
    "---",
    "",
    `_Agent: ${basics.agentName} | Timezone: ${basics.timezone}_`,
    "",
  ].join("\n");
}
