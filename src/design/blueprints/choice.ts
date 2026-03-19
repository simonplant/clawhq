/**
 * Blueprint-to-choice conversion for wizard display.
 *
 * Converts loaded blueprints into choice objects suitable for the init wizard
 * (CQ-010) and `clawhq blueprint list/preview` commands.
 */

import type { Blueprint, BlueprintChoice } from "./types.js";
import type { LoadedBlueprint } from "./loader.js";

/**
 * Convert a Blueprint into a BlueprintChoice for wizard display.
 *
 * The choice object contains everything the init wizard and blueprint list
 * commands need to display a blueprint option to the user.
 *
 * @param blueprint — The parsed and validated blueprint
 * @returns A BlueprintChoice suitable for display in the wizard
 */
export function templateToChoice(blueprint: Blueprint): BlueprintChoice {
  return {
    name: blueprint.name,
    value: blueprint.name.toLowerCase().replace(/\s+/g, "-"),
    description: blueprint.use_case_mapping.description.trim(),
    tagline: blueprint.use_case_mapping.tagline,
    replaces: blueprint.use_case_mapping.replaces,
    requiredIntegrations: [...blueprint.integration_requirements.required],
    recommendedIntegrations: [...blueprint.integration_requirements.recommended],
    includedSkills: [...blueprint.skill_bundle.included],
    channels: [...blueprint.channels.supported],
    securityPosture: blueprint.security_posture.posture,
    autonomyLevel: blueprint.autonomy_model.default,
  };
}

/**
 * Convert all loaded blueprints into choices for wizard display.
 *
 * @param loaded — Array of loaded blueprints (from loadAllBuiltinBlueprints)
 * @returns Array of BlueprintChoice objects, sorted by name
 */
export function allTemplatesToChoices(
  loaded: readonly LoadedBlueprint[],
): BlueprintChoice[] {
  return loaded
    .map((l) => templateToChoice(l.blueprint))
    .sort((a, b) => a.name.localeCompare(b.name));
}
