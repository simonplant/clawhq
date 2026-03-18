/**
 * Auto-detection for `clawhq init` — discovers available integrations
 * and Ollama models before the user enters credentials.
 *
 * Three detection axes:
 *   1. Email provider → related calendar/task service discovery
 *   2. Ollama model discovery via HTTP API
 *   3. Routing suggestions based on available models + template requirements
 */

import type {
  DetectionResult,
  DiscoveredModel,
  ModelCapabilities,
  ProviderDiscovery,
  RoutingSuggestion,
  TemplateChoice,
} from "./types.js";

// ---------------------------------------------------------------------------
// 1. Email provider → related service discovery
// ---------------------------------------------------------------------------

/**
 * Maps email provider domains to related calendar/task services.
 * When a user provides an email address, we can suggest related integrations
 * from the same provider ecosystem.
 */
const PROVIDER_MAP: Record<string, ProviderDiscovery> = {
  "icloud.com": { provider: "icloud", calendar: "iCloud Calendar (CalDAV)", tasks: "Apple Reminders" },
  "me.com": { provider: "icloud", calendar: "iCloud Calendar (CalDAV)", tasks: "Apple Reminders" },
  "mac.com": { provider: "icloud", calendar: "iCloud Calendar (CalDAV)", tasks: "Apple Reminders" },
  "gmail.com": { provider: "google", calendar: "Google Calendar", tasks: "Google Tasks" },
  "googlemail.com": { provider: "google", calendar: "Google Calendar", tasks: "Google Tasks" },
  "outlook.com": { provider: "microsoft", calendar: "Outlook Calendar", tasks: "Microsoft To Do" },
  "hotmail.com": { provider: "microsoft", calendar: "Outlook Calendar", tasks: "Microsoft To Do" },
  "live.com": { provider: "microsoft", calendar: "Outlook Calendar", tasks: "Microsoft To Do" },
  "yahoo.com": { provider: "yahoo", calendar: "Yahoo Calendar" },
  "fastmail.com": { provider: "fastmail", calendar: "FastMail Calendar (CalDAV)" },
  "protonmail.com": { provider: "proton", calendar: "Proton Calendar" },
  "proton.me": { provider: "proton", calendar: "Proton Calendar" },
};

/**
 * Detect related services from an email address.
 * Returns null if the email domain isn't recognized or no email is provided.
 */
export function discoverFromEmail(email: string): ProviderDiscovery | null {
  if (!email || !email.includes("@")) return null;

  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;

  return PROVIDER_MAP[domain] ?? null;
}

// ---------------------------------------------------------------------------
// 2. Ollama model discovery
// ---------------------------------------------------------------------------

const OLLAMA_BASE_URL = "http://localhost:11434";

/** Raw model entry from the Ollama /api/tags response. */
interface OllamaTagEntry {
  name: string;
  size: number;
  details?: {
    parameter_size?: string;
    family?: string;
  };
}

/** Fetcher type for dependency injection in tests. */
export type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/**
 * Discover models available on the local Ollama instance.
 * Returns an empty array if Ollama is unreachable.
 */
export async function discoverOllamaModels(
  fetchFn: FetchFn = globalThis.fetch,
): Promise<DiscoveredModel[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetchFn(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return [];

    const data = (await res.json()) as { models?: OllamaTagEntry[] };
    if (!data.models || !Array.isArray(data.models)) return [];

    return data.models.map((m) => ({
      name: m.name,
      sizeBytes: m.size ?? 0,
      parameterSize: m.details?.parameter_size ?? inferParameterSize(m.name, m.size),
      capabilities: assessCapabilities(m.name, m.details?.parameter_size ?? "", m.size),
    }));
  } catch {
    // Ollama not running or unreachable
    return [];
  }
}

/**
 * Check if Ollama is reachable at all.
 */
export async function isOllamaAvailable(
  fetchFn: FetchFn = globalThis.fetch,
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetchFn(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/** Infer rough parameter size from model name or file size. */
function inferParameterSize(name: string, sizeBytes: number): string {
  // Try to extract from model name (e.g., "llama3:8b", "mistral:7b-instruct")
  const match = name.match(/(\d+)b/i);
  if (match) return `${match[1]}B`;

  // Rough heuristic: ~0.5GB per billion params at Q4 quantization
  const gbSize = sizeBytes / (1024 * 1024 * 1024);
  if (gbSize < 2) return "1B";
  if (gbSize < 5) return "7B";
  if (gbSize < 15) return "13B";
  if (gbSize < 40) return "34B";
  return "70B";
}

/** Assess model capabilities based on name and parameter count. */
function assessCapabilities(name: string, paramSize: string, sizeBytes: number): ModelCapabilities {
  const params = parseParamCount(paramSize, sizeBytes);
  const nameLower = name.toLowerCase();

  // Coding capability: code-specialized models or large general models
  const isCodeModel = nameLower.includes("code") || nameLower.includes("coder") || nameLower.includes("starcoder") || nameLower.includes("deepseek-coder");
  const coding: ModelCapabilities["coding"] = isCodeModel ? (params >= 13 ? "high" : "medium")
    : params >= 34 ? "medium" : "low";

  // Reasoning: primarily determined by parameter count
  const reasoning: ModelCapabilities["reasoning"] = params >= 34 ? "high"
    : params >= 7 ? "medium" : "low";

  // Long context: larger models and newer architectures
  const longContext = params >= 7;

  return { reasoning, coding, longContext };
}

/** Parse parameter count from string like "7B", "13B", "70B" to number. */
function parseParamCount(paramSize: string, sizeBytes: number): number {
  const match = paramSize.match(/(\d+)/);
  if (match) return parseInt(match[1], 10);

  // Fallback from file size
  const gbSize = sizeBytes / (1024 * 1024 * 1024);
  if (gbSize < 2) return 1;
  if (gbSize < 5) return 7;
  if (gbSize < 15) return 13;
  if (gbSize < 40) return 34;
  return 70;
}

// ---------------------------------------------------------------------------
// 3. Routing suggestions
// ---------------------------------------------------------------------------

/** Task categories that templates can specify for cloud escalation. */
const TASK_CATEGORIES = ["email", "calendar", "research", "writing", "coding"] as const;

/**
 * Generate routing suggestions based on available Ollama models and
 * the selected template's requirements.
 */
export function suggestRouting(
  models: DiscoveredModel[],
  template: TemplateChoice,
): RoutingSuggestion[] {
  if (models.length === 0) {
    // No local models — all categories need cloud
    return TASK_CATEGORIES.map((cat) => ({
      category: cat,
      suggestedModel: "",
      reason: "No local models available — cloud provider recommended",
      cloudNeeded: true,
    }));
  }

  // Sort models by parameter count descending (prefer larger models)
  const sorted = [...models].sort((a, b) => {
    const aParams = parseParamCount(a.parameterSize, a.sizeBytes);
    const bParams = parseParamCount(b.parameterSize, b.sizeBytes);
    return bParams - aParams;
  });

  // Use the template's routing strategy to determine quality threshold
  const qualityThreshold = getQualityThreshold(template);

  return TASK_CATEGORIES.map((cat) => {
    const suggestion = selectModelForCategory(cat, sorted, qualityThreshold);
    return suggestion;
  });
}

/** Map template quality threshold to minimum parameter count. */
function getQualityThreshold(_template: TemplateChoice): number {
  // Default: medium quality = 7B minimum
  return 7;
}

/** Select the best local model for a task category, or recommend cloud. */
function selectModelForCategory(
  category: string,
  models: DiscoveredModel[],
  minParams: number,
): RoutingSuggestion {
  if (models.length === 0) {
    return {
      category,
      suggestedModel: "",
      reason: "No local models available",
      cloudNeeded: true,
    };
  }

  // For coding tasks, prefer code-specialized models
  if (category === "coding") {
    const codeModel = models.find((m) => m.capabilities.coding !== "low");
    if (codeModel) {
      return {
        category,
        suggestedModel: codeModel.name,
        reason: `${codeModel.parameterSize} model with ${codeModel.capabilities.coding} coding capability`,
        cloudNeeded: false,
      };
    }
    // No code model — check if largest model is big enough
    const largest = models[0];
    const params = parseParamCount(largest.parameterSize, largest.sizeBytes);
    if (params >= 13) {
      return {
        category,
        suggestedModel: largest.name,
        reason: `${largest.parameterSize} general model — adequate for basic coding`,
        cloudNeeded: false,
      };
    }
    return {
      category,
      suggestedModel: largest.name,
      reason: `${largest.parameterSize} model may struggle with complex coding — cloud recommended`,
      cloudNeeded: true,
    };
  }

  // For research/writing, prefer larger models for quality
  if (category === "research" || category === "writing") {
    const suitable = models.find((m) => {
      const params = parseParamCount(m.parameterSize, m.sizeBytes);
      return params >= minParams && m.capabilities.reasoning !== "low";
    });
    if (suitable) {
      return {
        category,
        suggestedModel: suitable.name,
        reason: `${suitable.parameterSize} model with ${suitable.capabilities.reasoning} reasoning`,
        cloudNeeded: false,
      };
    }
    return {
      category,
      suggestedModel: models[0].name,
      reason: `Available models below quality threshold — cloud recommended for best results`,
      cloudNeeded: true,
    };
  }

  // For email/calendar, smaller models work fine (structured tasks)
  const smallest = models[models.length - 1];
  const smallParams = parseParamCount(smallest.parameterSize, smallest.sizeBytes);
  if (smallParams >= 3) {
    return {
      category,
      suggestedModel: smallest.name,
      reason: `${smallest.parameterSize} model sufficient for ${category} tasks`,
      cloudNeeded: false,
    };
  }

  return {
    category,
    suggestedModel: models[0].name,
    reason: `Best available local model for ${category}`,
    cloudNeeded: false,
  };
}

// ---------------------------------------------------------------------------
// 4. Full detection orchestrator
// ---------------------------------------------------------------------------

/**
 * Run all auto-detection: email provider discovery, Ollama models, routing.
 * Called between template selection and integration setup in the wizard.
 */
export async function runDetection(
  emailAddress: string | undefined,
  template: TemplateChoice,
  fetchFn?: FetchFn,
): Promise<DetectionResult> {
  // Discover email-related services
  const discoveredIntegrations = emailAddress
    ? discoverFromEmail(emailAddress)
    : null;

  // Discover Ollama models
  const ollamaModels = await discoverOllamaModels(fetchFn);
  const ollamaAvailable = ollamaModels.length > 0 || await isOllamaAvailable(fetchFn);

  // Generate routing suggestions
  const routingSuggestions = suggestRouting(ollamaModels, template);

  return {
    discoveredIntegrations,
    ollamaModels,
    routingSuggestions,
    ollamaAvailable,
  };
}

export { PROVIDER_MAP };
