/**
 * Summary display for init wizard results.
 */

import type { ValidationResult } from "../config/schema.js";

import type { WizardAnswers } from "./types.js";
import type { WriteResult } from "./writer.js";

export function formatSummary(
  answers: WizardAnswers,
  validationResults: ValidationResult[],
  writeResult: WriteResult,
): string {
  const lines: string[] = [];
  const failures = validationResults.filter((r) => r.status === "fail");
  const warnings = validationResults.filter((r) => r.status === "warn");

  lines.push("");
  lines.push("═══════════════════════════════════════");
  lines.push("  Configuration Summary");
  lines.push("═══════════════════════════════════════");
  lines.push("");

  // Agent info
  lines.push(`  Agent:     ${answers.basics.agentName}`);
  lines.push(`  Template:  ${answers.template.name}`);
  lines.push(`  Timezone:  ${answers.basics.timezone}`);
  lines.push(`  Waking:    ${answers.basics.wakingHoursStart} - ${answers.basics.wakingHoursEnd}`);
  lines.push(`  Security:  ${answers.template.security.posture}`);
  lines.push(`  Autonomy:  ${answers.template.autonomy.default}`);
  lines.push("");

  // Integrations
  const configured = answers.integrations.filter((i) => i.credential);
  if (configured.length > 0) {
    lines.push("  Integrations:");
    for (const i of configured) {
      const badge = i.validated ? "validated" : "not validated";
      lines.push(`    - ${i.provider} (${badge})`);
    }
  } else {
    lines.push("  Integrations: none configured");
  }
  lines.push("");

  // Model routing
  if (answers.modelRouting.localOnly) {
    lines.push("  Model routing: local-only (Ollama)");
  } else {
    const providers = answers.modelRouting.cloudProviders.map((p) => p.provider).join(", ");
    const cloudCategories = answers.modelRouting.categories
      .filter((c) => c.cloudAllowed)
      .map((c) => c.category);
    lines.push(`  Model routing: local + cloud (${providers})`);
    if (cloudCategories.length > 0) {
      lines.push(`  Cloud-allowed categories: ${cloudCategories.join(", ")}`);
    }
  }
  lines.push("");

  // Validation
  if (failures.length === 0) {
    lines.push(`  Validation: PASSED (${validationResults.length} rules, ${warnings.length} warnings)`);
  } else {
    lines.push(`  Validation: FAILED (${failures.length} failures)`);
    for (const f of failures) {
      lines.push(`    ${f.rule}: ${f.message}`);
      lines.push(`    Fix: ${f.fix}`);
    }
  }
  lines.push("");

  // Files written
  if (writeResult.errors.length === 0) {
    lines.push("  Files written:");
    for (const f of writeResult.filesWritten) {
      lines.push(`    - ${f}`);
    }
  } else {
    lines.push("  Errors:");
    for (const e of writeResult.errors) {
      lines.push(`    - ${e}`);
    }
  }
  lines.push("");

  // Next steps
  lines.push("───────────────────────────────────────");
  lines.push("  Next Steps");
  lines.push("───────────────────────────────────────");
  lines.push("");
  lines.push("  1. Review generated config in the output directory");
  lines.push("  2. Build the container image:");
  lines.push("       clawhq build");
  lines.push("  3. Deploy your agent:");
  lines.push("       clawhq up");
  lines.push("  4. Run diagnostics:");
  lines.push("       clawhq doctor");
  lines.push("");

  return lines.join("\n");
}
