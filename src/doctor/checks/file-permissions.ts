/**
 * Check: File permissions — .env is 600, identity files are read-only.
 * Fixable: can chmod to correct permissions.
 */

import { constants, access } from "node:fs/promises";
import { stat, chmod } from "node:fs/promises";
import { join } from "node:path";

import type { CheckResult, DoctorContext, FixableCheck, FixResult } from "../types.js";

const IDENTITY_FILES = [
  "SOUL.md",
  "USER.md",
  "AGENTS.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "IDENTITY.md",
  "BOOT.md",
  "BOOTSTRAP.md",
];

interface PermIssue {
  path: string;
  current: string;
  expected: string;
}

async function findIssues(ctx: DoctorContext): Promise<PermIssue[]> {
  const issues: PermIssue[] = [];

  // Check .env permissions (should be 0o600)
  if (ctx.envPath) {
    try {
      const s = await stat(ctx.envPath);
      const mode = s.mode & 0o777;
      if (mode !== 0o600) {
        issues.push({
          path: ctx.envPath,
          current: "0" + mode.toString(8),
          expected: "0600",
        });
      }
    } catch {
      // .env doesn't exist — not a permission issue
    }
  }

  // Check identity files are not world-writable (should be readable, not writable by group/other)
  const workspacePath = join(ctx.openclawHome, "workspace");
  for (const filename of IDENTITY_FILES) {
    const filePath = join(workspacePath, filename);
    try {
      await access(filePath, constants.F_OK);
      const s = await stat(filePath);
      const mode = s.mode & 0o777;
      // Identity files should be read-only: 0o444 or 0o644 (owner write OK, no group/other write)
      if (mode & 0o022) {
        issues.push({
          path: filePath,
          current: "0" + mode.toString(8),
          expected: "0644 or stricter",
        });
      }
    } catch {
      // File doesn't exist — skip
    }
  }

  return issues;
}

export const filePermissionsCheck: FixableCheck = {
  name: "File permissions",

  async run(ctx: DoctorContext): Promise<CheckResult> {
    const issues = await findIssues(ctx);

    if (issues.length === 0) {
      return {
        name: this.name,
        status: "pass",
        message: ".env and identity file permissions are correct",
        fix: "",
      };
    }

    const details = issues
      .map((i) => `${i.path}: ${i.current} (expected ${i.expected})`)
      .join("; ");

    return {
      name: this.name,
      status: "fail",
      message: `${issues.length} file(s) with incorrect permissions: ${details}`,
      fix: "Run `clawhq doctor --fix` to auto-fix permissions",
    };
  },

  async fix(ctx: DoctorContext): Promise<FixResult> {
    const issues = await findIssues(ctx);
    if (issues.length === 0) {
      return { name: this.name, fixed: true, message: "No permission issues to fix" };
    }

    const fixed: string[] = [];
    const errors: string[] = [];

    for (const issue of issues) {
      try {
        if (issue.expected === "0600") {
          await chmod(issue.path, 0o600);
        } else {
          // Identity files: remove group/other write
          const s = await stat(issue.path);
          const newMode = s.mode & ~0o022;
          await chmod(issue.path, newMode & 0o777);
        }
        fixed.push(issue.path);
      } catch (err: unknown) {
        errors.push(`${issue.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (errors.length > 0) {
      return {
        name: this.name,
        fixed: false,
        message: `Fixed ${fixed.length}, failed ${errors.length}: ${errors.join("; ")}`,
      };
    }

    return {
      name: this.name,
      fixed: true,
      message: `Fixed permissions on ${fixed.length} file(s)`,
    };
  },
};
