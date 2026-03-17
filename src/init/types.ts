/**
 * Types for the init wizard guided questionnaire.
 *
 * Each wizard step collects answers that feed into config generation.
 */

export interface WizardBasics {
  agentName: string;
  timezone: string;
  wakingHoursStart: string;
  wakingHoursEnd: string;
}

export interface TemplateChoice {
  id: string;
  name: string;
  description: string;
  useCase: string;
  personality: TemplatePersonality;
  security: TemplateSecurity;
  monitoring: TemplateMonitoring;
  memory: TemplateMemory;
  cron: TemplateCron;
  autonomy: TemplateAutonomy;
  integrationsRequired: string[];
  integrationsRecommended: string[];
  skillsIncluded: string[];
  channels?: {
    supported: string[];
    default: string;
  };
  toolbelt?: TemplateChoiceToolbelt;
}

export interface TemplateChoiceToolbelt {
  role: string;
  description: string;
  tools: TemplateChoiceToolbeltTool[];
  skills: TemplateChoiceToolbeltSkill[];
}

export interface TemplateChoiceToolbeltTool {
  name: string;
  category: string;
  required: boolean;
  description: string;
}

export interface TemplateChoiceToolbeltSkill {
  name: string;
  required: boolean;
  description: string;
}

export interface TemplatePersonality {
  tone: string;
  style: string;
  relationship: string;
  boundaries: string;
}

export interface TemplateSecurity {
  posture: "standard" | "hardened" | "paranoid";
  egress: "default" | "restricted" | "allowlist-only";
  identityMount: "read-only";
}

export interface TemplateMonitoring {
  heartbeatFrequency: string;
  checks: string[];
  quietHours: string;
  alertOn: string[];
}

export interface TemplateMemory {
  hotMax: string;
  hotRetention: string;
  warmRetention: string;
  coldRetention: string;
  summarization: "aggressive" | "balanced" | "conservative";
}

export interface TemplateCron {
  heartbeat: string;
  workSession: string;
  morningBrief: string;
}

export interface TemplateAutonomy {
  default: "low" | "medium" | "high";
  requiresApproval: string[];
}

export interface IntegrationSetup {
  provider: string;
  category: string;
  envVar: string;
  credential: string;
  validated: boolean;
}

export interface ModelRoutingSetup {
  localOnly: boolean;
  cloudProviders: CloudProviderSetup[];
  categories: ModelCategoryPolicy[];
}

export interface CloudProviderSetup {
  provider: string;
  envVar: string;
  credential: string;
  validated: boolean;
}

export interface ModelCategoryPolicy {
  category: string;
  cloudAllowed: boolean;
}

export interface WizardAnswers {
  basics: WizardBasics;
  template: TemplateChoice;
  integrations: IntegrationSetup[];
  modelRouting: ModelRoutingSetup;
  emailAddress?: string;
}

export interface WizardStepResult<T> {
  value: T;
  skipped: boolean;
}

/**
 * Prompt function type — abstracts over readline/inquirer/test doubles.
 * Returns the user's answer as a string.
 */
export type PromptFn = (question: string, defaultValue?: string) => Promise<string>;

/**
 * Select function type — presents choices and returns selected index.
 */
export type SelectFn = (question: string, choices: string[]) => Promise<number>;

/**
 * Confirm function type — asks yes/no question, returns boolean.
 */
export type ConfirmFn = (question: string, defaultValue?: boolean) => Promise<boolean>;

export interface WizardIO {
  prompt: PromptFn;
  select: SelectFn;
  confirm: ConfirmFn;
  log: (message: string) => void;
}

// --- Auto-detection types ---

/** Known email provider with related service discovery. */
export interface ProviderDiscovery {
  provider: string;
  calendar?: string;
  tasks?: string;
}

/** A model discovered from the local Ollama instance. */
export interface DiscoveredModel {
  name: string;
  sizeBytes: number;
  parameterSize: string;
  capabilities: ModelCapabilities;
}

export interface ModelCapabilities {
  reasoning: "low" | "medium" | "high";
  coding: "low" | "medium" | "high";
  longContext: boolean;
}

/** A routing suggestion for a task category based on available models. */
export interface RoutingSuggestion {
  category: string;
  suggestedModel: string;
  reason: string;
  cloudNeeded: boolean;
}

/** Result of running auto-detection before integration setup. */
export interface DetectionResult {
  /** Related services discovered from email provider. */
  discoveredIntegrations: ProviderDiscovery | null;
  /** Ollama models found on localhost. */
  ollamaModels: DiscoveredModel[];
  /** Suggested routing per task category. */
  routingSuggestions: RoutingSuggestion[];
  /** Whether Ollama is reachable at all. */
  ollamaAvailable: boolean;
}
