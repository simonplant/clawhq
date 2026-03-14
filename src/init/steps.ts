/**
 * Wizard steps for `clawhq init --guided`.
 *
 * Each step collects answers via the WizardIO abstraction,
 * keeping the logic testable without actual terminal I/O.
 */

import { runDetection, type FetchFn } from "./detect.js";
import { getBuiltInTemplates, formatTemplateList } from "./templates.js";
import type {
  CloudProviderSetup,
  DetectionResult,
  IntegrationSetup,
  ModelCategoryPolicy,
  ModelRoutingSetup,
  TemplateChoice,
  WizardBasics,
  WizardIO,
} from "./types.js";

// --- Known integration categories and their env vars ---

interface IntegrationDef {
  category: string;
  label: string;
  envVar: string;
  promptLabel: string;
}

const INTEGRATION_DEFS: IntegrationDef[] = [
  { category: "messaging", label: "Messaging (Telegram)", envVar: "TELEGRAM_BOT_TOKEN", promptLabel: "Telegram bot token" },
  { category: "email", label: "Email (IMAP)", envVar: "EMAIL_PASSWORD", promptLabel: "Email app password" },
  { category: "calendar", label: "Calendar (CalDAV)", envVar: "CALDAV_PASSWORD", promptLabel: "CalDAV password" },
  { category: "tasks", label: "Tasks (Todoist)", envVar: "TODOIST_API_KEY", promptLabel: "Todoist API key" },
  { category: "code", label: "Code (GitHub)", envVar: "GITHUB_TOKEN", promptLabel: "GitHub personal access token" },
  { category: "research", label: "Research (Tavily)", envVar: "TAVILY_API_KEY", promptLabel: "Tavily API key" },
];

// --- Known cloud providers ---

interface CloudProviderDef {
  provider: string;
  label: string;
  envVar: string;
  promptLabel: string;
}

const CLOUD_PROVIDER_DEFS: CloudProviderDef[] = [
  { provider: "anthropic", label: "Anthropic (Claude)", envVar: "ANTHROPIC_API_KEY", promptLabel: "Anthropic API key" },
  { provider: "openai", label: "OpenAI (GPT)", envVar: "OPENAI_API_KEY", promptLabel: "OpenAI API key" },
];

const MODEL_CATEGORIES = [
  { category: "email", label: "Email triage" },
  { category: "calendar", label: "Calendar management" },
  { category: "research", label: "Research" },
  { category: "writing", label: "Creative writing" },
  { category: "coding", label: "Code generation" },
];

// --- Step 1: Basics ---

const TIMEZONE_PATTERN = /^[A-Za-z]+\/[A-Za-z_]+$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function stepBasics(io: WizardIO): Promise<WizardBasics> {
  io.log("");
  io.log("Step 1/6: Basics");
  io.log("─────────────────");
  io.log("");

  const agentName = await io.prompt("Agent name", "openclaw");
  if (!agentName) {
    throw new Error("Agent name is required");
  }

  const timezone = await io.prompt("Timezone (e.g. America/Los_Angeles)", Intl.DateTimeFormat().resolvedOptions().timeZone);
  if (!TIMEZONE_PATTERN.test(timezone)) {
    io.log(`Warning: "${timezone}" doesn't look like a valid IANA timezone. Using as-is.`);
  }

  let wakingStart = await io.prompt("Waking hours start (HH:MM)", "06:00");
  if (!TIME_PATTERN.test(wakingStart)) {
    io.log(`Warning: "${wakingStart}" is not valid HH:MM format. Using 06:00.`);
    wakingStart = "06:00";
  }

  let wakingEnd = await io.prompt("Waking hours end (HH:MM)", "23:00");
  if (!TIME_PATTERN.test(wakingEnd)) {
    io.log(`Warning: "${wakingEnd}" is not valid HH:MM format. Using 23:00.`);
    wakingEnd = "23:00";
  }

  return {
    agentName,
    timezone,
    wakingHoursStart: wakingStart,
    wakingHoursEnd: wakingEnd,
  };
}

// --- Step 2: Template selection ---

export async function stepTemplate(io: WizardIO): Promise<TemplateChoice> {
  io.log("");
  io.log("Step 2/6: Template Selection");
  io.log("────────────────────────────");
  io.log("");
  io.log("Choose a template based on what you're replacing:");
  io.log("");
  io.log(await formatTemplateList());
  io.log("");

  const templates = await getBuiltInTemplates();
  const choices = templates.map((t) => t.name);
  const idx = await io.select("Select template", choices);

  const template = templates[idx];
  io.log("");
  io.log(`Selected: ${template.name}`);
  io.log(`  ${template.description}`);
  io.log("");
  io.log(`  Security posture: ${template.security.posture}`);
  io.log(`  Autonomy: ${template.autonomy.default}`);
  io.log(`  Required integrations: ${template.integrationsRequired.join(", ")}`);
  io.log(`  Recommended integrations: ${template.integrationsRecommended.join(", ")}`);

  return template;
}

// --- Step 3a: Auto-detection ---

export async function stepDetection(
  io: WizardIO,
  template: TemplateChoice,
  emailAddress?: string,
  fetchFn?: FetchFn,
): Promise<DetectionResult> {
  io.log("");
  io.log("Step 3/6: Auto-Detection");
  io.log("────────────────────────");
  io.log("");
  io.log("Scanning for available services and models...");
  io.log("");

  const result = await runDetection(emailAddress, template, fetchFn);

  // Show email provider discovery
  if (result.discoveredIntegrations) {
    const d = result.discoveredIntegrations;
    io.log(`  Email provider detected: ${d.provider}`);
    if (d.calendar) io.log(`    → Calendar available: ${d.calendar}`);
    if (d.tasks) io.log(`    → Tasks available: ${d.tasks}`);
  }

  // Show Ollama discovery
  if (result.ollamaAvailable) {
    if (result.ollamaModels.length > 0) {
      io.log(`  Ollama: ${result.ollamaModels.length} model(s) available`);
      for (const m of result.ollamaModels) {
        io.log(`    → ${m.name} (${m.parameterSize}, reasoning: ${m.capabilities.reasoning}, coding: ${m.capabilities.coding})`);
      }
    } else {
      io.log("  Ollama: running but no models installed");
    }
  } else {
    io.log("  Ollama: not detected (install Ollama for local model support)");
  }

  // Show routing suggestions
  if (result.routingSuggestions.length > 0) {
    io.log("");
    io.log("  Routing suggestions:");
    for (const s of result.routingSuggestions) {
      const icon = s.cloudNeeded ? "☁" : "⚡";
      const model = s.suggestedModel ? ` → ${s.suggestedModel}` : "";
      io.log(`    ${icon} ${s.category}${model}: ${s.reason}`);
    }
  }

  io.log("");

  return result;
}

// --- Step 3b: Integration setup (with pre-fill from detection) ---

export async function stepIntegrations(
  io: WizardIO,
  template: TemplateChoice,
  validateCredential?: (envVar: string, value: string) => Promise<boolean>,
  detection?: DetectionResult,
): Promise<IntegrationSetup[]> {
  io.log("");
  io.log("Step 4/6: Integration Setup");
  io.log("───────────────────────────");
  io.log("");

  // If detection discovered related services, show them pre-filled
  if (detection?.discoveredIntegrations) {
    const d = detection.discoveredIntegrations;
    if (d.calendar && !template.integrationsRequired.includes("calendar") && !template.integrationsRecommended.includes("calendar")) {
      io.log(`  Auto-detected: ${d.calendar} from your email provider`);
      io.log(`  Adding calendar to recommended integrations.`);
      io.log("");
      // Temporarily add calendar to recommended if detected
      template = { ...template, integrationsRecommended: [...template.integrationsRecommended, "calendar"] };
    }
    if (d.tasks && !template.integrationsRequired.includes("tasks") && !template.integrationsRecommended.includes("tasks")) {
      io.log(`  Auto-detected: ${d.tasks} from your email provider`);
      io.log(`  Adding tasks to recommended integrations.`);
      io.log("");
      template = { ...template, integrationsRecommended: [...template.integrationsRecommended, "tasks"] };
    }
  }

  const integrations: IntegrationSetup[] = [];
  const allNeeded = [...template.integrationsRequired, ...template.integrationsRecommended];
  const seen = new Set<string>();

  for (const category of allNeeded) {
    if (seen.has(category)) continue;
    seen.add(category);

    const def = INTEGRATION_DEFS.find((d) => d.category === category);
    if (!def) continue;

    const isRequired = template.integrationsRequired.includes(category);
    const label = isRequired ? `${def.label} [required]` : `${def.label} [recommended]`;

    const shouldSetup = isRequired || await io.confirm(`Set up ${label}?`, true);
    if (!shouldSetup) continue;

    io.log("");
    const credential = await io.prompt(`  ${def.promptLabel}`, "");

    if (!credential) {
      if (isRequired) {
        io.log(`  Warning: ${def.label} is required but no credential provided.`);
      }
      integrations.push({
        provider: def.label,
        category: def.category,
        envVar: def.envVar,
        credential: "",
        validated: false,
      });
      continue;
    }

    let validated = false;
    if (validateCredential) {
      io.log("  Validating credential...");
      validated = await validateCredential(def.envVar, credential);
      if (validated) {
        io.log("  Credential valid.");
      } else {
        io.log("  Warning: Credential validation failed. Proceeding anyway.");
      }
    }

    integrations.push({
      provider: def.label,
      category: def.category,
      envVar: def.envVar,
      credential,
      validated,
    });
  }

  return integrations;
}

// --- Step 5: Model routing ---

export async function stepModelRouting(
  io: WizardIO,
  detection?: DetectionResult,
): Promise<ModelRoutingSetup> {
  io.log("");
  io.log("Step 5/6: Model Routing");
  io.log("───────────────────────");
  io.log("");
  io.log("By default, your agent uses local models (Ollama) for all tasks.");
  io.log("You can optionally enable cloud API providers for specific task categories.");
  io.log("");

  // Show detection-based recommendation
  if (detection) {
    const cloudNeededCount = detection.routingSuggestions.filter((s) => s.cloudNeeded).length;
    if (detection.ollamaModels.length > 0 && cloudNeededCount === 0) {
      io.log("  Based on auto-detection: your local models can handle all task categories.");
      io.log("");
    } else if (detection.ollamaModels.length > 0 && cloudNeededCount > 0) {
      const cats = detection.routingSuggestions.filter((s) => s.cloudNeeded).map((s) => s.category);
      io.log(`  Based on auto-detection: cloud recommended for: ${cats.join(", ")}`);
      io.log("");
    } else if (!detection.ollamaAvailable) {
      io.log("  Ollama not detected — cloud providers recommended for all tasks.");
      io.log("");
    }
  }

  const localOnly = await io.confirm("Run local-only (no cloud APIs)?", true);

  if (localOnly) {
    return {
      localOnly: true,
      cloudProviders: [],
      categories: MODEL_CATEGORIES.map((c) => ({
        category: c.category,
        cloudAllowed: false,
      })),
    };
  }

  io.log("");
  io.log("Configure cloud API providers:");

  const cloudProviders: CloudProviderSetup[] = [];
  for (const def of CLOUD_PROVIDER_DEFS) {
    const enable = await io.confirm(`  Enable ${def.label}?`, false);
    if (!enable) continue;

    const credential = await io.prompt(`  ${def.promptLabel}`, "");
    cloudProviders.push({
      provider: def.provider,
      envVar: def.envVar,
      credential,
      validated: false,
    });
  }

  if (cloudProviders.length === 0) {
    io.log("  No cloud providers configured — running local-only.");
    return {
      localOnly: true,
      cloudProviders: [],
      categories: MODEL_CATEGORIES.map((c) => ({
        category: c.category,
        cloudAllowed: false,
      })),
    };
  }

  io.log("");
  io.log("Per-category cloud opt-in (which tasks may use cloud models?):");
  io.log("");

  const categories: ModelCategoryPolicy[] = [];
  for (const cat of MODEL_CATEGORIES) {
    // Default to cloud-allowed if routing suggestions indicate cloud is needed
    const suggestion = detection?.routingSuggestions.find((s) => s.category === cat.category);
    const defaultAllow = suggestion?.cloudNeeded ?? false;
    const hint = suggestion ? ` (suggested: ${defaultAllow ? "yes" : "no"})` : "";
    const allowed = await io.confirm(`  Allow cloud for ${cat.label}?${hint}`, defaultAllow);
    categories.push({
      category: cat.category,
      cloudAllowed: allowed,
    });
  }

  return {
    localOnly: false,
    cloudProviders,
    categories,
  };
}

export { INTEGRATION_DEFS, CLOUD_PROVIDER_DEFS, MODEL_CATEGORIES, type IntegrationDef };
