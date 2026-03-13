/**
 * Skill lifecycle operations — install, remove, update.
 *
 * Each operation follows the pattern: fetch → sandbox → vet → approve → apply.
 * All modifications create rollback snapshots.
 */

import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  addSkill,
  findSkill,
  loadRegistry,
  removeSkill,
  saveRegistry,
  updateSkill,
} from "./registry.js";
import { createSnapshot, restoreSnapshot } from "./snapshot.js";
import { updateToolsMdSkills } from "./tools-md.js";
import type {
  InstalledSkill,
  SkillContext,
  SkillManifest,
  SkillSource,
  VetResult,
} from "./types.js";
import { SkillError } from "./types.js";
import { vetSkill } from "./vet.js";

export interface InstallResult {
  skill: InstalledSkill;
  vetResult: VetResult;
  requiresRebuild: boolean;
}

export interface RemoveResult {
  skill: InstalledSkill;
  snapshotId: string;
}

export interface UpdateResult {
  skill: InstalledSkill;
  previousVersion: string;
  vetResult: VetResult;
  snapshotId: string;
  requiresRebuild: boolean;
}

/**
 * Resolve a skill source from a name or URL argument.
 */
export function resolveSource(nameOrUrl: string): { source: SkillSource; uri: string } {
  if (nameOrUrl.startsWith("http://") || nameOrUrl.startsWith("https://")) {
    return { source: "url", uri: nameOrUrl };
  }
  if (nameOrUrl.startsWith("/") || nameOrUrl.startsWith("./") || nameOrUrl.startsWith("../")) {
    return { source: "local", uri: nameOrUrl };
  }
  return { source: "registry", uri: nameOrUrl };
}

/**
 * Fetch a skill to a staging directory for vetting.
 *
 * For local sources, copies the directory. For URL/registry sources,
 * this is where download logic would go (currently only local is supported).
 */
export async function fetchSkill(
  source: SkillSource,
  uri: string,
  stagingDir: string,
): Promise<SkillManifest> {
  await mkdir(stagingDir, { recursive: true });

  if (source === "local") {
    // Copy local skill directory to staging
    const srcStat = await stat(uri).catch(() => null);
    if (!srcStat?.isDirectory()) {
      throw new SkillError(`Skill source is not a directory: ${uri}`, "INVALID_SOURCE");
    }
    await cp(uri, stagingDir, { recursive: true });
  } else if (source === "url") {
    throw new SkillError(
      "URL-based skill installation is not yet implemented. Use a local path instead.",
      "NOT_IMPLEMENTED",
    );
  } else {
    throw new SkillError(
      "Registry-based skill installation is not yet implemented. Use a local path instead.",
      "NOT_IMPLEMENTED",
    );
  }

  return parseSkillManifest(stagingDir);
}

/**
 * Parse SKILL.md frontmatter to extract manifest info.
 */
async function parseSkillManifest(skillDir: string): Promise<SkillManifest> {
  const files = await listFilesRecursive(skillDir);
  const skillMdPath = files.find((f) => f.endsWith("SKILL.md"));

  if (!skillMdPath) {
    throw new SkillError(
      "Skill directory must contain a SKILL.md file",
      "MISSING_SKILL_MD",
    );
  }

  const { readFile } = await import("node:fs/promises");
  const content = await readFile(join(skillDir, skillMdPath), "utf-8");

  // Parse YAML frontmatter
  const frontmatterMatch = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!frontmatterMatch) {
    throw new SkillError(
      "SKILL.md must have YAML frontmatter with name and description",
      "INVALID_FRONTMATTER",
    );
  }

  const frontmatter = frontmatterMatch[1];
  const nameMatch = /^name:\s*(.+)$/m.exec(frontmatter);
  const descMatch = /^description:\s*["']?(.+?)["']?\s*$/m.exec(frontmatter);

  if (!nameMatch) {
    throw new SkillError("SKILL.md frontmatter must include 'name'", "MISSING_NAME");
  }

  // Check for container dependency indicators
  const requiresContainerDeps = files.some(
    (f) => f === "Dockerfile" || f === "apt-packages.txt" || f === "requirements.txt",
  );

  return {
    name: nameMatch[1].trim(),
    version: extractVersion(frontmatter) ?? "1.0.0",
    description: descMatch?.[1]?.trim() ?? "",
    files,
    requiresContainerDeps,
  };
}

function extractVersion(frontmatter: string): string | null {
  const match = /^version:\s*["']?(.+?)["']?\s*$/m.exec(frontmatter);
  return match?.[1]?.trim() ?? null;
}

async function listFilesRecursive(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(join(dir, entry.name), relPath));
    } else {
      files.push(relPath);
    }
  }

  return files;
}

/**
 * Install a skill: fetch → vet → stage (awaits user approval externally).
 *
 * Returns the vet result and staged skill info. The caller is responsible
 * for prompting user approval before calling activateSkill().
 */
export async function stageSkillInstall(
  ctx: SkillContext,
  nameOrUrl: string,
): Promise<{ manifest: SkillManifest; vetResult: VetResult; stagingDir: string }> {
  const { source, uri } = resolveSource(nameOrUrl);

  // Check for duplicates
  const registry = await loadRegistry(ctx);
  const resolvedName = source === "local" ? undefined : nameOrUrl;
  if (resolvedName && findSkill(registry, resolvedName)) {
    throw new SkillError(
      `Skill "${resolvedName}" is already installed. Use \`clawhq skill update\` instead.`,
      "ALREADY_INSTALLED",
    );
  }

  // Fetch to staging
  const stagingDir = join(ctx.clawhqDir, "skills", "staging", `install-${Date.now()}`);
  const manifest = await fetchSkill(source, uri, stagingDir);

  // Check duplicate by manifest name
  if (findSkill(registry, manifest.name)) {
    await rm(stagingDir, { recursive: true, force: true });
    throw new SkillError(
      `Skill "${manifest.name}" is already installed. Use \`clawhq skill update\` instead.`,
      "ALREADY_INSTALLED",
    );
  }

  // Vet in staging
  const vetResult = await vetSkill(stagingDir, manifest.files);

  return { manifest, vetResult, stagingDir };
}

/**
 * Activate a staged skill after user approval.
 */
export async function activateSkill(
  ctx: SkillContext,
  manifest: SkillManifest,
  stagingDir: string,
  source: SkillSource,
  sourceUri: string,
): Promise<InstallResult> {
  // Move from staging to workspace
  const skillDir = join(ctx.openclawHome, "workspace", "skills", manifest.name);
  await rm(skillDir, { recursive: true, force: true });
  await cp(stagingDir, skillDir, { recursive: true });
  await rm(stagingDir, { recursive: true, force: true });

  const now = new Date().toISOString();
  const skill: InstalledSkill = {
    name: manifest.name,
    version: manifest.version,
    source,
    sourceUri,
    status: "active",
    installedAt: now,
    lastUsed: null,
    requiresContainerDeps: manifest.requiresContainerDeps,
    rollbackSnapshotId: null,
  };

  // Update registry
  let registry = await loadRegistry(ctx);
  registry = addSkill(registry, skill);
  await saveRegistry(ctx, registry);

  // Update TOOLS.md
  await updateToolsMdSkills(ctx, registry.skills);

  // Re-vet for return value
  const vetResult = await vetSkill(skillDir, manifest.files);

  return {
    skill,
    vetResult,
    requiresRebuild: manifest.requiresContainerDeps,
  };
}

/**
 * Remove a skill — deactivate, snapshot for rollback, remove from workspace.
 */
export async function removeSkillOp(
  ctx: SkillContext,
  name: string,
): Promise<RemoveResult> {
  const registry = await loadRegistry(ctx);
  const skill = findSkill(registry, name);

  if (!skill) {
    throw new SkillError(`Skill "${name}" is not installed.`, "NOT_FOUND");
  }

  // Create rollback snapshot
  const skillDir = join(ctx.openclawHome, "workspace", "skills", name);
  const snapshotId = await createSnapshot(ctx, skill, skillDir);

  // Remove from workspace
  await rm(skillDir, { recursive: true, force: true });

  // Update registry
  const updated = removeSkill(registry, name);
  await saveRegistry(ctx, updated);

  // Update TOOLS.md
  await updateToolsMdSkills(ctx, updated.skills);

  return { skill: { ...skill, rollbackSnapshotId: snapshotId }, snapshotId };
}

/**
 * Update a skill — fetch new version, vet, snapshot old, replace.
 *
 * Like install, this stages first and requires external approval.
 */
export async function stageSkillUpdate(
  ctx: SkillContext,
  name: string,
  newSourceUri?: string,
): Promise<{
  manifest: SkillManifest;
  vetResult: VetResult;
  stagingDir: string;
  currentSkill: InstalledSkill;
}> {
  const registry = await loadRegistry(ctx);
  const currentSkill = findSkill(registry, name);

  if (!currentSkill) {
    throw new SkillError(`Skill "${name}" is not installed.`, "NOT_FOUND");
  }

  const uri = newSourceUri ?? currentSkill.sourceUri;
  const source = newSourceUri ? resolveSource(newSourceUri).source : currentSkill.source;

  // Fetch new version to staging
  const stagingDir = join(ctx.clawhqDir, "skills", "staging", `update-${name}-${Date.now()}`);
  const manifest = await fetchSkill(source, uri, stagingDir);

  // Vet new version
  const vetResult = await vetSkill(stagingDir, manifest.files);

  return { manifest, vetResult, stagingDir, currentSkill };
}

/**
 * Apply a staged skill update after user approval.
 */
export async function applySkillUpdate(
  ctx: SkillContext,
  name: string,
  manifest: SkillManifest,
  stagingDir: string,
): Promise<UpdateResult> {
  const registry = await loadRegistry(ctx);
  const currentSkill = findSkill(registry, name);

  if (!currentSkill) {
    throw new SkillError(`Skill "${name}" is not installed.`, "NOT_FOUND");
  }

  // Snapshot current version
  const skillDir = join(ctx.openclawHome, "workspace", "skills", name);
  const snapshotId = await createSnapshot(ctx, currentSkill, skillDir);

  // Replace with new version
  await rm(skillDir, { recursive: true, force: true });
  await cp(stagingDir, skillDir, { recursive: true });
  await rm(stagingDir, { recursive: true, force: true });

  // Update registry
  const now = new Date().toISOString();
  const updated = updateSkill(registry, name, {
    version: manifest.version,
    installedAt: now,
    requiresContainerDeps: manifest.requiresContainerDeps,
    rollbackSnapshotId: snapshotId,
  });
  await saveRegistry(ctx, updated);

  // Update TOOLS.md
  await updateToolsMdSkills(ctx, updated.skills);

  const vetResult = await vetSkill(skillDir, manifest.files);

  return {
    skill: findSkill(updated, name) ?? updated.skills[updated.skills.length - 1],
    previousVersion: currentSkill.version,
    vetResult,
    snapshotId,
    requiresRebuild: manifest.requiresContainerDeps,
  };
}

/**
 * Rollback a skill to a previous snapshot.
 */
export async function rollbackSkill(
  ctx: SkillContext,
  snapshotId: string,
): Promise<InstalledSkill> {
  const { loadSnapshot } = await import("./snapshot.js");
  const snapshot = await loadSnapshot(ctx, snapshotId);

  if (!snapshot) {
    throw new SkillError(`Snapshot "${snapshotId}" not found.`, "SNAPSHOT_NOT_FOUND");
  }

  if (new Date(snapshot.expiresAt) < new Date()) {
    throw new SkillError(
      `Snapshot "${snapshotId}" has expired (expired ${snapshot.expiresAt}).`,
      "SNAPSHOT_EXPIRED",
    );
  }

  // Restore files
  await restoreSnapshot(ctx, snapshot);

  // Restore registry entry
  let registry = await loadRegistry(ctx);
  const existing = findSkill(registry, snapshot.skillName);
  if (existing) {
    registry = updateSkill(registry, snapshot.skillName, snapshot.registryEntry);
  } else {
    registry = addSkill(registry, snapshot.registryEntry);
  }
  await saveRegistry(ctx, registry);

  // Update TOOLS.md
  await updateToolsMdSkills(ctx, registry.skills);

  return snapshot.registryEntry;
}
