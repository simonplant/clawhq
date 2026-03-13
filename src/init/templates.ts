/**
 * Built-in templates for the init wizard.
 *
 * Each template maps a use-case ("Replace Google Assistant") to operational
 * dimensions (personality, security, monitoring, etc.) as defined in
 * OPENCLAW-REFERENCE.md → Template System Design.
 */

import type { TemplateChoice } from "./types.js";

export const BUILT_IN_TEMPLATES: TemplateChoice[] = [
  {
    id: "replace-google-assistant",
    name: "Replace Google Assistant",
    useCase: "Daily life management — morning briefs, calendar, email triage, reminders",
    description:
      "Proactive steward that manages your digital life. Handles email triage, " +
      "calendar management, morning briefs, and task tracking. Pushes back when " +
      "your schedule is overloaded.",
    personality: {
      tone: "direct",
      style: "proactive, no sugarcoating, protective of user's time and attention",
      relationship: "trusted steward",
      boundaries: "will challenge bad ideas, will refuse harmful requests",
    },
    security: {
      posture: "hardened",
      egress: "restricted",
      identityMount: "read-only",
    },
    monitoring: {
      heartbeatFrequency: "10min",
      checks: ["email", "calendar", "tasks"],
      quietHours: "23:00-05:00",
      alertOn: ["credential_expiry", "memory_bloat", "cron_failure", "integration_degraded"],
    },
    memory: {
      hotMax: "100KB",
      hotRetention: "7d",
      warmRetention: "90d",
      coldRetention: "365d",
      summarization: "balanced",
    },
    cron: {
      heartbeat: "*/10 waking",
      workSession: "*/15 waking",
      morningBrief: "08:00",
    },
    autonomy: {
      default: "high",
      requiresApproval: ["large_purchases", "account_changes", "public_posts"],
    },
    integrationsRequired: ["messaging"],
    integrationsRecommended: ["email", "calendar", "tasks"],
    skillsIncluded: ["morning-brief", "construct"],
  },
  {
    id: "replace-chatgpt-plus",
    name: "Replace ChatGPT Plus",
    useCase: "Research and writing partner — deep research, drafts, brainstorming",
    description:
      "Research and writing partner that handles deep research, citation " +
      "management, writing assistance, and brainstorming. Minimizes interruptions " +
      "and works deeply on demand.",
    personality: {
      tone: "thoughtful",
      style: "precise, thorough, focuses on depth over breadth",
      relationship: "research partner",
      boundaries: "prioritizes accuracy, flags uncertainty",
    },
    security: {
      posture: "hardened",
      egress: "restricted",
      identityMount: "read-only",
    },
    monitoring: {
      heartbeatFrequency: "30min",
      checks: ["research"],
      quietHours: "23:00-07:00",
      alertOn: ["credential_expiry", "memory_bloat"],
    },
    memory: {
      hotMax: "200KB",
      hotRetention: "14d",
      warmRetention: "180d",
      coldRetention: "365d",
      summarization: "conservative",
    },
    cron: {
      heartbeat: "*/30 waking",
      workSession: "*/60 waking",
      morningBrief: "09:00",
    },
    autonomy: {
      default: "low",
      requiresApproval: ["public_posts", "sending_messages", "account_changes"],
    },
    integrationsRequired: ["messaging"],
    integrationsRecommended: ["research", "code"],
    skillsIncluded: ["construct"],
  },
  {
    id: "replace-my-pa",
    name: "Replace my PA",
    useCase: "Calendar, email triage, task management — professional assistant",
    description:
      "Professional assistant that manages your calendar, triages email, " +
      "tracks tasks, and preps for meetings. Handles routine autonomously, " +
      "escalates exceptions.",
    personality: {
      tone: "professional",
      style: "efficient, anticipatory, handles routine, flags exceptions",
      relationship: "professional aide",
      boundaries: "respects work boundaries, escalates sensitive decisions",
    },
    security: {
      posture: "hardened",
      egress: "restricted",
      identityMount: "read-only",
    },
    monitoring: {
      heartbeatFrequency: "10min",
      checks: ["email", "calendar", "tasks"],
      quietHours: "22:00-06:00",
      alertOn: ["credential_expiry", "memory_bloat", "cron_failure", "integration_degraded"],
    },
    memory: {
      hotMax: "100KB",
      hotRetention: "7d",
      warmRetention: "90d",
      coldRetention: "365d",
      summarization: "balanced",
    },
    cron: {
      heartbeat: "*/10 waking",
      workSession: "*/15 waking",
      morningBrief: "07:30",
    },
    autonomy: {
      default: "medium",
      requiresApproval: ["sending_emails", "creating_events", "large_purchases", "public_posts"],
    },
    integrationsRequired: ["messaging", "email", "calendar"],
    integrationsRecommended: ["tasks"],
    skillsIncluded: ["morning-brief", "construct"],
  },
  {
    id: "family-hub",
    name: "Family Hub",
    useCase: "Shared calendar, chore tracking, meal planning — family coordinator",
    description:
      "Family coordinator that manages shared calendar, chore assignments, " +
      "meal planning, and household tasks. Encouraging tone with firm reminders.",
    personality: {
      tone: "warm",
      style: "encouraging but firm, organized, family-friendly",
      relationship: "family coordinator",
      boundaries: "respects family member autonomy, enforces shared commitments",
    },
    security: {
      posture: "hardened",
      egress: "restricted",
      identityMount: "read-only",
    },
    monitoring: {
      heartbeatFrequency: "15min",
      checks: ["calendar", "tasks"],
      quietHours: "21:00-06:00",
      alertOn: ["credential_expiry", "cron_failure"],
    },
    memory: {
      hotMax: "80KB",
      hotRetention: "7d",
      warmRetention: "60d",
      coldRetention: "180d",
      summarization: "aggressive",
    },
    cron: {
      heartbeat: "*/15 waking",
      workSession: "*/30 waking",
      morningBrief: "07:00",
    },
    autonomy: {
      default: "medium",
      requiresApproval: ["account_changes", "large_purchases"],
    },
    integrationsRequired: ["messaging", "calendar"],
    integrationsRecommended: ["tasks"],
    skillsIncluded: ["morning-brief"],
  },
  {
    id: "research-copilot",
    name: "Research Co-pilot",
    useCase: "Deep research, citation management, writing — academic researcher",
    description:
      "Academic research partner for deep research, citation management, " +
      "literature review, and technical writing. Operates on-demand with " +
      "minimal proactive interruption.",
    personality: {
      tone: "analytical",
      style: "precise, citation-aware, methodical, minimal interruption",
      relationship: "research partner",
      boundaries: "prioritizes accuracy, demands evidence, flags speculation",
    },
    security: {
      posture: "paranoid",
      egress: "allowlist-only",
      identityMount: "read-only",
    },
    monitoring: {
      heartbeatFrequency: "60min",
      checks: ["research"],
      quietHours: "22:00-08:00",
      alertOn: ["credential_expiry"],
    },
    memory: {
      hotMax: "200KB",
      hotRetention: "30d",
      warmRetention: "365d",
      coldRetention: "730d",
      summarization: "conservative",
    },
    cron: {
      heartbeat: "*/60 waking",
      workSession: "",
      morningBrief: "",
    },
    autonomy: {
      default: "low",
      requiresApproval: ["sending_messages", "public_posts", "account_changes"],
    },
    integrationsRequired: ["messaging"],
    integrationsRecommended: ["research", "code", "notes"],
    skillsIncluded: ["construct"],
  },
  {
    id: "founders-ops",
    name: "Founder's Ops",
    useCase: "Inbox zero, investor updates, hiring pipeline — startup founder",
    description:
      "Startup operator that handles inbox zero, investor update prep, " +
      "hiring pipeline tracking, and meeting management. High autonomy " +
      "on routine tasks, protective of deep work time.",
    personality: {
      tone: "direct",
      style: "high-energy, protective of focus time, outcome-oriented",
      relationship: "chief of staff",
      boundaries: "guards deep work blocks, pushes back on low-priority requests",
    },
    security: {
      posture: "hardened",
      egress: "restricted",
      identityMount: "read-only",
    },
    monitoring: {
      heartbeatFrequency: "10min",
      checks: ["email", "calendar", "tasks", "code"],
      quietHours: "23:00-06:00",
      alertOn: ["credential_expiry", "memory_bloat", "cron_failure", "integration_degraded"],
    },
    memory: {
      hotMax: "150KB",
      hotRetention: "14d",
      warmRetention: "90d",
      coldRetention: "365d",
      summarization: "balanced",
    },
    cron: {
      heartbeat: "*/10 waking",
      workSession: "*/15 waking",
      morningBrief: "06:30",
    },
    autonomy: {
      default: "high",
      requiresApproval: ["large_purchases", "public_posts", "hiring_decisions"],
    },
    integrationsRequired: ["messaging", "email", "calendar"],
    integrationsRecommended: ["tasks", "code"],
    skillsIncluded: ["morning-brief", "construct"],
  },
];

export function getTemplateById(id: string): TemplateChoice | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id);
}

export function formatTemplateList(): string {
  const lines: string[] = [];
  for (let i = 0; i < BUILT_IN_TEMPLATES.length; i++) {
    const t = BUILT_IN_TEMPLATES[i];
    lines.push(`  ${i + 1}. ${t.name}`);
    lines.push(`     ${t.useCase}`);
  }
  return lines.join("\n");
}
