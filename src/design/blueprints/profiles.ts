/**
 * Mission profile registry — default tool deny lists and recommended integrations.
 *
 * Each mission profile declares what the agent should NOT have access to by default
 * (deny list) and what integrations are recommended for that profile. Blueprints
 * reference profiles via `profile_ref` and the compiler merges profile defaults
 * with any blueprint-level overrides using deny-wins semantics.
 */

// ── Profile Types ──────────────────────────────────────────────────────────

/** Recognized mission profile identifiers. */
export type MissionProfileId = "lifeops" | "dev" | "research" | "markets" | "marketing";

/** Default deny list and recommended integrations for a mission profile. */
export interface MissionProfileDefaults {
  /** Tools denied by default for this profile. */
  readonly deny: readonly string[];
  /** Integrations recommended for this profile. */
  readonly recommended_integrations: readonly string[];
}

// ── Profile Registry ───────────────────────────────────────────────────────

/**
 * Default tool deny lists and recommended integrations per mission profile.
 *
 * - **LifeOps** — Personal admin (email, calendar, tasks). No browser or nodes needed.
 * - **Dev** — Full runtime access. Nothing denied.
 * - **Research** — Web search, synthesis. No device control.
 * - **Markets** — Financial data + charting. Browser allowed for TradingView, nodes denied.
 * - **Marketing** — Content creation + social. No device control.
 */
export const MISSION_PROFILE_DEFAULTS: Readonly<Record<MissionProfileId, MissionProfileDefaults>> = {
  lifeops: {
    deny: ["browser", "nodes"],
    recommended_integrations: ["email", "calendar", "tasks", "weather", "messaging"],
  },
  dev: {
    deny: [],
    recommended_integrations: ["github", "git", "ci-cd", "sentry", "linear"],
  },
  research: {
    deny: ["nodes"],
    recommended_integrations: ["web-search", "knowledge-base", "obsidian"],
  },
  markets: {
    deny: ["nodes"],
    recommended_integrations: ["market-data", "portfolio", "browser", "trading"],
  },
  marketing: {
    deny: ["nodes"],
    recommended_integrations: ["social-media", "analytics", "content-calendar", "seo"],
  },
};

/** All valid mission profile IDs. */
export const MISSION_PROFILE_IDS: readonly MissionProfileId[] = Object.keys(MISSION_PROFILE_DEFAULTS) as MissionProfileId[];

/**
 * Check whether a string is a valid mission profile ID.
 */
export function isValidProfileId(id: string): id is MissionProfileId {
  return MISSION_PROFILE_IDS.includes(id as MissionProfileId);
}

/**
 * Merge a profile's deny list with blueprint-level overrides.
 *
 * Merge semantics (deny-wins):
 * 1. Start with the profile's deny list as the base
 * 2. Add any blueprint-level deny entries (union)
 * 3. Remove entries that appear in blueprint allow BUT NOT in blueprint deny
 * 4. If something is in both blueprint deny and allow, deny wins
 *
 * Returns deduplicated, sorted deny list.
 */
export function mergeProfileDeny(
  profileDeny: readonly string[],
  blueprintDeny: readonly string[],
  blueprintAllow: readonly string[],
): string[] {
  // Step 1+2: Union of profile deny and blueprint deny
  const combined = new Set([...profileDeny, ...blueprintDeny]);

  // Step 3+4: Remove items that are in allow but NOT in blueprint deny (deny-wins)
  const blueprintDenySet = new Set(blueprintDeny);
  for (const tool of blueprintAllow) {
    if (!blueprintDenySet.has(tool)) {
      combined.delete(tool);
    }
  }

  return [...combined].sort();
}
