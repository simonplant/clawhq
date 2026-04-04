/**
 * Catalog module — mission profiles × personality presets.
 *
 * Profiles define WHAT the agent does (tools, cron, integrations, autonomy).
 * Personalities define HOW the agent does it (tone, values, voice, anti-patterns).
 * The compiler resolves profile + personality into flat workspace files.
 */

export type {
  CompiledFile,
  CompiledWorkspace,
  CompositionConfig,
  MissionProfile,
  PersonalityPreset,
  UserConfig,
} from "./types.js";

export {
  loadAllPersonalities,
  loadAllProfiles,
  loadPersonality,
  loadProfile,
} from "./loader.js";

export { compile } from "./compiler.js";
