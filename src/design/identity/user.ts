/**
 * USER.md generator — defines who the agent is serving.
 *
 * USER.md gives the agent context about its user: name, timezone,
 * communication preferences, and constraints. Without it, the agent
 * operates blind — it doesn't know who it's working for.
 *
 * Identity files are read-only at runtime (LM-12 prevention).
 */

import { sanitizeContentSync } from "../../secure/sanitizer/index.js";
import type { UserContext } from "../configure/types.js";

/**
 * Generate USER.md content from user context collected during setup.
 *
 * Produces a user profile covering:
 * - Who the user is (name)
 * - When they operate (timezone)
 * - How they want to communicate (preference)
 * - Key constraints (optional)
 */
export function generateUser(userContext: UserContext): string {
  const sections: string[] = [
    "# User Profile",
    "",
    `**Name:** ${sanitizeContentSync(userContext.name, { source: "user-context" }).text}`,
    `**Timezone:** ${sanitizeContentSync(userContext.timezone, { source: "user-context" }).text}`,
    "",
    "## Communication Preference",
    "",
    communicationDescription(userContext.communicationPreference),
  ];

  if (userContext.constraints) {
    const sanitized = sanitizeContentSync(userContext.constraints, { source: "user-context" });
    sections.push(
      "",
      "## Constraints",
      "",
      sanitized.text,
    );
  }

  return sections.join("\n") + "\n";
}

/** Map communication preference to prose description for the agent. */
function communicationDescription(pref: UserContext["communicationPreference"]): string {
  switch (pref) {
    case "brief":
      return "The user prefers brief, direct communication. Use bullet points, minimize prose, and get to the point quickly. Avoid unnecessary context or pleasantries.";
    case "detailed":
      return "The user prefers detailed communication with thorough explanations. Provide context, reasoning, and supporting information. Be comprehensive but organized.";
    case "conversational":
      return "The user prefers conversational, natural dialogue. Be friendly and approachable while remaining professional. Use a natural tone rather than formal or terse.";
  }
}
