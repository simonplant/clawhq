/**
 * Skill snapshots — rollback support for skill install/update/remove.
 *
 * Snapshots store a copy of the skill directory and its registry entry,
 * enabling rollback within a 30-day window.
 */

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { InstalledSkill, SkillContext } from "./types.js";

const SNAPSHOTS_DIR = "skills/snapshots";
const ROLLBACK_DAYS = 30;

export interface SkillSnapshot {
  snapshotId: string;
  skillName: string;
  createdAt: string;
  expiresAt: string;
  registryEntry: InstalledSkill;
  skillDirPath: string;
}

function snapshotsDir(ctx: SkillContext): string {
  return join(ctx.clawhqDir, SNAPSHOTS_DIR);
}

/**
 * Create a rollback snapshot of a skill before modification.
 */
export async function createSnapshot(
  ctx: SkillContext,
  skill: InstalledSkill,
  skillDir: string,
): Promise<string> {
  const now = new Date();
  const snapshotId = `snap-${skill.name}-${now.getTime()}`;
  const snapshotDir = join(snapshotsDir(ctx), snapshotId);

  await mkdir(snapshotDir, { recursive: true });

  // Copy skill directory
  const skillBackupDir = join(snapshotDir, "files");
  await cp(skillDir, skillBackupDir, { recursive: true });

  // Save registry entry
  const expires = new Date(now.getTime() + ROLLBACK_DAYS * 24 * 60 * 60 * 1000);
  const snapshot: SkillSnapshot = {
    snapshotId,
    skillName: skill.name,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    registryEntry: skill,
    skillDirPath: skillBackupDir,
  };

  await writeFile(
    join(snapshotDir, "snapshot.json"),
    JSON.stringify(snapshot, null, 2) + "\n",
    "utf-8",
  );

  return snapshotId;
}

/**
 * Load a snapshot by ID.
 */
export async function loadSnapshot(
  ctx: SkillContext,
  snapshotId: string,
): Promise<SkillSnapshot | null> {
  const path = join(snapshotsDir(ctx), snapshotId, "snapshot.json");
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as SkillSnapshot;
  } catch {
    return null;
  }
}

/**
 * Restore a skill from a snapshot.
 * Returns the skill directory files were restored to.
 */
export async function restoreSnapshot(
  ctx: SkillContext,
  snapshot: SkillSnapshot,
): Promise<string> {
  const targetDir = join(ctx.openclawHome, "workspace", "skills", snapshot.skillName);
  await rm(targetDir, { recursive: true, force: true });
  await cp(snapshot.skillDirPath, targetDir, { recursive: true });
  return targetDir;
}

/**
 * Delete a snapshot.
 */
export async function deleteSnapshot(
  ctx: SkillContext,
  snapshotId: string,
): Promise<void> {
  const dir = join(snapshotsDir(ctx), snapshotId);
  await rm(dir, { recursive: true, force: true });
}
