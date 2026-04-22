/**
 * Catalog loader — reads mission profiles and the canonical personality from YAML.
 *
 * Profiles: configs/profiles/*.yaml
 * Canonical personality: configs/personalities/canonical.yaml (fixed filename)
 *
 * There is no personality picker — every agent uses the one canonical
 * personality ClawHQ ships with. Users customize tone via `soul_overrides`.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parse as yamlParse } from "yaml";

import type { CanonicalPersonality, MissionProfile } from "./types.js";

// ── Config Directory ────────────────────────────────────────────────────────

function findConfigsDir(): string {
  // Walk up from dist/design/catalog/ to find configs/
  const dir = resolve(import.meta.dirname ?? __dirname, "..", "..", "..");
  const candidate = join(dir, "configs");
  if (existsSync(candidate)) return candidate;
  return join(process.cwd(), "configs");
}

// ── Profiles ────────────────────────────────────────────────────────────────

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

export function loadAllProfiles(): MissionProfile[] {
  return loadYamlDir<MissionProfile>("profiles");
}

export function loadProfile(id: string): MissionProfile {
  const profiles = loadAllProfiles();
  const found = profiles.find((p) => p.id === id);
  if (!found) {
    const available = profiles.map((p) => p.id).join(", ");
    throw new Error(`Profile "${id}" not found. Available: ${available || "none"}`);
  }
  return found;
}

// ── Canonical Personality ───────────────────────────────────────────────────

const CANONICAL_PERSONALITY_FILE = "canonical.yaml";

/**
 * Load the canonical ClawHQ personality.
 *
 * There is only one — the file lives at `configs/personalities/canonical.yaml`.
 */
export function loadCanonicalPersonality(): CanonicalPersonality {
  const path = join(findConfigsDir(), "personalities", CANONICAL_PERSONALITY_FILE);
  if (!existsSync(path)) {
    throw new Error(`Canonical personality file missing: ${path}`);
  }
  const content = readFileSync(path, "utf-8");
  const parsed = yamlParse(content) as CanonicalPersonality | null;
  if (!parsed || typeof parsed !== "object" || !("id" in parsed)) {
    throw new Error(`Invalid canonical personality file: ${path}`);
  }
  return parsed;
}
