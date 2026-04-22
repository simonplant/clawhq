/**
 * Catalog module — mission profiles + canonical personality.
 *
 * Profiles define WHAT the agent does (tools, cron, integrations, autonomy).
 * The canonical personality defines HOW (tone, voice, anti-patterns) — one
 * shipped vector, not a picker. The compiler resolves profile + canonical
 * personality into flat workspace files. Users customize tone via
 * `soul_overrides` free text.
 */

export type {
  CanonicalPersonality,
  CompiledFile,
  CompiledWorkspace,
  CompositionConfig,
  MissionProfile,
  UserConfig,
} from "./types.js";

export {
  loadAllProfiles,
  loadCanonicalPersonality,
  loadProfile,
} from "./loader.js";

export { compile } from "./compiler.js";

export type { Provider, ProviderEnvVar } from "./providers.js";
export {
  PROVIDERS,
  getBinariesForProviders,
  getDomains,
  getEgressForProviders,
  getProvider,
  getProvidersForDomain,
} from "./providers.js";
