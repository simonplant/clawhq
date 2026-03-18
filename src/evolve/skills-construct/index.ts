/**
 * Skill generators — produces skill directory structures.
 */

import { generateConstructSkill } from "./construct.js";
import { generateMorningBriefSkill } from "./morning-brief.js";

export interface SkillFiles {
  /** skill-name → { relative-path → content } */
  [skillName: string]: Record<string, string>;
}

/**
 * Generate skill files based on template's skillsIncluded list.
 */
export function generateSkills(skillsIncluded: string[]): SkillFiles {
  const skills: SkillFiles = {};

  for (const skillId of skillsIncluded) {
    const generator = SKILL_GENERATORS[skillId];
    if (generator) {
      skills[skillId] = generator();
    }
  }

  return skills;
}

const SKILL_GENERATORS: Record<string, () => Record<string, string>> = {
  construct: generateConstructSkill,
  "morning-brief": generateMorningBriefSkill,
};
