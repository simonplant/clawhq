/**
 * Change intelligence — deployment-specific update impact analysis.
 *
 * Wires existing Sentinel infrastructure (upstream commit analysis,
 * config fingerprinting, breakage prediction) into the update check flow.
 * The result tells the user not just "update available" but what changed,
 * what it means for THEIR deployment, and whether to update now or wait.
 *
 * All Sentinel modules are reused without modification:
 * - monitor.ts → fetchUpstreamCommits, analyzeUpstreamCommits
 * - analyzer.ts → predictBreakage
 * - fingerprint.ts → generateFingerprint
 */

import { predictBreakage } from "../../cloud/sentinel/analyzer.js";
import { generateFingerprint } from "../../cloud/sentinel/fingerprint.js";
import {
  analyzeUpstreamCommits,
} from "../../cloud/sentinel/monitor.js";
import type { UpstreamCommit } from "../../cloud/sentinel/types.js";
import { GITHUB_API_BASE, OPENCLAW_GITHUB_REPO } from "../../config/defaults.js";

import { buildMigrationPlan } from "./migrations/index.js";
import type { MigrationPlan } from "./migrations/types.js";
import type {
  ChangeIntelligenceReport,
  ReleaseClassification,
  UpdateRecommendation,
} from "./types.js";

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Analyze what changed between current and target versions.
 *
 * Flow:
 * 1. Fetch commits between current and target from GitHub API
 * 2. Classify config impacts for each commit
 * 3. Generate config fingerprint for this deployment
 * 4. Predict breakage against the fingerprint
 * 5. Build migration plan
 * 6. Classify the release and generate recommendation
 */
export async function analyzeUpdate(options: {
  readonly deployDir: string;
  readonly currentVersion: string;
  readonly targetVersion: string;
  readonly signal?: AbortSignal;
}): Promise<ChangeIntelligenceReport> {
  const { deployDir, currentVersion, targetVersion, signal } = options;

  // 1. Fetch commits between the two version tags via GitHub compare API
  const commits = await fetchCommitsBetweenVersions(currentVersion, targetVersion, signal);

  // 2. Analyze commits for config-impacting changes
  const upstream = analyzeUpstreamCommits(commits);

  // 3. Generate privacy-safe config fingerprint
  const fingerprint = generateFingerprint(deployDir);

  // 4. Predict breakage for this specific deployment
  const breakage = predictBreakage(upstream, fingerprint);

  // 5. Build migration plan
  const migrationPlan = buildMigrationPlan(currentVersion, targetVersion);
  const hasMigrations = migrationPlan.migrations.length > 0;

  // 6. Fetch release notes (best-effort)
  const releaseNotes = await fetchReleaseNotes(targetVersion, signal);

  // 7. Classify and recommend
  const classification = classifyRelease(upstream, releaseNotes, migrationPlan);
  const recommendation = generateRecommendation(classification, breakage, migrationPlan);

  // Collect unique impact areas
  const impactAreas = [...new Set(upstream.impacts.map((i) => i.configPath))];

  return {
    classification,
    commitCount: commits.length,
    impactAreas,
    hasBreakageRisk: breakage.shouldHoldUpdate,
    migrationPlan: hasMigrations ? migrationPlan : null,
    recommendation,
    releaseNotes: releaseNotes ?? undefined,
  };
}

// ── Version-Scoped Commit Fetching ───────────────────────────────────────

/**
 * Fetch commits between two version tags using the GitHub compare API.
 *
 * BUG-8 FIX: Uses compare endpoint to scope commits to the actual version
 * range, instead of fetchUpstreamCommits which returns all recent commits.
 */
async function fetchCommitsBetweenVersions(
  fromVersion: string,
  toVersion: string,
  signal?: AbortSignal,
): Promise<readonly UpstreamCommit[]> {
  try {
    const url = `${GITHUB_API_BASE}/repos/${OPENCLAW_GITHUB_REPO}/compare/${fromVersion}...${toVersion}`;
    const response = await fetch(url, {
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "ClawHQ-Updater/1.0",
      },
      signal: signal ?? AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      // Fall back to unscoped fetch if compare fails (e.g. tags don't exist on remote)
      const { fetchUpstreamCommits } = await import("../../cloud/sentinel/monitor.js");
      return fetchUpstreamCommits({ signal });
    }

    const data = (await response.json()) as {
      commits: readonly {
        sha: string;
        commit: { message: string; author: { date: string; name: string } };
        author?: { login: string } | null;
        files?: readonly { filename: string }[];
      }[];
    };

    return data.commits.map((c): UpstreamCommit => ({
      sha: c.sha,
      message: c.commit.message.split("\n")[0],
      date: c.commit.author.date,
      author: c.author?.login ?? c.commit.author.name,
      filesChanged: c.files?.map((f) => f.filename) ?? [],
    }));
  } catch {
    // Fall back to unscoped fetch
    const { fetchUpstreamCommits } = await import("../../cloud/sentinel/monitor.js");
    return fetchUpstreamCommits({ signal });
  }
}

// ── Release Notes ─────────────────────────────────────────────────────────

/**
 * Fetch GitHub release notes for a specific tag.
 *
 * Returns the release body text, or null if not found / unreachable.
 */
export async function fetchReleaseNotes(
  tag: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const url = `${GITHUB_API_BASE}/repos/${OPENCLAW_GITHUB_REPO}/releases/tags/${tag}`;
    const response = await fetch(url, {
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "ClawHQ-Updater/1.0",
      },
      signal: signal ?? AbortSignal.timeout(10_000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { body?: string };
    return data.body ?? null;
  } catch {
    return null;
  }
}

// ── Classification ────────────────────────────────────────────────────────

/** Classify a release based on upstream analysis and release notes. */
export function classifyRelease(
  analysis: UpstreamAnalysis,
  releaseNotes: string | null,
  migrationPlan: MigrationPlan,
): ReleaseClassification {
  // Breaking if there are breaking impacts or breaking migrations
  if (analysis.hasBreakingChanges || migrationPlan.hasBreakingChanges) {
    return "breaking";
  }

  // Security if release notes or commits mention CVE/security
  const securityPattern = /\b(CVE-\d{4}-\d+|security|vulnerab)/i;
  const hasSecurityMention = (releaseNotes && securityPattern.test(releaseNotes))
    || analysis.commits.some((c) => securityPattern.test(c.message));

  if (hasSecurityMention) return "security-patch";

  // Feature if commits mention feat/feature/add
  const featurePattern = /\b(feat|feature|add)\b/i;
  const hasFeature = analysis.commits.some((c) => featurePattern.test(c.message));

  if (hasFeature) return "feature";

  return "bugfix";
}

// ── Recommendation ────────────────────────────────────────────────────────

/** Generate update recommendation based on all intelligence. */
export function generateRecommendation(
  classification: ReleaseClassification,
  breakage: BreakageReport,
  migrationPlan: MigrationPlan | null,
): UpdateRecommendation {
  const risks: string[] = [];

  // Collect risks
  if (breakage.shouldHoldUpdate) {
    risks.push(`${breakage.predictions.length} config breakage prediction(s) for your deployment`);
  }

  if (migrationPlan && migrationPlan.hasBreakingChanges) {
    risks.push("Migrations include compose or schema changes (requires container rebuild)");
  }

  if (migrationPlan && migrationPlan.migrations.length > 3) {
    risks.push(`Large migration path: ${migrationPlan.migrations.length} migrations to apply`);
  }

  // Determine action
  if (classification === "security-patch") {
    return {
      action: breakage.shouldHoldUpdate ? "update-soon" : "update-now",
      reason: breakage.shouldHoldUpdate
        ? "Security patch with potential config impacts — review breakage predictions, then update"
        : "Security patch — apply as soon as possible",
      risks,
    };
  }

  if (breakage.shouldHoldUpdate) {
    return {
      action: "hold",
      reason: "Upstream changes may break your deployment — review breakage predictions before updating",
      risks,
    };
  }

  if (classification === "breaking") {
    return {
      action: "wait",
      reason: "Breaking changes detected — review migration plan and test in a non-production environment first",
      risks,
    };
  }

  return {
    action: "update-soon",
    reason: classification === "feature"
      ? "New features available — update at your convenience"
      : "Bug fixes available — update when ready",
    risks,
  };
}
