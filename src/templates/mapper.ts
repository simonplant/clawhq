/**
 * Template-to-config mapper — generates a DeploymentBundle from a Template
 * combined with setup answers (agent name, timezone, waking hours, credentials).
 *
 * Delegates bundle generation to src/init/generate.ts (the single source of
 * truth for bundle generation) after converting Template + MapperAnswers into
 * WizardAnswers.
 */

import { generate, type GeneratedConfig } from "../init/generate.js";
import type { WizardAnswers, IntegrationSetup, ModelRoutingSetup } from "../init/types.js";

import { templateToChoice } from "./loader.js";
import type { Template } from "./types.js";

// --- Mapper input ---

export interface MapperAnswers {
  agentName: string;
  timezone: string;
  wakingHoursStart: string;
  wakingHoursEnd: string;
  integrations: MapperIntegration[];
  cloudProviders: MapperCloudProvider[];
}

export interface MapperIntegration {
  provider: string;
  category: string;
  envVar: string;
  credential: string;
}

export interface MapperCloudProvider {
  provider: string;
  envVar: string;
  credential: string;
}

// --- Mapper output (re-exported from generate) ---

export type MapperResult = GeneratedConfig;

// --- Convert MapperAnswers → WizardAnswers ---

function toWizardAnswers(template: Template, answers: MapperAnswers): WizardAnswers {
  // Derive the template ID from the template name (slug it)
  const id = template.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const choice = templateToChoice(id, template);

  const integrations: IntegrationSetup[] = answers.integrations.map((i) => ({
    provider: i.provider,
    category: i.category,
    envVar: i.envVar,
    credential: i.credential,
    validated: false,
  }));

  const modelRouting: ModelRoutingSetup = {
    localOnly: answers.cloudProviders.length === 0,
    cloudProviders: answers.cloudProviders.map((cp) => ({
      provider: cp.provider,
      envVar: cp.envVar,
      credential: cp.credential,
      validated: false,
    })),
    categories: [],
  };

  return {
    basics: {
      agentName: answers.agentName,
      timezone: answers.timezone,
      wakingHoursStart: answers.wakingHoursStart,
      wakingHoursEnd: answers.wakingHoursEnd,
    },
    template: choice,
    integrations,
    modelRouting,
  };
}

// --- Main mapper function ---

/** Generate a complete DeploymentBundle from a Template and user answers. */
export function mapTemplateToConfig(template: Template, answers: MapperAnswers): MapperResult {
  const wizardAnswers = toWizardAnswers(template, answers);
  return generate(wizardAnswers);
}
