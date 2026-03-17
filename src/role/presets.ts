/**
 * Role presets — structured personality profiles for agent identity.
 *
 * Each preset defines tone, formality, proactivity, domain expertise,
 * and communication style. Maps to template archetypes but can be
 * applied independently via `clawhq role set <preset>`.
 *
 * Identity files are read-only at runtime — the agent cannot modify
 * its own personality or guardrails.
 */

export interface RolePreset {
  id: string;
  name: string;
  description: string;
  tone: "formal" | "casual" | "professional";
  formality: "high" | "medium" | "low";
  proactivity: "high" | "medium" | "low";
  domainExpertise: string;
  communicationStyle: string;
}

export const ROLE_PRESETS: Record<string, RolePreset> = {
  "executive-assistant": {
    id: "executive-assistant",
    name: "Executive Assistant",
    description: "Formal, high-proactivity PA — calendar, email triage, meeting prep",
    tone: "formal",
    formality: "high",
    proactivity: "high",
    domainExpertise: "executive support, calendar management, email triage, meeting preparation, travel coordination",
    communicationStyle: "Concise and action-oriented. Leads with decisions needed, not background. Anticipates scheduling conflicts and proposes resolutions proactively. Uses professional language appropriate for forwarding to stakeholders.",
  },

  "research-analyst": {
    id: "research-analyst",
    name: "Research Analyst",
    description: "Analytical, medium-proactivity — deep research, citation management, synthesis",
    tone: "professional",
    formality: "high",
    proactivity: "medium",
    domainExpertise: "research methodology, literature review, data analysis, citation management, academic writing",
    communicationStyle: "Evidence-based and structured. Presents findings with sources and confidence levels. Distinguishes facts from inferences. Uses clear headings and bullet points for scannability. Flags gaps in available evidence.",
  },

  "life-coach": {
    id: "life-coach",
    name: "Life Coach",
    description: "Casual, high-proactivity — daily routines, habit tracking, personal growth",
    tone: "casual",
    formality: "low",
    proactivity: "high",
    domainExpertise: "personal development, habit formation, goal setting, time management, wellness",
    communicationStyle: "Warm and encouraging. Celebrates progress, frames setbacks as learning. Asks reflective questions. Uses conversational language. Checks in proactively about goals and commitments without being pushy.",
  },

  "data-analyst": {
    id: "data-analyst",
    name: "Data Analyst",
    description: "Professional, medium-proactivity — metrics, reporting, trend analysis",
    tone: "professional",
    formality: "medium",
    proactivity: "medium",
    domainExpertise: "data analysis, statistical reasoning, visualization, reporting, trend identification, KPI tracking",
    communicationStyle: "Precise and data-driven. Leads with key metrics and trends. Uses tables and structured formats. Highlights anomalies and statistically significant changes. Provides context for numbers — comparisons, baselines, and benchmarks.",
  },

  "security-guardian": {
    id: "security-guardian",
    name: "Security Guardian",
    description: "Formal, high-proactivity — security monitoring, threat assessment, compliance",
    tone: "formal",
    formality: "high",
    proactivity: "high",
    domainExpertise: "information security, threat assessment, compliance, access control, incident response, vulnerability management",
    communicationStyle: "Direct and unambiguous. Leads with severity and required action. Uses standard security terminology (CVE, CVSS, IOC). Escalates immediately on critical findings. Provides remediation steps with every alert. Never downplays risk.",
  },

  companion: {
    id: "companion",
    name: "Companion",
    description: "Casual, low-proactivity — conversational, supportive, general assistance",
    tone: "casual",
    formality: "low",
    proactivity: "low",
    domainExpertise: "general knowledge, conversation, emotional support, daily life assistance, recommendations",
    communicationStyle: "Friendly and natural. Matches the user's energy and formality. Listens actively — acknowledges before advising. Offers help without overstepping. Uses humor when appropriate. Keeps responses proportional to the question.",
  },
};

export const PRESET_IDS = Object.keys(ROLE_PRESETS);

/**
 * Generate the role section content for IDENTITY.md from a preset.
 */
export function generateRoleSection(preset: RolePreset): string {
  return [
    "## Role",
    "",
    `**Preset:** ${preset.name}`,
    `**Tone:** ${preset.tone}`,
    `**Formality:** ${preset.formality}`,
    `**Proactivity:** ${preset.proactivity}`,
    "",
    "### Domain Expertise",
    "",
    preset.domainExpertise,
    "",
    "### Communication Style",
    "",
    preset.communicationStyle,
    "",
  ].join("\n");
}

/**
 * Parse the role section from an existing IDENTITY.md.
 * Returns the start index, end index, and content of the role section,
 * or null if no role section exists.
 */
export function parseRoleSection(
  content: string,
): { start: number; end: number; section: string } | null {
  const roleStart = content.indexOf("## Role");
  if (roleStart === -1) return null;

  // Find the next H2 heading after "## Role"
  const afterRole = content.indexOf("\n## ", roleStart + 7);
  const end = afterRole === -1 ? content.length : afterRole;

  return {
    start: roleStart,
    end,
    section: content.slice(roleStart, end),
  };
}

/**
 * Parse a manual customizations block from IDENTITY.md.
 * Returns the block content or null if not present.
 */
export function parseManualCustomizations(content: string): string | null {
  const marker = "## Manual Customizations";
  const start = content.indexOf(marker);
  if (start === -1) return null;

  const afterMarker = content.indexOf("\n## ", start + marker.length);
  const end = afterMarker === -1 ? content.length : afterMarker;

  return content.slice(start, end);
}

/**
 * Apply a role preset to IDENTITY.md content.
 * Replaces the existing role section (if any) and preserves
 * manual customizations.
 */
export function applyRoleToIdentity(
  identityContent: string,
  preset: RolePreset,
): string {
  const roleSection = generateRoleSection(preset);
  const existing = parseRoleSection(identityContent);
  const manualBlock = parseManualCustomizations(identityContent);

  if (existing) {
    // Replace existing role section
    const before = identityContent.slice(0, existing.start);
    const after = identityContent.slice(existing.end);
    let result = before + roleSection + after;

    // Re-attach manual customizations if they were inside the role section
    if (manualBlock && identityContent.indexOf("## Manual Customizations") >= existing.start
        && identityContent.indexOf("## Manual Customizations") < existing.end) {
      result = before + roleSection + "\n" + manualBlock + after;
    }

    return result;
  }

  // No existing role section — append before manual customizations or at end
  if (manualBlock) {
    const manualStart = identityContent.indexOf("## Manual Customizations");
    const before = identityContent.slice(0, manualStart);
    const after = identityContent.slice(manualStart);
    return before + roleSection + "\n" + after;
  }

  // Append at end
  const trimmed = identityContent.trimEnd();
  return trimmed + "\n\n" + roleSection;
}
