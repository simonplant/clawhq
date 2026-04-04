/**
 * Catalog loader — reads mission profiles and personality presets from YAML.
 *
 * Profiles: configs/profiles/*.yaml
 * Personalities: configs/personalities/*.yaml
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as yamlParse } from "yaml";

import type { MissionProfile, PersonalityPreset } from "./types.js";

// ── Config Directory ────────────────────────────────────────────────────────

function findConfigsDir(): string {
  // Walk up from dist/design/catalog/ to find configs/
  let dir = resolve(import.meta.dirname ?? __dirname, "..", "..", "..");
  const candidate = join(dir, "configs");
  if (existsSync(candidate)) return candidate;
  return join(process.cwd(), "configs");
}

// ── Generic Loader ──────────────────────────────────────────────────────────

function loadYamlDir<T>(subdir: string): T[] {
  const dir = join(findConfigsDir(), subdir);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => {
      try {
        const content = readFileSync(join(dir, f), "utf-8");
        return yamlParse(content) as T;
      } catch {
        return null;
      }
    })
    .filter((item): item is T => item !== null && typeof item === "object" && "id" in (item as Record<string, unknown>));
}

function loadById<T extends { id: string }>(items: T[], id: string, kind: string): T {
  const found = items.find((item) => item.id === id);
  if (!found) {
    const available = items.map((item) => item.id).join(", ");
    throw new Error(`${kind} "${id}" not found. Available: ${available || "none"}`);
  }
  return found;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function loadAllProfiles(): MissionProfile[] {
  return loadYamlDir<MissionProfile>("profiles");
}

export function loadProfile(id: string): MissionProfile {
  return loadById(loadAllProfiles(), id, "Profile");
}

export function loadAllPersonalities(): PersonalityPreset[] {
  return loadYamlDir<PersonalityPreset>("personalities");
}

export function loadPersonality(id: string): PersonalityPreset {
  return loadById(loadAllPersonalities(), id, "Personality");
}
