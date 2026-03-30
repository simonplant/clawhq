/**
 * Construct meta-skill — autonomous self-improvement loop.
 *
 * Runs the five-phase cycle: Assess → Propose → Build → Deploy → Validate.
 * Each phase advances the state machine. Construct-built skills are deployed
 * through the same vetting pipeline as manually installed skills.
 *
 * The construct orchestrator does not call LLMs directly — it manages the
 * state machine, delegates skill installation to the existing pipeline,
 * and persists state across runs. The LLM interaction happens at the agent
 * layer, guided by the prompt templates in configs/skills/construct/prompts/.
 */

import { existsSync, mkdirSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { installSkill, loadManifest } from "../lifecycle.js";
import {
  loadConstructState,
  recordArtifact,
  recordCycle,
  recordGaps,
  recordProposal,
  saveConstructState,
} from "./state.js";
import type {
  ConstructArtifact,
  ConstructCycle,
  ConstructGap,
  ConstructPhase,
  ConstructPhaseResult,
  ConstructPhaseStatus,
  ConstructProgress,
  ConstructProgressCallback,
  ConstructProposal,
  ConstructRunOptions,
  ConstructRunResult,
  ConstructState,
} from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Directory for construct-built skill artifacts before deployment. */
const ARTIFACTS_DIR = "ops/construct/artifacts";

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateCycleId(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  return `cycle-${ts}-${rand}`;
}

function progress(
  cb: ConstructProgressCallback | undefined,
  phase: ConstructPhase,
  status: ConstructPhaseStatus,
  message: string,
): void {
  cb?.({ phase, status, message });
}

function phaseResult(
  phase: ConstructPhase,
  status: ConstructPhaseStatus,
  startedAt: string,
  error?: string,
): ConstructPhaseResult {
  return {
    phase,
    status,
    startedAt,
    completedAt: new Date().toISOString(),
    error,
  };
}

// ── Assess Phase ────────────────────────────────────────────────────────────

/**
 * Run the assess phase — identify capability gaps.
 *
 * This function accepts externally-provided gaps (from the agent's LLM
 * assessment using the assess prompt template). It filters out gaps that
 * have already been assessed in previous runs.
 */
export function assessGaps(
  state: ConstructState,
  candidateGaps: readonly ConstructGap[],
): readonly ConstructGap[] {
  const existingIds = new Set(Object.keys(state.gaps));
  return candidateGaps.filter(
    (gap) => gap.addressable && !existingIds.has(gap.id),
  );
}

// ── Propose Phase ───────────────────────────────────────────────────────────

/**
 * Filter proposals to only those that are new (not already proposed).
 */
export function filterNewProposals(
  state: ConstructState,
  candidates: readonly ConstructProposal[],
): readonly ConstructProposal[] {
  const existing = new Set(Object.keys(state.proposals));
  return candidates.filter((p) => !existing.has(p.skillName));
}

// ── Build Phase ─────────────────────────────────────────────────────────────

/**
 * Write a construct artifact to disk so it can be staged by the skill pipeline.
 *
 * Creates a directory under ops/construct/artifacts/<skill-name>/ with the
 * artifact's files. This directory is then passed to `installSkill` as
 * the source.
 */
export async function writeArtifact(
  deployDir: string,
  artifact: ConstructArtifact,
): Promise<string> {
  const artifactDir = join(deployDir, ARTIFACTS_DIR, artifact.skillName);

  // Clean previous artifact if it exists
  if (existsSync(artifactDir)) {
    await rm(artifactDir, { recursive: true, force: true });
  }
  await mkdir(artifactDir, { recursive: true });

  for (const [relativePath, content] of Object.entries(artifact.files)) {
    const fullPath = join(artifactDir, relativePath);
    const parentDir = join(fullPath, "..");
    mkdirSync(parentDir, { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }

  return artifactDir;
}

// ── Deploy Phase ────────────────────────────────────────────────────────────

/**
 * Deploy a construct-built skill through the standard vetting pipeline.
 *
 * Uses the same `installSkill` function as manually installed skills.
 * The skill must pass security vetting (no critical/high findings) to
 * be activated.
 */
export async function deployConstructedSkill(
  deployDir: string,
  artifactDir: string,
  onProgress?: ConstructProgressCallback,
): Promise<{ success: boolean; skillName: string; error?: string }> {
  const result = await installSkill({
    deployDir,
    source: artifactDir,
    autoApprove: false,
    onProgress: onProgress
      ? (p) => {
          onProgress({
            phase: "deploy",
            status: p.status === "done" ? "completed" : p.status === "failed" ? "failed" : "running",
            message: `[deploy/${p.step}] ${p.message}`,
          });
        }
      : undefined,
  });

  return {
    success: result.success,
    skillName: result.skillName,
    error: result.error,
  };
}

// ── Validate Phase ──────────────────────────────────────────────────────────

/**
 * Validate that a deployed skill is active and correctly configured.
 *
 * Checks the skill manifest to confirm the skill reached "active" status
 * and its vetting report shows no critical/high findings.
 */
export async function validateDeployedSkill(
  deployDir: string,
  skillName: string,
): Promise<{ passed: boolean; checks: readonly { name: string; passed: boolean; detail: string }[] }> {
  const manifest = await loadManifest(deployDir);
  const entry = manifest.skills.find((s) => s.name === skillName);

  const checks: { name: string; passed: boolean; detail: string }[] = [];

  // Check 1: Exists in manifest
  const manifestExists = entry !== undefined;
  checks.push({
    name: "manifest_exists",
    passed: manifestExists,
    detail: manifestExists ? `Skill "${skillName}" found in manifest` : `Skill "${skillName}" not in manifest`,
  });

  if (!entry) {
    return { passed: false, checks };
  }

  // Check 2: Active status
  const isActive = entry.status === "active";
  checks.push({
    name: "manifest_active",
    passed: isActive,
    detail: isActive ? "Status is active" : `Status is "${entry.status}", expected "active"`,
  });

  // Check 3: Vetting passed
  const vetPassed = entry.vetResult?.passed === true;
  checks.push({
    name: "vetting_passed",
    passed: vetPassed,
    detail: vetPassed
      ? `Vetting passed (${entry.vetResult?.findingCount ?? 0} findings, 0 critical/high)`
      : "Vetting did not pass or no vet result recorded",
  });

  // Check 4: No critical/high findings
  const noCritical = (entry.vetResult?.criticalCount ?? 0) === 0 && (entry.vetResult?.highCount ?? 0) === 0;
  checks.push({
    name: "no_critical_findings",
    passed: noCritical,
    detail: noCritical
      ? "No critical or high severity findings"
      : `${entry.vetResult?.criticalCount ?? 0} critical, ${entry.vetResult?.highCount ?? 0} high findings`,
  });

  const passed = checks.every((c) => c.passed);
  return { passed, checks };
}

// ── Full Cycle ──────────────────────────────────────────────────────────────

/**
 * Run a complete construct cycle.
 *
 * This orchestrates the five phases, persisting state after each phase.
 * The cycle accepts externally-provided assessment results, proposals,
 * and artifacts — the agent generates these via the prompt templates.
 *
 * This separation keeps the construct engine deterministic and testable
 * while the LLM handles the creative work.
 */
export async function runConstructCycle(
  options: ConstructRunOptions,
  inputs: {
    gaps: readonly ConstructGap[];
    proposals: readonly ConstructProposal[];
    artifacts: readonly ConstructArtifact[];
  },
): Promise<ConstructRunResult> {
  const { deployDir, onProgress } = options;
  const cycleId = generateCycleId();
  const cycleStartedAt = new Date().toISOString();

  let state = await loadConstructState(deployDir);
  const phaseResults: ConstructPhaseResult[] = [];
  const deployedSkills: string[] = [];
  const validatedSkills: string[] = [];

  // ── Phase 1: Assess ─────────────────────────────────────────────────────
  const assessStart = new Date().toISOString();
  progress(onProgress, "assess", "running", "Assessing capability gaps...");

  const newGaps = assessGaps(state, inputs.gaps);
  state = recordGaps(state, newGaps);
  await saveConstructState(deployDir, state);

  phaseResults.push(phaseResult("assess", "completed", assessStart));
  progress(onProgress, "assess", "completed", `Found ${newGaps.length} new gap(s)`);

  // ── Phase 2: Propose ────────────────────────────────────────────────────
  const proposeStart = new Date().toISOString();
  progress(onProgress, "propose", "running", "Filtering proposals...");

  const newProposals = filterNewProposals(state, inputs.proposals);
  for (const proposal of newProposals) {
    state = recordProposal(state, proposal);
  }
  await saveConstructState(deployDir, state);

  phaseResults.push(phaseResult("propose", "completed", proposeStart));
  progress(onProgress, "propose", "completed", `${newProposals.length} new proposal(s)`);

  // ── Phase 3: Build ──────────────────────────────────────────────────────
  const buildStart = new Date().toISOString();
  progress(onProgress, "build", "running", "Building skill artifacts...");

  const artifactDirs: Array<{ skillName: string; dir: string }> = [];
  for (const artifact of inputs.artifacts) {
    // Only build for approved proposals
    const proposal = state.proposals[artifact.skillName];
    if (!proposal?.approved) {
      continue;
    }
    const dir = await writeArtifact(deployDir, artifact);
    state = recordArtifact(state, artifact);
    artifactDirs.push({ skillName: artifact.skillName, dir });
  }
  await saveConstructState(deployDir, state);

  phaseResults.push(phaseResult("build", "completed", buildStart));
  progress(onProgress, "build", "completed", `Built ${artifactDirs.length} artifact(s)`);

  // ── Phase 4: Deploy ─────────────────────────────────────────────────────
  const deployStart = new Date().toISOString();
  progress(onProgress, "deploy", "running", "Deploying through vetting pipeline...");

  for (const { skillName, dir } of artifactDirs) {
    const result = await deployConstructedSkill(deployDir, dir, onProgress);
    if (result.success) {
      deployedSkills.push(skillName);
    }
  }
  await saveConstructState(deployDir, state);

  phaseResults.push(phaseResult("deploy", "completed", deployStart));
  progress(onProgress, "deploy", "completed", `Deployed ${deployedSkills.length} skill(s)`);

  // ── Phase 5: Validate ───────────────────────────────────────────────────
  const validateStart = new Date().toISOString();
  progress(onProgress, "validate", "running", "Validating deployed skills...");

  for (const skillName of deployedSkills) {
    const validation = await validateDeployedSkill(deployDir, skillName);
    if (validation.passed) {
      validatedSkills.push(skillName);
    }
  }

  phaseResults.push(phaseResult("validate", "completed", validateStart));
  progress(onProgress, "validate", "completed", `Validated ${validatedSkills.length} skill(s)`);

  // ── Record Cycle ────────────────────────────────────────────────────────
  const cycle: ConstructCycle = {
    id: cycleId,
    startedAt: cycleStartedAt,
    completedAt: new Date().toISOString(),
    phases: phaseResults,
    gaps: newGaps.map((g) => g.id),
    proposals: newProposals.map((p) => p.skillName),
    deployed: deployedSkills,
    validated: validatedSkills,
  };
  state = recordCycle(state, cycle);
  await saveConstructState(deployDir, state);

  return {
    success: true,
    cycleId,
    gapsFound: newGaps.length,
    proposalsGenerated: newProposals.length,
    skillsDeployed: deployedSkills.length,
    skillsValidated: validatedSkills.length,
  };
}

/**
 * Get a summary of the current construct state for display.
 */
export async function getConstructStatus(
  deployDir: string,
): Promise<{
  totalGaps: number;
  totalProposals: number;
  totalArtifacts: number;
  totalCycles: number;
  lastCycleAt: string | null;
}> {
  const state = await loadConstructState(deployDir);
  const lastCycle = state.cycles.length > 0 ? state.cycles[state.cycles.length - 1] : null;
  return {
    totalGaps: Object.keys(state.gaps).length,
    totalProposals: Object.keys(state.proposals).length,
    totalArtifacts: Object.keys(state.artifacts).length,
    totalCycles: state.cycles.length,
    lastCycleAt: lastCycle?.completedAt ?? null,
  };
}
