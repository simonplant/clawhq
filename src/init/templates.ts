/**
 * Built-in templates for the init wizard.
 *
 * Single source of truth: configs/templates/*.yaml
 * This module loads YAML templates via the loader and converts them
 * to TemplateChoice objects for the wizard.
 */

import {
  loadBuiltInTemplateChoices,
  templateToChoice,
} from "../templates/loader.js";

import type { TemplateChoice } from "./types.js";

// --- Cached template choices (loaded lazily from YAML) ---

let _cachedTemplates: TemplateChoice[] | null = null;

/**
 * Get all built-in templates as TemplateChoice objects.
 * Loads from YAML on first call, then caches.
 */
export async function getBuiltInTemplates(): Promise<TemplateChoice[]> {
  if (!_cachedTemplates) {
    _cachedTemplates = await loadBuiltInTemplateChoices();
  }
  return _cachedTemplates;
}

/**
 * Synchronous access to cached templates. Throws if templates have not
 * been loaded yet. Call getBuiltInTemplates() first to ensure loading.
 *
 * @deprecated Prefer getBuiltInTemplates() (async). This exists for
 * backward compatibility where sync access is needed after initial load.
 */
export function getBuiltInTemplatesCached(): TemplateChoice[] {
  if (!_cachedTemplates) {
    throw new Error(
      "Templates not loaded yet. Call getBuiltInTemplates() first.",
    );
  }
  return _cachedTemplates;
}

/**
 * Reset the template cache. Useful for testing.
 */
export function resetTemplateCache(): void {
  _cachedTemplates = null;
}

export async function getTemplateById(id: string): Promise<TemplateChoice | undefined> {
  const templates = await getBuiltInTemplates();
  return templates.find((t) => t.id === id);
}

export async function formatTemplateList(): Promise<string> {
  const templates = await getBuiltInTemplates();
  const lines: string[] = [];
  for (let i = 0; i < templates.length; i++) {
    const t = templates[i];
    lines.push(`  ${i + 1}. ${t.name}`);
    lines.push(`     ${t.useCase}`);
  }
  return lines.join("\n");
}

// Re-export for convenience
export { templateToChoice };
