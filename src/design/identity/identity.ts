/**
 * IDENTITY.md generator — agent name, personality, emoji from template.
 */

import type { WizardAnswers } from "../configure/types.js";

export function generateIdentityMd(answers: WizardAnswers): string {
  const { basics, template } = answers;

  return [
    "# IDENTITY.md",
    "",
    `**${basics.agentName}** — an OpenClaw agent.`,
    "",
    `${capitalize(template.personality.tone)}, ${template.personality.style.split(",")[0].trim()}. ${capitalize(template.personality.relationship)}.`,
    "",
    "See SOUL.md for the full picture.",
    "",
  ].join("\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
