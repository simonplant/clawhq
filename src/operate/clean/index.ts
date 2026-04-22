/**
 * Housekeeping — sweep workspace debris and clawhq-originated scratch state.
 *
 * Doctor catches class-of-bug problems (misconfigured security posture,
 * missing env vars, etc). `clean` handles the other half: harmless debris
 * that accumulates over time and eventually becomes confusing noise.
 *
 * Scope:
 *   1. Zero-byte files in the workspace root (e.g. `calendar_output.json`
 *      left behind by failed cron attempts). Identity placeholders
 *      (empty MEMORY.md, USER.md) are kept — they're legitimate slots
 *      agents append to.
 *   2. Nested workspace recursion (`workspace/workspace/...`) created by
 *      misconfigured bind mounts or accidental copies.
 *   3. Clawhq test sandboxes in /tmp (`/tmp/clawhq-agent-*`) that outlive
 *      the tests that created them when a test crashes before teardown.
 *   4. OpenClaw daemon's own cron/jobs.json.bak rotations — the daemon
 *      rewrites the `.bak` on every structural change, so only the most
 *      recent one has recovery value.
 *
 * Outside scope (owned by other commands):
 *   - Secrets rotation → `clawhq creds`
 *   - Session history   → `clawhq session archive`
 *   - Memory lifecycle  → `clawhq memory run`
 *   - Encrypted backups → `clawhq backup`
 *   - Ownership table fixes for unclassified files → source edits
 */

import { existsSync, lstatSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEPLOY_WORKSPACE_SUBDIR } from "../../config/paths.js";

// ── Types ───────────────────────────────────────────────────────────────────

/** A single cleanup finding. */
export interface CleanFinding {
  readonly category: CleanCategory;
  readonly path: string;
  readonly reason: string;
  /** Size in bytes (0 for zero-byte debris; dir size for directories). */
  readonly sizeBytes?: number;
}

export type CleanCategory =
  | "workspace-zero-byte"
  | "workspace-nested-recursion"
  | "scratch-agent-sandbox"
  | "cron-backup-rotation"
  | "dangling-symlink";

export interface CleanReport {
  readonly findings: readonly CleanFinding[];
  /** `true` when files were actually removed; `false` for dry-run. */
  readonly applied: boolean;
  /** Count of removed paths. Always 0 when `applied` is false. */
  readonly removed: number;
  /** Paths the scan failed to touch (e.g. permission denied). */
  readonly errors: readonly { path: string; error: string }[];
}

export interface CleanOptions {
  /** Deployment directory (defaults to `~/.clawhq`). */
  readonly deployDir: string;
  /** If true, don't actually delete — return the report only. */
  readonly dryRun?: boolean;
  /** Minutes of age below which /tmp sandboxes are preserved. Default: 60. */
  readonly tmpAgeMinutes?: number;
}

// ── Identity-file allowlist ─────────────────────────────────────────────────

/**
 * Zero-byte files that are LEGITIMATE placeholders, not debris. The agent
 * appends to these over time; deleting would trigger reinitialization.
 */
const ZERO_BYTE_KEEP = new Set([
  "MEMORY.md",
  "USER.md",
  "HEARTBEAT.md",
]);

// ── Scanners ────────────────────────────────────────────────────────────────

async function scanWorkspaceZeroByte(deployDir: string): Promise<CleanFinding[]> {
  const workspace = join(deployDir, DEPLOY_WORKSPACE_SUBDIR);
  if (!existsSync(workspace)) return [];
  const findings: CleanFinding[] = [];
  let entries: string[];
  try {
    entries = await readdir(workspace);
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (ZERO_BYTE_KEEP.has(entry)) continue;
    const full = join(workspace, entry);
    try {
      const s = await stat(full);
      if (s.isFile() && s.size === 0) {
        findings.push({
          category: "workspace-zero-byte",
          path: full,
          reason: "zero-byte file not on the identity-placeholder allowlist (likely debris from a failed cron/tool run)",
          sizeBytes: 0,
        });
      }
    } catch { /* skip */ }
  }
  return findings;
}

async function scanWorkspaceRecursion(deployDir: string): Promise<CleanFinding[]> {
  const nested = join(deployDir, DEPLOY_WORKSPACE_SUBDIR, DEPLOY_WORKSPACE_SUBDIR);
  if (!existsSync(nested)) return [];
  return [{
    category: "workspace-nested-recursion",
    path: nested,
    reason: `nested ${DEPLOY_WORKSPACE_SUBDIR}/${DEPLOY_WORKSPACE_SUBDIR}/ indicates an accidental self-mount or misdirected cp — legitimate workspace never contains itself`,
  }];
}

async function scanAgentSandboxes(ageMinutes: number): Promise<CleanFinding[]> {
  const tmp = tmpdir();
  let entries: string[];
  try {
    entries = await readdir(tmp);
  } catch {
    return [];
  }
  const findings: CleanFinding[] = [];
  const ageMs = ageMinutes * 60 * 1000;
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.startsWith("clawhq-agent-")) continue;
    const full = join(tmp, entry);
    try {
      const s = statSync(full);
      if (!s.isDirectory()) continue;
      if (now - s.mtimeMs < ageMs) continue;
      findings.push({
        category: "scratch-agent-sandbox",
        path: full,
        reason: `clawhq test sandbox older than ${ageMinutes}m (tests create these via mkdtemp; leaked when a test crashed before teardown)`,
        sizeBytes: s.size,
      });
    } catch { /* skip */ }
  }
  return findings;
}

async function scanCronBackupRotation(deployDir: string): Promise<CleanFinding[]> {
  // OpenClaw's daemon writes cron/jobs.json.bak of the prior state on every
  // structural change. Only the most recent has recovery value; any older
  // rotated copies are noise.
  const cronDir = join(deployDir, "cron");
  if (!existsSync(cronDir)) return [];
  let entries: string[];
  try {
    entries = await readdir(cronDir);
  } catch {
    return [];
  }
  const baks = entries
    .filter((e) => e.startsWith("jobs.json.bak"))
    .map((e) => ({ name: e, full: join(cronDir, e), mtime: statSync(join(cronDir, e)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  // Keep the most recent; rotate the rest
  return baks.slice(1).map((b) => ({
    category: "cron-backup-rotation" as const,
    path: b.full,
    reason: "superseded by a newer cron/jobs.json.bak; only the most recent rotation has recovery value",
  }));
}

function scanDanglingSymlinks(deployDir: string): CleanFinding[] {
  // Scan the workspace top level only — deep scan would be expensive and
  // most symlinks live at the top (tool aliases, etc).
  const workspace = join(deployDir, DEPLOY_WORKSPACE_SUBDIR);
  if (!existsSync(workspace)) return [];
  const findings: CleanFinding[] = [];
  let entries: string[];
  try {
    entries = readdirSync(workspace);
  } catch {
    return [];
  }
  for (const entry of entries) {
    const full = join(workspace, entry);
    try {
      const l = lstatSync(full);
      if (!l.isSymbolicLink()) continue;
      const target = readlinkSync(full);
      const resolved = target.startsWith("/") ? target : join(workspace, target);
      if (!existsSync(resolved)) {
        findings.push({
          category: "dangling-symlink",
          path: full,
          reason: `symlink → ${target} resolves to a path that doesn't exist`,
        });
      }
    } catch { /* skip */ }
  }
  return findings;
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function clean(options: CleanOptions): Promise<CleanReport> {
  const tmpAgeMinutes = options.tmpAgeMinutes ?? 60;
  const findings: CleanFinding[] = [];
  findings.push(...await scanWorkspaceZeroByte(options.deployDir));
  findings.push(...await scanWorkspaceRecursion(options.deployDir));
  findings.push(...await scanAgentSandboxes(tmpAgeMinutes));
  findings.push(...await scanCronBackupRotation(options.deployDir));
  findings.push(...scanDanglingSymlinks(options.deployDir));

  if (options.dryRun) {
    return { findings, applied: false, removed: 0, errors: [] };
  }

  let removed = 0;
  const errors: { path: string; error: string }[] = [];
  for (const f of findings) {
    try {
      await rm(f.path, { recursive: true, force: true });
      removed++;
    } catch (err) {
      errors.push({ path: f.path, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { findings, applied: true, removed, errors };
}

// ── Formatting ──────────────────────────────────────────────────────────────

export function formatCleanTable(report: CleanReport): string {
  if (report.findings.length === 0) {
    return "✔ Clean — no housekeeping debris found.";
  }
  const lines: string[] = [];
  const groups = new Map<CleanCategory, CleanFinding[]>();
  for (const f of report.findings) {
    const bucket = groups.get(f.category) ?? [];
    bucket.push(f);
    groups.set(f.category, bucket);
  }
  const labels: Record<CleanCategory, string> = {
    "workspace-zero-byte": "Zero-byte workspace debris",
    "workspace-nested-recursion": "Nested workspace recursion",
    "scratch-agent-sandbox": "Leaked test sandboxes in /tmp",
    "cron-backup-rotation": "Superseded cron backup rotations",
    "dangling-symlink": "Dangling symlinks",
  };
  for (const [cat, items] of groups) {
    lines.push(`${labels[cat]} (${items.length}):`);
    for (const it of items) {
      lines.push(`  ${it.path}`);
    }
    lines.push("");
  }
  lines.push(
    report.applied
      ? `✔ Removed ${report.removed}/${report.findings.length} path(s)${report.errors.length > 0 ? ` (${report.errors.length} errors — see below)` : ""}.`
      : `Found ${report.findings.length} path(s). Run without --dry-run to remove.`,
  );
  if (report.errors.length > 0) {
    lines.push("");
    lines.push("Errors:");
    for (const e of report.errors) {
      lines.push(`  ${e.path} — ${e.error}`);
    }
  }
  return lines.join("\n");
}
