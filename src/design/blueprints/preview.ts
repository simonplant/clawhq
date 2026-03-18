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
    ...(template.toolbelt ? { toolbelt: template.toolbelt } : {}),
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

  if (preview.toolbelt) {
    lines.push("");
    lines.push(`  Toolbelt: ${preview.toolbelt.role}`);
    lines.push(`  ${preview.toolbelt.description}`);
    lines.push("");
    lines.push("  Tools bundled:");
    for (const tool of preview.toolbelt.tools) {
      const tag = tool.required ? "required" : "optional";
      lines.push(`    - ${tool.name} (${tool.category}, ${tag}): ${tool.description}`);
    }
    lines.push("");
    lines.push("  Skills bundled:");
    for (const skill of preview.toolbelt.skills) {
      const tag = skill.required ? "required" : "optional";
      lines.push(`    - ${skill.name} (${tag}): ${skill.description}`);
    }
  }

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

/** Format a detailed toolbelt view for `template show`. */
export function formatTemplateShow(template: Template): string {
  const lines: string[] = [];

  lines.push(`  ${template.name}`);
  lines.push(`  ${template.use_case_mapping.tagline}`);
  lines.push("");

  // Toolbelt section
  if (template.toolbelt) {
    lines.push(`  Role: ${template.toolbelt.role}`);
    lines.push(`  ${template.toolbelt.description}`);
    lines.push("");

    lines.push("  What gets installed:");
    lines.push("");
    lines.push("  Tools:");
    for (const tool of template.toolbelt.tools) {
      const tag = tool.required ? "required" : "optional";
      lines.push(`    [${tag}] ${tool.name} (${tool.category})`);
      lines.push(`            ${tool.description}`);
    }

    lines.push("");
    lines.push("  Skills:");
    for (const skill of template.toolbelt.skills) {
      const tag = skill.required ? "required" : "optional";
      lines.push(`    [${tag}] ${skill.name}`);
      lines.push(`            ${skill.description}`);
    }
  } else {
    lines.push("  No toolbelt defined — template uses default tool selection from integrations.");
  }

  // Security
  lines.push("");
  lines.push("  Security:");
  lines.push(`    Posture:        ${template.security_posture.posture}`);
  lines.push(`    Egress:         ${template.security_posture.egress}`);
  lines.push(`    Identity mount: ${template.security_posture.identity_mount}`);

  // Data egress
  lines.push("");
  lines.push("  Data leaving your machine:");
  const cloudCategories = template.model_routing_strategy.cloud_escalation_categories;
  if (cloudCategories.length === 0) {
    lines.push("    None — fully local by default");
  } else {
    lines.push(`    Cloud escalation allowed for: ${cloudCategories.join(", ")}`);
    lines.push("    All other tasks run on local models — zero egress");
  }
  lines.push(`    Default provider: ${template.model_routing_strategy.default_provider}`);

  // Integrations
  lines.push("");
  lines.push("  Integrations:");
  lines.push(`    Required:    ${template.integration_requirements.required.join(", ") || "none"}`);
  lines.push(`    Recommended: ${template.integration_requirements.recommended.join(", ") || "none"}`);
  lines.push(`    Optional:    ${template.integration_requirements.optional.join(", ") || "none"}`);

  // Autonomy
  lines.push("");
  lines.push(`  Autonomy: ${template.autonomy_model.default}`);
  lines.push(`    Requires approval: ${template.autonomy_model.requires_approval.join(", ")}`);

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
