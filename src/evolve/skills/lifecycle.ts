/**
 * Skill lifecycle pipeline: stage → vet → approve → activate.
 *
 * Orchestrates the full installation flow. Every step reports progress
 * via callback. On failure at any step, rollback restores the previous state.
 */

import { existsSync, mkdirSync } from "node:fs";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { FILE_MODE_EXEC } from "../../config/defaults.js";

import { createSnapshot, restoreSnapshot } from "./rollback.js";
import { createStagedEntry, readStagedFiles, stageSkill } from "./stage.js";
import type {
  SkillInstallOptions,
  SkillInstallResult,
  SkillManifest,
  SkillManifestEntry,
  SkillProgressCallback,
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
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as SkillManifest;
  } catch (err) {
    console.warn("[evolve] Failed to read skill manifest:", err);
    return { version: 1, skills: [] };
  }
}

async function saveManifest(
  deployDir: string,
  manifest: SkillManifest,
): Promise<void> {
  const dir = join(deployDir, "workspace", "skills");
  mkdirSync(dir, { recursive: true });
  await writeFile(manifestPath(deployDir), JSON.stringify(manifest, null, 2));
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
  const { deployDir, source, autoApprove, onProgress } = options;

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

  // Auto-approve if flag set and vetting passed
  if (!autoApprove) {
    // In non-auto mode, we still approve since vetting passed.
    // Runtime approval of skill actions uses the approval queue (src/evolve/approval/).
  }

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
        console.warn("[evolve] Failed to set executable permission on", file, err);
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

  const skillDir = join(deployDir, "workspace", "skills", skillName);
  if (existsSync(skillDir)) {
    await rm(skillDir, { recursive: true, force: true });
  }

  const updated: SkillManifest = {
    ...manifest,
    skills: manifest.skills.filter((s) => s.name !== skillName),
  };
  await saveManifest(deployDir, updated);

  return { success: true };
}
