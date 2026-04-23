/**
 * Skill lifecycle pipeline: stage → vet → approve → activate.
 *
 * Orchestrates the full installation flow. Every step reports progress
 * via callback. On failure at any step, rollback restores the previous state.
 */

import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { chmod, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { DIR_MODE_SECRET, FILE_MODE_EXEC, FILE_MODE_SECRET } from "../../config/defaults.js";
import { writeFileAtomic } from "../../config/fs-atomic.js";

import { createSnapshot, restoreSnapshot } from "./rollback.js";
import { createStagedEntry, readStagedFiles, stageSkill } from "./stage.js";
import type {
  SkillInstallOptions,
  SkillInstallResult,
  SkillManifest,
  SkillManifestEntry,
  SkillProgressCallback,
  SkillUpdateResult,
} from "./types.js";
import { vetSkill } from "./vet.js";

// ── Constants ────────────────────────────────────────────────────────────────

const MANIFEST_FILENAME = ".skill-manifest.json";

// ── Manifest I/O ─────────────────────────────────────────────────────────────

function manifestPath(deployDir: string): string {
  return join(deployDir, "workspace", "skills", MANIFEST_FILENAME);
}

export async function loadManifest(deployDir: string): Promise<SkillManifest> {
  const path = manifestPath(deployDir);
  if (!existsSync(path)) {
    return { version: 1, skills: [] };
  }
  // A corrupted manifest used to silently become an empty manifest, which
  // the next saveManifest would then persist — de-registering every
  // installed skill. Now fails loud with an actionable message.
  const raw = await readFile(path, "utf-8");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `skill manifest at ${path} is corrupt: ${msg}. ` +
      `Existing skills may still be installed in workspace/skills/ — restore the manifest from a backup (.bak) ` +
      `or re-register them with \`clawhq skill install\`.`,
      { cause: err },
    );
  }
  if (parsed.version !== 1) {
    throw new Error(
      `Unsupported skill manifest version ${String(parsed.version)} (expected 1). ` +
      `The manifest at ${path} may have been created by a newer version of ClawHQ.`,
    );
  }
  if (!Array.isArray(parsed.skills)) {
    throw new Error(`skill manifest at ${path} is missing the \`skills\` array`);
  }
  return parsed as unknown as SkillManifest;
}

async function saveManifest(
  deployDir: string,
  manifest: SkillManifest,
): Promise<void> {
  const dir = join(deployDir, "workspace", "skills");
  mkdirSync(dir, { recursive: true, mode: DIR_MODE_SECRET });
  chmodSync(dir, DIR_MODE_SECRET);
  // Atomic write via tmp+rename; prevents torn manifest on crash.
  writeFileAtomic(manifestPath(deployDir), JSON.stringify(manifest, null, 2) + "\n", FILE_MODE_SECRET);
}

function updateEntry(
  manifest: SkillManifest,
  entry: SkillManifestEntry,
): SkillManifest {
  const filtered = manifest.skills.filter((s) => s.name !== entry.name);
  return { ...manifest, skills: [...filtered, entry] };
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

function progress(
  cb: SkillProgressCallback | undefined,
  step: "stage" | "vet" | "approve" | "activate",
  status: "running" | "done" | "failed",
  message: string,
): void {
  cb?.({ step, status, message });
}

/**
 * Install a skill through the full lifecycle pipeline.
 *
 * 1. **Stage** — copy skill files from source to workspace/skills/
 * 2. **Vet** — scan all files for security threats (URL traps, etc.)
 * 3. **Approve** — if vetting passes, mark as approved (or auto-approve)
 * 4. **Activate** — set executable permissions, mark as active
 *
 * If any step fails, rollback restores the previous state.
 */
export async function installSkill(
  options: SkillInstallOptions,
): Promise<SkillInstallResult> {
  const { deployDir, source, onProgress } = options;

  // ── Step 0: Rollback snapshot ──────────────────────────────────────────
  const snapshot = await createSnapshot(
    deployDir,
    `pre-install: ${source}`,
  );

  let manifest = await loadManifest(deployDir);

  // ── Step 1: Stage ──────────────────────────────────────────────────────
  progress(onProgress, "stage", "running", `Staging skill from ${source}...`);

  const stageResult = await stageSkill(source, deployDir);
  if (!stageResult.success) {
    progress(onProgress, "stage", "failed", stageResult.error ?? "Stage failed");
    await restoreSnapshot(deployDir, snapshot.id);
    return {
      success: false,
      skillName: stageResult.skillName,
      status: "rolled-back",
      snapshotId: snapshot.id,
      error: stageResult.error,
    };
  }

  const entry = createStagedEntry(stageResult.skillName, source, snapshot.id);
  manifest = updateEntry(manifest, entry);
  await saveManifest(deployDir, manifest);

  progress(onProgress, "stage", "done", `Staged ${stageResult.skillName} (${stageResult.files.length} files)`);

  // ── Step 2: Vet ────────────────────────────────────────────────────────
  progress(onProgress, "vet", "running", "Scanning for security threats...");

  const stagedFiles = await readStagedFiles(stageResult.stagingDir);
  const vetReport = vetSkill(stageResult.skillName, stagedFiles);

  if (!vetReport.passed) {
    progress(
      onProgress,
      "vet",
      "failed",
      `Vetting failed: ${vetReport.summary.criticalCount} critical, ${vetReport.summary.highCount} high findings`,
    );

    // Update manifest to rejected
    const rejectedEntry: SkillManifestEntry = {
      ...entry,
      status: "rejected",
      vetResult: vetReport.summary,
    };
    manifest = updateEntry(manifest, rejectedEntry);
    await saveManifest(deployDir, manifest);

    // Remove staged files
    await rm(stageResult.stagingDir, { recursive: true, force: true });

    // Restore from snapshot
    await restoreSnapshot(deployDir, snapshot.id);

    return {
      success: false,
      skillName: stageResult.skillName,
      status: "rejected",
      vetReport,
      snapshotId: snapshot.id,
      error: `Security vetting failed with ${vetReport.summary.findingCount} finding(s).`,
    };
  }

  // Update manifest to vetted
  const vettedEntry: SkillManifestEntry = {
    ...entry,
    status: "vetted",
    vetResult: vetReport.summary,
  };
  manifest = updateEntry(manifest, vettedEntry);
  await saveManifest(deployDir, manifest);

  progress(onProgress, "vet", "done", `Vetting passed (${vetReport.summary.findingCount} findings, all low/medium)`);

  // ── Step 3: Approve ────────────────────────────────────────────────────
  progress(onProgress, "approve", "running", "Awaiting approval...");

  // Vetting passed — auto-approve. Runtime approval of skill actions
  // uses the approval queue (src/evolve/approval/), not this install-time flag.
  const approvedEntry: SkillManifestEntry = {
    ...vettedEntry,
    status: "approved",
  };
  manifest = updateEntry(manifest, approvedEntry);
  await saveManifest(deployDir, manifest);

  progress(onProgress, "approve", "done", "Skill approved");

  // ── Step 4: Activate ───────────────────────────────────────────────────
  progress(onProgress, "activate", "running", "Activating skill...");

  // Set executable permissions on script files
  for (const file of stageResult.files) {
    if (file.endsWith(".sh") || file.endsWith(".bash") || file.endsWith(".py")) {
      try {
        await chmod(join(stageResult.stagingDir, file), FILE_MODE_EXEC);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        progress(onProgress, "activate", "running", `Warning: chmod failed for ${file}: ${msg}`);
      }
    }
  }

  const activeEntry: SkillManifestEntry = {
    ...approvedEntry,
    status: "active",
    activatedAt: new Date().toISOString(),
  };
  manifest = updateEntry(manifest, activeEntry);
  await saveManifest(deployDir, manifest);

  progress(onProgress, "activate", "done", `Skill "${stageResult.skillName}" is now active`);

  return {
    success: true,
    skillName: stageResult.skillName,
    status: "active",
    vetReport,
    snapshotId: snapshot.id,
  };
}

/**
 * Remove an installed skill and update the manifest.
 *
 * Two-phase with a snapshot so a failure between rm and saveManifest can be
 * rolled back. Without the snapshot, a crashed remove left files gone but
 * the manifest still listing the skill — subsequent apply then couldn't
 * reconcile.
 */
export async function removeSkill(
  deployDir: string,
  skillName: string,
): Promise<{ success: boolean; error?: string }> {
  const manifest = await loadManifest(deployDir);
  const entry = manifest.skills.find((s) => s.name === skillName);

  if (!entry) {
    return { success: false, error: `Skill "${skillName}" not found.` };
  }

  // Snapshot the skills tree before any destructive action so we can roll
  // back if saveManifest fails after rm. The snapshot captures both the
  // skill's files and the manifest.
  const snapshot = await createSnapshot(deployDir, `pre-remove: ${skillName}`);

  const skillDir = join(deployDir, "workspace", "skills", skillName);

  try {
    if (existsSync(skillDir)) {
      await rm(skillDir, { recursive: true, force: true });
    }
    const updated: SkillManifest = {
      ...manifest,
      skills: manifest.skills.filter((s) => s.name !== skillName),
    };
    await saveManifest(deployDir, updated);
    return { success: true };
  } catch (err) {
    // Rollback: restore skill files + manifest from the pre-remove snapshot.
    await restoreSnapshot(deployDir, snapshot.id);
    return {
      success: false,
      error: `Remove failed and rolled back: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Update an installed skill by removing and reinstalling from its original source.
 *
 * 1. Snapshot current state for rollback
 * 2. Remove the existing skill
 * 3. Reinstall from the original source
 * 4. On failure, restore from snapshot
 */
export async function updateSkill(
  deployDir: string,
  skillName: string,
  onProgress?: SkillProgressCallback,
): Promise<SkillUpdateResult> {
  const manifest = await loadManifest(deployDir);
  const entry = manifest.skills.find((s) => s.name === skillName);

  if (!entry) {
    return { success: false, skillName, status: "not-found", error: `Skill "${skillName}" not found.` };
  }

  const { source } = entry;

  // ── Step 0: Snapshot for rollback ──────────────────────────────────────
  const snapshot = await createSnapshot(deployDir, `pre-update: ${skillName}`);

  // ── Step 1: Remove current version ─────────────────────────────────────
  const removeResult = await removeSkill(deployDir, skillName);
  if (!removeResult.success) {
    await restoreSnapshot(deployDir, snapshot.id);
    return {
      success: false,
      skillName,
      status: "rolled-back",
      error: `Failed to remove old version: ${removeResult.error}`,
    };
  }

  // ── Step 2: Reinstall from original source ─────────────────────────────
  const installResult = await installSkill({
    deployDir,
    source,
    autoApprove: true,
    onProgress,
  });

  if (!installResult.success) {
    // Restore the pre-update snapshot (brings back the old version)
    await restoreSnapshot(deployDir, snapshot.id);
    return {
      success: false,
      skillName,
      status: "rolled-back",
      error: `Reinstall failed: ${installResult.error}`,
    };
  }

  return { success: true, skillName, status: "updated" };
}

/**
 * Update all installed skills. Returns per-skill results.
 */
export async function updateAllSkills(
  deployDir: string,
  onProgress?: SkillProgressCallback,
): Promise<SkillUpdateResult[]> {
  const manifest = await loadManifest(deployDir);
  const results: SkillUpdateResult[] = [];

  for (const entry of manifest.skills) {
    const result = await updateSkill(deployDir, entry.name, onProgress);
    results.push(result);
  }

  return results;
}
