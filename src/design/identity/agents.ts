/**
 * AGENTS.md generator — the agent's capability inventory and delegation model.
 *
 * AGENTS.md reflects what the agent CAN do — its tools, skills, approval
 * gates, heartbeat behavior, and communication rules. This file is consumed
 * by the LLM at bootstrap to understand its own capabilities and constraints.
 *
 * Identity files are read-only at runtime (LM-12 prevention).
 */

import type { Blueprint, DelegationRule, DelegationTier } from "../blueprints/types.js";

/** Human-readable labels for each autonomy level. */
const AUTONOMY_LABELS: Record<string, string> = {
  low: "Conservative — most actions require user involvement",
  medium: "Balanced — routine tasks autonomous, significant actions need approval",
  high: "High autonomy — acts independently except for critical gates",
};

/**
 * Generate AGENTS.md content from a blueprint.
 *
 * Produces a capability inventory covering:
 * - Agent identity and role
 * - Tool inventory with categories and descriptions
 * - Skill inventory with descriptions
 * - Three-tier approval gates with per-action examples
 * - Heartbeat behavior patterns
 * - Communication rules
 */
export function generateAgents(blueprint: Blueprint): string {
  const { toolbelt, use_case_mapping: useCase } = blueprint;

  const sections: string[] = [
    `# Agent: ${blueprint.name}`,
    "",
    `**Replaces:** ${useCase.replaces}`,
    `**Role:** ${toolbelt.role}`,
    "",
    "## Tools",
    "",
    ...formatTools(blueprint),
    "",
    "## Skills",
    "",
    ...formatSkills(blueprint),
    "",
    ...formatApprovalGates(blueprint),
    ...formatHeartbeatBehavior(blueprint),
    ...formatCommunicationRules(blueprint),
  ];

  return sections.join("\n");
}

// ── Approval Gates ─────────────────────────────────────────────────────────

/** Format the three-tier approval gates section. */
function formatApprovalGates(blueprint: Blueprint): string[] {
  const { autonomy_model: autonomy } = blueprint;
  const level = autonomy.default;
  const delegation = autonomy.delegation ?? [];

  const lines: string[] = [
    "## Approval Gates",
    "",
    `**Autonomy level:** ${level} — ${AUTONOMY_LABELS[level] ?? level}`,
    "",
  ];

  if (delegation.length > 0) {
    // Group rules by tier
    const byTier = groupByTier(delegation);

    for (const tier of ["execute", "propose", "approve"] as const) {
      const rules = byTier[tier];
      if (rules.length === 0) continue;

      lines.push(`### ${tierHeading(tier)}`);
      lines.push("");
      for (const rule of rules) {
        lines.push(`- **${formatActionName(rule.action)}** — ${rule.example}`);
      }
      lines.push("");
    }
  }

  // Always list hard approval requirements from requires_approval
  if (autonomy.requires_approval.length > 0) {
    lines.push("**Hard gates (always require approval):**");
    for (const item of autonomy.requires_approval) {
      lines.push(`- ${formatActionName(item)}`);
    }
    lines.push("");
  }

  return lines;
}

/** Group delegation rules by tier. */
function groupByTier(
  rules: readonly DelegationRule[],
): Record<DelegationTier, DelegationRule[]> {
  const result: Record<DelegationTier, DelegationRule[]> = {
    execute: [],
    propose: [],
    approve: [],
  };
  for (const rule of rules) {
    result[rule.tier].push(rule);
  }
  return result;
}

/** Human-readable heading for each tier. */
function tierHeading(tier: DelegationTier): string {
  switch (tier) {
    case "execute": return "Execute — Agent acts autonomously";
    case "propose": return "Propose — Agent drafts, user approves";
    case "approve": return "Approve — User must explicitly request";
  }
}

/** Format a snake_case action name into readable form. */
function formatActionName(action: string): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Heartbeat Behavior ─────────────────────────────────────────────────────

/** Format the heartbeat behavior patterns section. */
function formatHeartbeatBehavior(blueprint: Blueprint): string[] {
  const { monitoring, cron_config: cron } = blueprint;

  const lines: string[] = [
    "## Heartbeat Behavior",
    "",
    `**Frequency:** ${monitoring.heartbeat_frequency}`,
    `**Quiet hours:** ${monitoring.quiet_hours}`,
    "",
    "During each heartbeat cycle:",
  ];

  // List monitored checks
  for (const check of monitoring.checks) {
    lines.push(`- Check ${check} integration health`);
  }

  // Work session and morning brief schedules
  if (cron.work_session) {
    lines.push(`- Run work session (${cron.work_session})`);
  }
  if (cron.morning_brief) {
    lines.push(`- Deliver morning brief (${cron.morning_brief})`);
  }

  lines.push("");

  // Alert conditions
  if (monitoring.alert_on.length > 0) {
    lines.push("**Alert on:**");
    for (const alert of monitoring.alert_on) {
      lines.push(`- ${formatActionName(alert)}`);
    }
    lines.push("");
  }

  return lines;
}

// ── Communication Rules ────────────────────────────────────────────────────

/** Format the communication rules section based on autonomy and monitoring. */
function formatCommunicationRules(blueprint: Blueprint): string[] {
  const { autonomy_model: autonomy, monitoring } = blueprint;
  const level = autonomy.default;

  const lines: string[] = [
    "## Communication Rules",
    "",
  ];

  // Rules vary by autonomy level
  if (level === "low") {
    lines.push("- Respond only when directly addressed or on scheduled cycles");
    lines.push("- Present findings and wait for direction before taking action");
    lines.push("- Batch non-critical updates into scheduled reports");
  } else if (level === "medium") {
    lines.push("- Proactive notifications for items requiring attention");
    lines.push("- Batch routine updates into scheduled digests");
    lines.push("- Escalate immediately for items in the approval gate");
  } else {
    lines.push("- Act autonomously on routine tasks, report results in digests");
    lines.push("- Interrupt only for items requiring explicit approval");
    lines.push("- Summarize autonomous actions in periodic activity reports");
  }

  lines.push(`- Respect quiet hours (${monitoring.quiet_hours}) — hold non-critical notifications`);
  lines.push("- Never disclose sensitive data in notifications — use references, not content");
  lines.push("");

  return lines;
}

// ── Tool / Skill Formatters ────────────────────────────────────────────────

/** Format tool entries as markdown lines. */
function formatTools(blueprint: Blueprint): string[] {
  const lines: string[] = [];
  for (const tool of blueprint.toolbelt.tools) {
    const req = tool.required ? "required" : "optional";
    lines.push(`- **${tool.name}** [${tool.category}] _(${req})_ — ${tool.description}`);
  }
  return lines;
}

/** Format skill entries as markdown lines. */
function formatSkills(blueprint: Blueprint): string[] {
  const lines: string[] = [];
  for (const skill of blueprint.toolbelt.skills) {
    const req = skill.required ? "required" : "optional";
    lines.push(`- **${skill.name}** _(${req})_ — ${skill.description}`);
  }
  return lines;
}
