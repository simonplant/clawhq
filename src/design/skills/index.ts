/**
 * Pre-built skills module — platform and blueprint skill loading.
 *
 * Platform skills (cron-doctor, scanner-triage) are always included.
 * Blueprint skills are selected via skill_bundle.included.
 */

export type { SkillFileEntry } from "./loader.js";
export {
  listConfigSkillNames,
  listPlatformSkillNames,
  loadBlueprintSkills,
  loadPlatformSkills,
} from "./loader.js";
