/**
 * Skill management types.
 *
 * Skills are OpenClaw's primary extensibility mechanism. ClawHQ adds a safety
 * layer: sandboxing, vetting, rollback, and TOOLS.md management.
 */

export type SkillStatus = "active" | "disabled";
export type SkillSource = "registry" | "url" | "local";

export interface InstalledSkill {
  name: string;
  version: string;
  source: SkillSource;
  sourceUri: string;
  status: SkillStatus;
  installedAt: string;
  lastUsed: string | null;
  requiresContainerDeps: boolean;
  rollbackSnapshotId: string | null;
}

export interface SkillRegistry {
  skills: InstalledSkill[];
}

export interface VetResult {
  passed: boolean;
  warnings: VetWarning[];
}

export interface VetWarning {
  rule: string;
  severity: "info" | "warn" | "fail";
  message: string;
  file?: string;
  line?: number;
}

export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  files: string[];
  requiresContainerDeps: boolean;
}

export interface SkillContext {
  openclawHome: string;
  clawhqDir: string;
}

export class SkillError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "SkillError";
  }
}
