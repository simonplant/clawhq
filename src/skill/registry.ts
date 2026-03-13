/**
 * Skill registry — persistent JSON storage for installed skill metadata.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { InstalledSkill, SkillContext, SkillRegistry } from "./types.js";

const REGISTRY_FILE = "skills/registry.json";

function registryPath(ctx: SkillContext): string {
  return join(ctx.clawhqDir, REGISTRY_FILE);
}

export async function loadRegistry(ctx: SkillContext): Promise<SkillRegistry> {
  const path = registryPath(ctx);
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as SkillRegistry;
  } catch {
    return { skills: [] };
  }
}

export async function saveRegistry(
  ctx: SkillContext,
  registry: SkillRegistry,
): Promise<void> {
  const path = registryPath(ctx);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(registry, null, 2) + "\n", "utf-8");
}

export function findSkill(
  registry: SkillRegistry,
  name: string,
): InstalledSkill | undefined {
  return registry.skills.find((s) => s.name === name);
}

export function addSkill(
  registry: SkillRegistry,
  skill: InstalledSkill,
): SkillRegistry {
  return {
    skills: [...registry.skills, skill],
  };
}

export function removeSkill(
  registry: SkillRegistry,
  name: string,
): SkillRegistry {
  return {
    skills: registry.skills.filter((s) => s.name !== name),
  };
}

export function updateSkill(
  registry: SkillRegistry,
  name: string,
  updates: Partial<InstalledSkill>,
): SkillRegistry {
  return {
    skills: registry.skills.map((s) =>
      s.name === name ? { ...s, ...updates } : s,
    ),
  };
}
