/**
 * Integration lifecycle operations: add, remove, swap, list.
 *
 * Each operation manages .env credentials, workspace tools,
 * TOOLS.md identity file, egress firewall allowlist, cron
 * dependencies, and identity file references.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  getEnvValue,
  readEnvFile,
  removeEnvValue,
  setEnvValue,
  writeEnvFile,
} from "../security/secrets/env.js";
import { TOOL_BINARY_DEPS } from "../workspace/tools/registry.js";

import { findCategory, findProvider, getIntegrationEgressDomains } from "./providers.js";
import type {
  AddResult,
  ConfiguredIntegration,
  CronDependencyResult,
  IntegrationListEntry,
  IntegrationRegistry,
  RemoveResult,
  SwapResult,
} from "./types.js";
import { IntegrateError } from "./types.js";

/** Tools that belong to each integration category. */
const CATEGORY_TOOLS: Record<string, string[]> = {
  email: ["email"],
  calendar: ["ical"],
  tasks: ["todoist", "todoist-sync"],
  research: ["tavily"],
};

export interface IntegrateContext {
  openclawHome: string;
  clawhqDir: string;
}

// --- Registry persistence ---

function registryPath(ctx: IntegrateContext): string {
  return join(ctx.clawhqDir, "integrations.json");
}

export async function loadRegistry(ctx: IntegrateContext): Promise<IntegrationRegistry> {
  try {
    const content = await readFile(registryPath(ctx), "utf-8");
    return JSON.parse(content) as IntegrationRegistry;
  } catch {
    return { integrations: [] };
  }
}

export async function saveRegistry(
  ctx: IntegrateContext,
  registry: IntegrationRegistry,
): Promise<void> {
  await mkdir(ctx.clawhqDir, { recursive: true });
  await writeFile(registryPath(ctx), JSON.stringify(registry, null, 2), "utf-8");
}

// --- Add ---

export async function addIntegration(
  ctx: IntegrateContext,
  category: string,
  provider: string,
  credential: string,
  validated: boolean,
): Promise<AddResult> {
  const catDef = findCategory(category);
  if (!catDef) {
    throw new IntegrateError(`Unknown integration category: ${category}`);
  }

  const provDef = findProvider(category, provider);
  if (!provDef) {
    const available = catDef.providers.map((p) => p.provider).join(", ");
    throw new IntegrateError(
      `Unknown provider "${provider}" for category "${category}". Available: ${available}`,
    );
  }

  // Check for duplicate
  const registry = await loadRegistry(ctx);
  const existing = registry.integrations.find((i) => i.category === category);
  if (existing) {
    throw new IntegrateError(
      `Integration already configured for category "${category}" (provider: ${existing.provider}). ` +
      `Use \`clawhq integrate swap ${category} ${provider}\` to change providers, ` +
      `or \`clawhq integrate remove ${category}\` first.`,
    );
  }

  // Write credential to .env
  const envPath = join(ctx.openclawHome, ".env");
  let env;
  try {
    env = await readEnvFile(envPath);
  } catch {
    env = { entries: [] };
  }
  setEnvValue(env, provDef.envVar, credential);
  await mkdir(ctx.openclawHome, { recursive: true });
  await writeEnvFile(envPath, env);

  // Register integration
  const integration: ConfiguredIntegration = {
    category,
    provider,
    envVar: provDef.envVar,
    addedAt: new Date().toISOString(),
    lastCheckedAt: validated ? new Date().toISOString() : null,
  };
  registry.integrations.push(integration);
  await saveRegistry(ctx, registry);

  // Determine tools installed and binary deps
  const toolsInstalled = CATEGORY_TOOLS[category] ?? [];
  let requiresRebuild = false;
  for (const tool of toolsInstalled) {
    const deps = TOOL_BINARY_DEPS[tool];
    if (deps && deps.length > 0) {
      requiresRebuild = true;
      break;
    }
  }

  // Update TOOLS.md
  await updateToolsMd(ctx, registry);

  return {
    integration,
    toolsInstalled,
    egressDomainsAdded: provDef.egressDomains,
    requiresRebuild,
  };
}

// --- Remove ---

export async function removeIntegration(
  ctx: IntegrateContext,
  category: string,
): Promise<RemoveResult> {
  const registry = await loadRegistry(ctx);
  const idx = registry.integrations.findIndex((i) => i.category === category);
  if (idx === -1) {
    throw new IntegrateError(`No integration configured for category "${category}".`);
  }

  const existing = registry.integrations[idx];
  const provDef = findProvider(existing.category, existing.provider);

  // Clean credential from .env
  const envPath = join(ctx.openclawHome, ".env");
  const envVarsCleaned: string[] = [];
  try {
    const env = await readEnvFile(envPath);
    if (removeEnvValue(env, existing.envVar)) {
      envVarsCleaned.push(existing.envVar);
      await writeEnvFile(envPath, env);
    }
  } catch {
    // .env doesn't exist — nothing to clean
  }

  // Remove from registry
  registry.integrations.splice(idx, 1);
  await saveRegistry(ctx, registry);

  // Update TOOLS.md
  await updateToolsMd(ctx, registry);

  const toolsRemoved = CATEGORY_TOOLS[category] ?? [];
  const egressDomainsRemoved = provDef?.egressDomains ?? [];

  return {
    category,
    provider: existing.provider,
    toolsRemoved,
    egressDomainsRemoved,
    envVarsCleaned,
  };
}

// --- Swap ---

export async function swapIntegration(
  ctx: IntegrateContext,
  category: string,
  newProvider: string,
  credential: string,
  validated: boolean,
): Promise<SwapResult> {
  const catDef = findCategory(category);
  if (!catDef) {
    throw new IntegrateError(`Unknown integration category: ${category}`);
  }

  const newProvDef = findProvider(category, newProvider);
  if (!newProvDef) {
    const available = catDef.providers.map((p) => p.provider).join(", ");
    throw new IntegrateError(
      `Unknown provider "${newProvider}" for category "${category}". Available: ${available}`,
    );
  }

  const registry = await loadRegistry(ctx);
  const idx = registry.integrations.findIndex((i) => i.category === category);
  if (idx === -1) {
    throw new IntegrateError(
      `No integration configured for category "${category}". Use \`clawhq integrate add ${category}\` first.`,
    );
  }

  const old = registry.integrations[idx];
  const oldProvDef = findProvider(category, old.provider);

  if (old.provider === newProvider) {
    throw new IntegrateError(
      `Integration "${category}" already uses provider "${newProvider}".`,
    );
  }

  // Update .env: remove old credential, add new
  const envPath = join(ctx.openclawHome, ".env");
  let env;
  try {
    env = await readEnvFile(envPath);
  } catch {
    env = { entries: [] };
  }

  const envVarsCleaned: string[] = [];
  const envVarsAdded: string[] = [];

  if (old.envVar !== newProvDef.envVar) {
    if (removeEnvValue(env, old.envVar)) {
      envVarsCleaned.push(old.envVar);
    }
  }
  setEnvValue(env, newProvDef.envVar, credential);
  envVarsAdded.push(newProvDef.envVar);
  await writeEnvFile(envPath, env);

  // Update registry
  registry.integrations[idx] = {
    category,
    provider: newProvider,
    envVar: newProvDef.envVar,
    addedAt: new Date().toISOString(),
    lastCheckedAt: validated ? new Date().toISOString() : null,
  };
  await saveRegistry(ctx, registry);

  // Update TOOLS.md (same category tools, just provider changed)
  await updateToolsMd(ctx, registry);

  return {
    category,
    oldProvider: old.provider,
    newProvider,
    envVarsCleaned,
    envVarsAdded,
    egressDomainsRemoved: oldProvDef?.egressDomains ?? [],
    egressDomainsAdded: newProvDef.egressDomains,
  };
}

// --- List ---

export async function listIntegrations(
  ctx: IntegrateContext,
): Promise<IntegrationListEntry[]> {
  const registry = await loadRegistry(ctx);
  const entries: IntegrationListEntry[] = [];

  // Check .env for credential presence
  const envPath = join(ctx.openclawHome, ".env");
  let env;
  try {
    env = await readEnvFile(envPath);
  } catch {
    env = { entries: [] };
  }

  for (const int of registry.integrations) {
    const hasCredential = !!getEnvValue(env, int.envVar);

    entries.push({
      category: int.category,
      provider: int.provider,
      status: hasCredential ? "configured" : "missing-credential",
      credentialHealth: hasCredential ? "unchecked" : "missing",
      addedAt: int.addedAt,
      lastUsed: null,
    });
  }

  return entries;
}

// --- Formatting ---

export function formatIntegrationList(entries: IntegrationListEntry[]): string {
  if (entries.length === 0) {
    return "No integrations configured. Use `clawhq integrate add <category>` to add one.";
  }

  const lines: string[] = [];
  const catWidth = Math.max(8, ...entries.map((e) => e.category.length));
  const provWidth = Math.max(8, ...entries.map((e) => e.provider.length));
  const statusWidth = 18;

  lines.push(
    `${"CATEGORY".padEnd(catWidth)}  ${"PROVIDER".padEnd(provWidth)}  ${"STATUS".padEnd(statusWidth)}  CREDENTIAL  ADDED`,
  );
  lines.push("-".repeat(catWidth + provWidth + statusWidth + 30));

  for (const e of entries) {
    const credLabel = e.credentialHealth === "valid" ? "VALID"
      : e.credentialHealth === "failing" ? "FAIL"
      : e.credentialHealth === "missing" ? "MISSING"
      : "—";
    const addedDate = e.addedAt.slice(0, 10);
    lines.push(
      `${e.category.padEnd(catWidth)}  ${e.provider.padEnd(provWidth)}  ${e.status.padEnd(statusWidth)}  ${credLabel.padEnd(10)}  ${addedDate}`,
    );
  }

  return lines.join("\n");
}

// --- TOOLS.md update ---

async function updateToolsMd(
  ctx: IntegrateContext,
  registry: IntegrationRegistry,
): Promise<void> {
  const toolsMdPath = join(ctx.openclawHome, "workspace", "TOOLS.md");

  let content: string;
  try {
    content = await readFile(toolsMdPath, "utf-8");
  } catch {
    // No TOOLS.md yet — nothing to update
    return;
  }

  // Build marker-bounded section for integrations
  const marker = "<!-- clawhq:integrations -->";
  const endMarker = "<!-- /clawhq:integrations -->";

  const integrationLines: string[] = [marker, "", "## Integrations", ""];
  for (const int of registry.integrations) {
    const tools = CATEGORY_TOOLS[int.category] ?? [];
    const toolList = tools.length > 0 ? ` (tools: ${tools.join(", ")})` : "";
    integrationLines.push(`- **${int.category}** — ${int.provider}${toolList}`);
  }
  if (registry.integrations.length === 0) {
    integrationLines.push("_No integrations configured._");
  }
  integrationLines.push("", endMarker);

  // Replace existing section or append
  const startIdx = content.indexOf(marker);
  const endIdx = content.indexOf(endMarker);

  if (startIdx !== -1 && endIdx !== -1) {
    content =
      content.slice(0, startIdx) +
      integrationLines.join("\n") +
      content.slice(endIdx + endMarker.length);
  } else {
    content = content.trimEnd() + "\n\n" + integrationLines.join("\n") + "\n";
  }

  await writeFile(toolsMdPath, content, "utf-8");
}

/**
 * Get all egress domains for currently configured integrations.
 */
export async function getConfiguredEgressDomains(
  ctx: IntegrateContext,
): Promise<string[]> {
  const registry = await loadRegistry(ctx);
  return getIntegrationEgressDomains(registry.integrations);
}

// --- Cron dependency analysis ---

/** Tools referenced by each integration category. */
const CATEGORY_TOOL_KEYWORDS: Record<string, string[]> = {
  email: ["email"],
  calendar: ["ical", "calendar", "caldav"],
  tasks: ["todoist", "todoist-sync"],
  research: ["tavily"],
  messaging: ["telegram", "whatsapp"],
  code: ["github", "gh"],
};

/**
 * Check cron jobs.json for dependencies on a category's tools.
 * Returns dependent jobs so the CLI can report them.
 */
export async function checkCronDependencies(
  ctx: IntegrateContext,
  category: string,
): Promise<CronDependencyResult> {
  const cronPath = join(ctx.openclawHome, "cron", "jobs.json");
  const keywords = CATEGORY_TOOL_KEYWORDS[category] ?? CATEGORY_TOOLS[category] ?? [];

  if (keywords.length === 0) {
    return { dependentJobs: [], hasActiveDependencies: false };
  }

  let jobs: Array<{ id: string; task: string; enabled?: boolean }>;
  try {
    const content = await readFile(cronPath, "utf-8");
    const parsed = JSON.parse(content);
    jobs = Array.isArray(parsed) ? parsed : (parsed.jobs ?? []);
  } catch {
    return { dependentJobs: [], hasActiveDependencies: false };
  }

  const dependentJobs: Array<{ id: string; task: string }> = [];
  let hasActiveDependencies = false;

  for (const job of jobs) {
    const taskLower = (job.task ?? "").toLowerCase();
    const matches = keywords.some((kw) => taskLower.includes(kw));
    if (matches) {
      dependentJobs.push({ id: job.id, task: job.task });
      if (job.enabled !== false) {
        hasActiveDependencies = true;
      }
    }
  }

  return { dependentJobs, hasActiveDependencies };
}

// --- Identity file cleanup on remove ---

/**
 * Remove references to an integration category from identity files
 * (AGENTS.md, HEARTBEAT.md) using marker-bounded sections.
 *
 * Returns list of files that were updated.
 */
export async function cleanIdentityReferences(
  ctx: IntegrateContext,
  category: string,
): Promise<string[]> {
  const wsDir = join(ctx.openclawHome, "workspace");
  const updatedFiles: string[] = [];

  // Files to check for integration-specific content
  const identityFiles = ["AGENTS.md", "HEARTBEAT.md"];
  const keywords = CATEGORY_TOOL_KEYWORDS[category] ?? CATEGORY_TOOLS[category] ?? [];

  if (keywords.length === 0) return updatedFiles;

  for (const filename of identityFiles) {
    const filePath = join(wsDir, filename);

    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    // Check for marker-bounded sections for this category
    const marker = `<!-- clawhq:${category} -->`;
    const endMarker = `<!-- /clawhq:${category} -->`;
    const startIdx = content.indexOf(marker);
    const endIdx = content.indexOf(endMarker);

    if (startIdx !== -1 && endIdx !== -1) {
      content =
        content.slice(0, startIdx) +
        content.slice(endIdx + endMarker.length);

      // Clean up double blank lines left by removal
      content = content.replace(/\n{3,}/g, "\n\n");
      await writeFile(filePath, content, "utf-8");
      updatedFiles.push(filename);
    }
  }

  return updatedFiles;
}

// --- Egress firewall update ---

/**
 * Update the egress firewall allowlist to match current integrations.
 * Builds config from all configured integration domains and applies.
 *
 * Returns the firewall result, or null if firewall is not applicable
 * (e.g., non-Linux platform).
 */
export async function updateFirewallAllowlist(
  ctx: IntegrateContext,
  options?: { enabledProviders?: string[]; bridgeInterface?: string },
): Promise<{ success: boolean; message: string } | null> {
  // Dynamic import to avoid hard dependency on firewall module
  // (firewall requires iptables which is Linux-only)
  try {
    const { buildConfig, apply, checkPlatform } = await import(
      "../security/firewall/index.js"
    );

    const platform = checkPlatform();
    if (!platform.supported) {
      return null;
    }

    const integrationDomains = await getConfiguredEgressDomains(ctx);
    const config = await buildConfig({
      enabledProviders: options?.enabledProviders,
      extraDomains: integrationDomains,
      bridgeInterface: options?.bridgeInterface,
    });

    return await apply(config);
  } catch {
    // Firewall module not available or failed
    return null;
  }
}
