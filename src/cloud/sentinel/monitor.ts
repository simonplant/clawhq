/**
 * Upstream commit monitor — polls OpenClaw GitHub for config-impacting changes.
 *
 * This is the core of Sentinel's upstream intelligence: it watches the
 * OpenClaw repository for commits that change config schema, defaults,
 * or behavior. A local cron job cannot do this because it requires:
 *
 * 1. GitHub API access to poll upstream commits
 * 2. Knowledge of which files map to config-impacting changes
 * 3. Cross-referencing changes against all subscribers' config fingerprints
 *
 * The monitor runs server-side on Sentinel infrastructure. This module
 * provides both the polling logic (for the Sentinel service) and the
 * client-side check that fetches results.
 */

import {
  GITHUB_API_BASE,
  OPENCLAW_GITHUB_REPO,
  SENTINEL_API_TIMEOUT_MS,
  SENTINEL_MAX_COMMITS_PER_CHECK,
} from "../../config/defaults.js";

import type { ConfigImpact, ConfigImpactLevel, UpstreamAnalysis, UpstreamCommit } from "./types.js";

// ── Config-Impacting File Patterns ─────────────────────────────────────────

/**
 * File path patterns that indicate a config-impacting change.
 *
 * When an upstream commit touches these files, it may affect
 * users' deployments. Each pattern maps to an impact level.
 */
const CONFIG_IMPACT_PATTERNS: readonly {
  readonly pattern: RegExp;
  readonly level: ConfigImpactLevel;
  readonly area: string;
}[] = [
  // Schema and config changes — highest impact
  { pattern: /^src\/.*schema.*\.ts$/i, level: "breaking", area: "config-schema" },
  { pattern: /^src\/.*config.*\.ts$/i, level: "high", area: "config" },
  { pattern: /openclaw\.json/i, level: "breaking", area: "runtime-config" },

  // Gateway changes affect all deployments
  { pattern: /^src\/gateway\//i, level: "high", area: "gateway" },
  { pattern: /^src\/.*gateway.*\.ts$/i, level: "high", area: "gateway" },

  // Docker and deployment changes
  { pattern: /Dockerfile/i, level: "high", area: "container" },
  { pattern: /docker-compose/i, level: "high", area: "container" },
  { pattern: /^\.env\.example$/i, level: "medium", area: "environment" },

  // Security changes
  { pattern: /^src\/.*auth.*\.ts$/i, level: "high", area: "authentication" },
  { pattern: /^src\/.*security.*\.ts$/i, level: "high", area: "security" },
  { pattern: /^src\/.*permission.*\.ts$/i, level: "high", area: "permissions" },

  // Tool and skill API changes
  { pattern: /^src\/.*tool.*\.ts$/i, level: "medium", area: "tools" },
  { pattern: /^src\/.*skill.*\.ts$/i, level: "medium", area: "skills" },

  // Cron and scheduling
  { pattern: /^src\/.*cron.*\.ts$/i, level: "medium", area: "cron" },

  // Channel integrations
  { pattern: /^src\/.*channel.*\.ts$/i, level: "medium", area: "channels" },
  { pattern: /^src\/.*telegram.*\.ts$/i, level: "medium", area: "channels" },
  { pattern: /^src\/.*signal.*\.ts$/i, level: "medium", area: "channels" },
  { pattern: /^src\/.*discord.*\.ts$/i, level: "medium", area: "channels" },

  // Memory and workspace
  { pattern: /^src\/.*memory.*\.ts$/i, level: "medium", area: "memory" },
  { pattern: /^src\/.*workspace.*\.ts$/i, level: "low", area: "workspace" },

  // Package dependency changes
  { pattern: /^package\.json$/i, level: "medium", area: "dependencies" },
  { pattern: /^package-lock\.json$/i, level: "low", area: "dependencies" },
];

// ── GitHub API Types ───────────────────────────────────────────────────────

interface GitHubCommitResponse {
  readonly sha: string;
  readonly commit: {
    readonly message: string;
    readonly author: {
      readonly date: string;
      readonly name: string;
    };
  };
  readonly author?: {
    readonly login: string;
  };
  readonly files?: readonly {
    readonly filename: string;
    readonly status: string;
  }[];
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch recent commits from the OpenClaw GitHub repository.
 *
 * Uses the GitHub API to poll for new commits. Supports pagination
 * and an optional "since" timestamp to avoid re-processing.
 */
export async function fetchUpstreamCommits(
  options?: {
    readonly since?: string;
    readonly maxCommits?: number;
    readonly signal?: AbortSignal;
  },
): Promise<readonly UpstreamCommit[]> {
  const maxCommits = options?.maxCommits ?? SENTINEL_MAX_COMMITS_PER_CHECK;
  const url = new URL(`${GITHUB_API_BASE}/repos/${OPENCLAW_GITHUB_REPO}/commits`);
  url.searchParams.set("per_page", String(Math.min(maxCommits, 100)));
  if (options?.since) {
    url.searchParams.set("since", options.since);
  }

  const response = await fetch(url.toString(), {
    headers: {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "ClawHQ-Sentinel/1.0",
    },
    signal: options?.signal ?? AbortSignal.timeout(SENTINEL_API_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: HTTP ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as readonly GitHubCommitResponse[];

  return data.map((commit): UpstreamCommit => ({
    sha: commit.sha,
    message: commit.commit.message.split("\n")[0],
    date: commit.commit.author.date,
    author: commit.author?.login ?? commit.commit.author.name,
    filesChanged: commit.files?.map((f) => f.filename) ?? [],
  }));
}

/**
 * Fetch a single commit with file details from GitHub.
 */
export async function fetchCommitDetails(
  sha: string,
  signal?: AbortSignal,
): Promise<UpstreamCommit> {
  const url = `${GITHUB_API_BASE}/repos/${OPENCLAW_GITHUB_REPO}/commits/${sha}`;

  const response = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "ClawHQ-Sentinel/1.0",
    },
    signal: signal ?? AbortSignal.timeout(SENTINEL_API_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: HTTP ${response.status} ${response.statusText}`);
  }

  const commit = (await response.json()) as GitHubCommitResponse;

  return {
    sha: commit.sha,
    message: commit.commit.message.split("\n")[0],
    date: commit.commit.author.date,
    author: commit.author?.login ?? commit.commit.author.name,
    filesChanged: commit.files?.map((f) => f.filename) ?? [],
  };
}

/**
 * Classify config impacts from a list of changed files.
 *
 * For each file changed in a commit, checks against known config-impacting
 * patterns and returns the impacts found.
 */
export function classifyConfigImpacts(
  commit: UpstreamCommit,
): readonly ConfigImpact[] {
  const impacts: ConfigImpact[] = [];

  for (const file of commit.filesChanged) {
    for (const { pattern, level, area } of CONFIG_IMPACT_PATTERNS) {
      if (pattern.test(file)) {
        impacts.push({
          commitSha: commit.sha,
          configPath: area,
          changeType: detectChangeType(commit.message),
          level,
          description: `${area} change in ${file}: ${commit.message}`,
        });
        break; // One impact per file
      }
    }
  }

  return impacts;
}

/**
 * Analyze upstream commits for config-impacting changes.
 *
 * This is the main analysis function. It takes a list of commits,
 * classifies each one, and produces an analysis report.
 */
export function analyzeUpstreamCommits(
  commits: readonly UpstreamCommit[],
): UpstreamAnalysis {
  const allImpacts: ConfigImpact[] = [];

  for (const commit of commits) {
    const impacts = classifyConfigImpacts(commit);
    allImpacts.push(...impacts);
  }

  return {
    commits,
    impacts: allImpacts,
    hasBreakingChanges: allImpacts.some((i) => i.level === "breaking"),
    analyzedAt: new Date().toISOString(),
  };
}

// ── Internal Helpers ───────────────────────────────────────────────────────

/** Infer change type from commit message keywords. */
function detectChangeType(message: string): ConfigImpact["changeType"] {
  const lower = message.toLowerCase();
  if (lower.includes("deprecat")) return "deprecated";
  if (lower.includes("renam")) return "renamed";
  if (lower.includes("remov") || lower.includes("delet")) return "removed";
  if (lower.includes("default")) return "default-changed";
  if (lower.includes("type") || lower.includes("schema")) return "type-changed";
  return "added";
}
