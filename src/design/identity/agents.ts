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
 * - Standard operating procedures (scaled by blueprint complexity)
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
    ...formatKnowledgeBases(blueprint),
    ...formatApprovalGates(blueprint),
    ...formatHeartbeatBehavior(blueprint),
    ...formatCommunicationRules(blueprint),
    ...formatStandardOperatingProcedures(blueprint),
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

// ── Knowledge Bases ───────────────────────────────────────────────────────

/**
 * Detect LLM-maintained knowledge bases from the blueprint's skill list.
 *
 * Convention: a knowledge base named `<kb>` is present when the blueprint
 * includes `wiki-<kb>-ingest`, `wiki-<kb>-query`, and `wiki-<kb>-review`.
 * Derived from skills (rather than a blueprint field) so the wiki pattern
 * can be added or removed by editing the profile's skills list only.
 */
function detectKnowledgeBases(blueprint: Blueprint): string[] {
  const skillNames = new Set(blueprint.toolbelt.skills.map((s) => s.name));
  const names = new Set<string>();
  for (const name of skillNames) {
    const match = name.match(/^wiki-([a-z0-9-]+)-ingest$/);
    if (!match || !match[1]) continue;
    const kb = match[1];
    if (skillNames.has(`wiki-${kb}-query`) && skillNames.has(`wiki-${kb}-review`)) {
      names.add(kb);
    }
  }
  return [...names].sort();
}

/**
 * Emit the Knowledge Bases section for AGENTS.md when the blueprint's skills
 * indicate one or more KBs are present. Teaches the agent the three layers,
 * three operations, and two navigation files that make the Karpathy llm-wiki
 * pattern a discipline rather than a pile of markdown.
 */
function formatKnowledgeBases(blueprint: Blueprint): string[] {
  const kbs = detectKnowledgeBases(blueprint);
  if (kbs.length === 0) return [];

  const lines: string[] = [
    "## Knowledge Bases",
    "",
    "You maintain an LLM-curated wiki that compounds over time. It is not a document dump — it is the reasoning you will rely on next week. Treat maintenance as load-bearing work.",
    "",
  ];

  for (const kb of kbs) {
    lines.push(
      `### \`knowledge/${kb}/\``,
      "",
      "**Three layers:**",
      `- \`knowledge/${kb}/raw/\` — immutable sources. You never modify files here.`,
      `- \`knowledge/${kb}/wiki/\` — curated markdown pages with \`[[wiki links]]\`. You own this layer.`,
      "- This file (AGENTS.md) — the schema. It defines how the wiki works.",
      "",
      "**Three operations** — each has a dedicated skill:",
      `- **Ingest** (\`wiki-${kb}-ingest\`) — when a new source arrives, read it, discuss takeaways, update every affected page, cross-reference, update \`index.md\` and \`log.md\`. A single ingest commonly touches 10–15 pages.`,
      `- **Query** (\`wiki-${kb}-query\`) — answer questions wiki-first: load \`index.md\`, drill into relevant pages, cite with \`[[wiki links]]\`. Offer to file substantive syntheses back as new pages so explorations compound.`,
      `- **Review** (\`wiki-${kb}-review\`) — weekly health check: contradictions, stale claims, orphans, gaps. Complements \`llm-wiki lint\` (structural) with content judgment.`,
      "",
      "**Two navigation files:**",
      `- \`knowledge/${kb}/index.md\` — catalog of every page by category. Read this first on any query.`,
      `- \`knowledge/${kb}/log.md\` — chronological record. Append on every ingest/review. Entry format: \`## [YYYY-MM-DD] operation | Title\`.`,
      "",
      "**CLI** — `llm-wiki` is installed inside the container. Run from the workspace root or pass `--path knowledge/" + kb + "`:",
      `- \`llm-wiki context --path knowledge/${kb}\` — briefing (page count, unprocessed sources, issues, recent activity).`,
      `- \`llm-wiki stats --path knowledge/${kb}\` — health dashboard.`,
      `- \`llm-wiki lint --fix --path knowledge/${kb}\` — structural checks with auto-fix.`,
      `- \`llm-wiki ingest <file> --path knowledge/${kb}\` — stage a source into \`raw/\`.`,
      "",
      "**Session start:** read `workspace/state/wiki-context.md` — a cron refreshes it every 30 min with `llm-wiki context`. That tells you the wiki's current state without re-scanning.",
      "",
      "**Conventions:**",
      "- Every wiki page has YAML frontmatter: `tags`, `confidence` (verified/reported/estimated/speculative), `last-verified`, `source-count`.",
      "- Every claim cites its source: `per [[page-slug]]` or `per raw/<file>.md`.",
      "- When two sources disagree, document both positions and the evidence — never silently pick one.",
      "- Update existing pages when topics overlap; only create a new page when a concept genuinely stands alone.",
      "- File non-trivial query answers back as wiki pages under **Comparisons** or **Analyses**. Don't let valuable syntheses die in chat history.",
      "",
    );
  }

  return lines;
}

// ── Standard Operating Procedures ─────────────────────────────────────────

/**
 * Determine whether a blueprint is "complex" for SOP scaling.
 *
 * Complex = has active cron jobs (work_session or morning_brief) OR
 *           autonomy level is medium/high.
 * Simple (minimal) = low autonomy, no cron beyond heartbeat.
 */
function isComplexBlueprint(blueprint: Blueprint): boolean {
  const { cron_config: cron, autonomy_model: autonomy } = blueprint;
  const hasCronJobs = !!(cron.work_session || cron.morning_brief);
  const hasHighAutonomy = autonomy.default !== "low";
  return hasCronJobs || hasHighAutonomy;
}

/** Whether quiet_hours are configured (not empty/none). */
function hasQuietHours(blueprint: Blueprint): boolean {
  const qh = blueprint.monitoring.quiet_hours;
  return !!qh && qh !== "none" && /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(qh);
}

/** Whether cron_config has active jobs beyond heartbeat. */
function hasActiveCronJobs(blueprint: Blueprint): boolean {
  const cron = blueprint.cron_config;
  return !!(cron.work_session || cron.morning_brief);
}

/**
 * Format standard operating procedures section.
 *
 * Content scales by blueprint complexity:
 * - Simple (low autonomy, no cron): startup ritual + memory discipline (2 sections)
 * - Complex: all 5 sections (startup, memory, data freshness, overnight batching, cron mapping)
 *
 * AC4: overnight batching only when quiet_hours configured.
 * AC5: cron role mapping only when cron_config has jobs.
 */
function formatStandardOperatingProcedures(blueprint: Blueprint): string[] {
  const lines: string[] = [
    "## Standard Operating Procedures",
    "",
  ];

  // Always included: session startup ritual
  lines.push(...formatSessionStartup());

  // Always included: memory discipline
  lines.push(...formatMemoryDiscipline());

  // Complex blueprints get additional sections
  if (isComplexBlueprint(blueprint)) {
    lines.push(...formatDataFreshness());

    if (hasQuietHours(blueprint)) {
      lines.push(...formatOvernightBatching(blueprint));
    }

    if (hasActiveCronJobs(blueprint)) {
      lines.push(...formatCronRoleMapping(blueprint));
    }
  }

  return lines;
}

/** Session startup ritual — read order matters for context priming. */
function formatSessionStartup(): string[] {
  return [
    "### Session Startup Ritual",
    "",
    "On every session start, read files in this exact order:",
    "",
    "1. **SOUL.md** — who you are, personality, boundaries",
    "2. **USER.md** — who you serve, their preferences and constraints",
    "3. **Daily memory** (`memory/YYYY-MM-DD.md`) — today's raw context",
    "4. **MEMORY.md** _(main session only)_ — curated long-term memory",
    "",
    "Order matters: identity before user, today before history. Skipping a file means operating without that context — never acceptable.",
    "",
  ];
}

/** Memory discipline — where to write, what goes where. */
function formatMemoryDiscipline(): string[] {
  return [
    "### Memory Discipline",
    "",
    "Three memory tiers — use the right one:",
    "",
    "| Tier | File | What goes here |",
    "|------|------|---------------|",
    "| **Daily** | `memory/YYYY-MM-DD.md` | Raw observations, decisions, events — everything from today |",
    "| **Curated** | `MEMORY.md` | Patterns, preferences, long-term facts distilled from daily logs |",
    "| **Static** | `USER.md` | User identity facts that rarely change (name, timezone, constraints) |",
    "",
    "**Rule:** Write it down or lose it. If you learn something about the user, a decision was made, or context will matter tomorrow — log it in the daily file immediately. Curate into MEMORY.md at end of day.",
    "",
  ];
}

/** Data freshness rules — verify before citing. */
function formatDataFreshness(): string[] {
  return [
    "### Data Freshness",
    "",
    "- **Verify before citing** — cached data may be stale. Check tool output timestamps before presenting as current.",
    "- **Stale data is worse than no data** — if you cannot verify freshness, say so. Never present yesterday's data as today's.",
    "- **Re-fetch on doubt** — when a user asks about current state, always query the live source rather than relying on memory.",
    "",
  ];
}

/** Overnight batching — batch findings during quiet hours. */
function formatOvernightBatching(blueprint: Blueprint): string[] {
  const quietHours = blueprint.monitoring.quiet_hours;

  return [
    "### Overnight Batching",
    "",
    `During quiet hours (**${quietHours}**):`,
    "",
    "- **Batch all findings** into files — do not send notifications.",
    "- **Deliver ONE digest** at the next morning brief time. Consolidate overnight observations into a single summary.",
    "- **Never interrupt overnight** unless it is an emergency: circuit breaker tripped, critical alert, or system failure.",
    "",
  ];
}

/** Cron role mapping — table showing what each job does. */
function formatCronRoleMapping(blueprint: Blueprint): string[] {
  const cron = blueprint.cron_config;
  const routing = cron.model_routing;

  const lines: string[] = [
    "### Scheduled Jobs",
    "",
    "| Job | Schedule | Model | Session | Delivery |",
    "|-----|----------|-------|---------|----------|",
  ];

  if (cron.heartbeat) {
    const r = routing?.heartbeat;
    lines.push(
      `| Heartbeat | \`${cron.heartbeat}\` | ${r?.model ?? "default"} | ${cron.session_target?.heartbeat ?? "isolated"} | ${cron.delivery?.heartbeat ?? "none"} |`,
    );
  }

  if (cron.work_session) {
    const r = routing?.work_session;
    lines.push(
      `| Work Session | \`${cron.work_session}\` | ${r?.model ?? "default"} | ${cron.session_target?.work_session ?? "main"} | ${cron.delivery?.work_session ?? "none"} |`,
    );
  }

  if (cron.morning_brief) {
    const r = routing?.morning_brief;
    lines.push(
      `| Morning Brief | \`${cron.morning_brief}\` | ${r?.model ?? "default"} | ${cron.session_target?.morning_brief ?? "main"} | ${cron.delivery?.morning_brief ?? "announce"} |`,
    );
  }

  lines.push("");

  return lines;
}
