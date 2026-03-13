/**
 * Template preview — displays what integrations are needed, autonomy model,
 * local model requirements, estimated daily cost, and "day in the life" narrative.
 */

import type { Template, TemplatePreview } from "./types.js";

// --- Cost estimation ---

/** Rough daily cost estimates based on model routing strategy and autonomy level. */
const COST_ESTIMATES: Record<string, { localOnly: string; withCloud: string }> = {
  "low-low": { localOnly: "$0.00 (electricity only)", withCloud: "$0.10–$0.30" },
  "low-medium": { localOnly: "$0.00 (electricity only)", withCloud: "$0.20–$0.50" },
  "low-high": { localOnly: "$0.00 (electricity only)", withCloud: "$0.30–$0.80" },
  "medium-low": { localOnly: "$0.00 (electricity only)", withCloud: "$0.30–$0.80" },
  "medium-medium": { localOnly: "$0.00 (electricity only)", withCloud: "$0.50–$1.50" },
  "medium-high": { localOnly: "$0.00 (electricity only)", withCloud: "$0.80–$2.50" },
  "high-low": { localOnly: "$0.00 (electricity only)", withCloud: "$0.50–$1.50" },
  "high-medium": { localOnly: "$0.00 (electricity only)", withCloud: "$1.00–$3.00" },
  "high-high": { localOnly: "$0.00 (electricity only)", withCloud: "$1.50–$5.00" },
};

function estimateCost(template: Template): { localOnly: string; withCloud: string } {
  const qualityKey = template.model_routing_strategy.quality_threshold;
  const autonomyKey = template.autonomy_model.default;
  const key = `${qualityKey}-${autonomyKey}`;
  return COST_ESTIMATES[key] ?? { localOnly: "$0.00 (electricity only)", withCloud: "$0.50–$2.00" };
}

/** Local model recommendation based on template requirements. */
function localModelRequirements(template: Template): string {
  const pref = template.model_routing_strategy.local_model_preference;
  const quality = template.model_routing_strategy.quality_threshold;

  if (quality === "high") {
    return `${pref} or larger recommended (16GB+ RAM for 70B models)`;
  }
  if (quality === "medium") {
    return `${pref} recommended (8GB+ RAM)`;
  }
  return `${pref} or smaller sufficient (4GB+ RAM)`;
}

// --- Preview generation ---

/** Generate a structured preview from a template. */
export function generatePreview(template: Template): TemplatePreview {
  return {
    name: template.name,
    replaces: template.use_case_mapping.replaces,
    tagline: template.use_case_mapping.tagline,
    description: template.use_case_mapping.description.trim(),
    dayInTheLife: template.use_case_mapping.day_in_the_life.trim(),
    integrationsRequired: template.integration_requirements.required,
    integrationsRecommended: template.integration_requirements.recommended,
    autonomyLevel: template.autonomy_model.default,
    approvalRequired: template.autonomy_model.requires_approval,
    securityPosture: template.security_posture.posture,
    localModelRequirements: localModelRequirements(template),
    estimatedDailyCost: estimateCost(template),
    skillsIncluded: template.skill_bundle.included,
  };
}

// --- Formatting ---

/** Format a template preview for console display. */
export function formatPreview(preview: TemplatePreview): string {
  const lines: string[] = [];

  lines.push(`  ${preview.name}`);
  lines.push(`  Replaces: ${preview.replaces}`);
  lines.push(`  ${preview.tagline}`);
  lines.push("");
  lines.push(`  ${preview.description}`);
  lines.push("");
  lines.push("  Integrations:");
  lines.push(`    Required:    ${preview.integrationsRequired.join(", ") || "none"}`);
  lines.push(`    Recommended: ${preview.integrationsRecommended.join(", ") || "none"}`);
  lines.push("");
  lines.push(`  Autonomy: ${preview.autonomyLevel}`);
  lines.push(`    Requires approval for: ${preview.approvalRequired.join(", ")}`);
  lines.push("");
  lines.push(`  Security: ${preview.securityPosture}`);
  lines.push(`  Local model: ${preview.localModelRequirements}`);
  lines.push("");
  lines.push("  Estimated daily cost:");
  lines.push(`    Local only: ${preview.estimatedDailyCost.localOnly}`);
  lines.push(`    With cloud:  ${preview.estimatedDailyCost.withCloud}`);
  lines.push("");
  lines.push(`  Skills included: ${preview.skillsIncluded.join(", ") || "none"}`);
  lines.push("");
  lines.push("  A day in the life:");

  // Word-wrap the day-in-the-life narrative at ~72 chars, indented
  const words = preview.dayInTheLife.split(/\s+/);
  let currentLine = "    ";
  for (const word of words) {
    if (currentLine.length + word.length + 1 > 76) {
      lines.push(currentLine);
      currentLine = "    " + word;
    } else {
      currentLine += (currentLine.trim() === "" ? "" : " ") + word;
    }
  }
  if (currentLine.trim() !== "") {
    lines.push(currentLine);
  }

  return lines.join("\n");
}

/** Format a list of templates for selection display. */
export function formatTemplateList(templates: Map<string, Template>): string {
  const lines: string[] = [];
  let i = 0;
  for (const [, template] of templates) {
    i++;
    lines.push(`  ${i}. ${template.name}`);
    lines.push(`     ${template.use_case_mapping.tagline}`);
  }
  return lines.join("\n");
}
