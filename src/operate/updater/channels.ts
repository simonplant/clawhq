/**
 * Update channel filtering — determines which version to target.
 *
 * Channels control the update policy:
 * - security: only CVE/security patches
 * - stable: release tags delayed by N days (default: 7)
 * - latest: newest release tag (current behavior)
 * - pinned: locked to a specific version
 */

import { GITHUB_API_BASE, OPENCLAW_GITHUB_REPO } from "../../config/defaults.js";

import { compareVersions, parseCalVer } from "./calver.js";
import type { UpdateChannel } from "./types.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ChannelFilterOptions {
  readonly channel: UpdateChannel;
  /** Pinned version (only used when channel is "pinned"). */
  readonly pinnedVersion?: string;
  /** Delay in days for stable channel (default: 7). */
  readonly stableDelayDays?: number;
  readonly signal?: AbortSignal;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve the target version for an update based on channel policy.
 *
 * For source installs, filters git tags. For cache installs, determines
 * which image tag to target.
 *
 * @param availableTags - All available version tags (e.g. from `git tag -l`)
 * @param options - Channel configuration
 * @returns The resolved target tag, or null if no suitable version found
 */
export async function resolveTargetVersion(
  availableTags: readonly string[],
  options: ChannelFilterOptions,
): Promise<string | null> {
  const { channel, pinnedVersion, stableDelayDays = 7 } = options;

  // Filter to valid release tags (v* format, no pre-release)
  const releaseTags = availableTags
    .filter((t) => /^v\d/.test(t) && !/-/.test(t.replace(/^v/, "")))
    .filter((t) => parseCalVer(t) !== null);

  if (releaseTags.length === 0) return null;

  // Sort newest first
  const sorted = [...releaseTags].sort((a, b) => compareVersions(b, a));

  switch (channel) {
    case "pinned":
      return pinnedVersion && releaseTags.includes(pinnedVersion)
        ? pinnedVersion
        : null;

    case "latest":
      return sorted[0] ?? null;

    case "stable":
      return resolveStableVersion(sorted, stableDelayDays, options.signal);

    case "security":
      return resolveSecurityVersion(sorted, options.signal);
  }
}

// ── Channel Resolvers ─────────────────────────────────────────────────────

/**
 * Stable channel: latest tag whose release was published >= stableDelayDays ago.
 *
 * Falls back to GitHub Releases API to check publish dates.
 * If API is unreachable, uses the second-newest tag as a conservative fallback.
 */
async function resolveStableVersion(
  sortedTags: readonly string[],
  stableDelayDays: number,
  signal?: AbortSignal,
): Promise<string | null> {
  if (sortedTags.length === 0) return null;

  const cutoff = Date.now() - stableDelayDays * 24 * 60 * 60 * 1000;

  // Try GitHub Releases API for publish dates
  try {
    const url = `${GITHUB_API_BASE}/repos/${OPENCLAW_GITHUB_REPO}/releases?per_page=20`;
    const response = await fetch(url, {
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "ClawHQ-Updater/1.0",
      },
      signal: signal ?? AbortSignal.timeout(10_000),
    });

    if (response.ok) {
      const releases = (await response.json()) as readonly {
        readonly tag_name: string;
        readonly published_at: string;
      }[];

      // Find newest release that's old enough
      for (const release of releases) {
        const publishedAt = new Date(release.published_at).getTime();
        if (publishedAt <= cutoff && sortedTags.includes(release.tag_name)) {
          return release.tag_name;
        }
      }

      // All releases are too new — no stable version available
      return null;
    }
  } catch {
    // API unreachable — fall through to conservative fallback
  }

  // Fallback: skip the newest tag, return second-newest (conservative)
  return sortedTags.length >= 2 ? sortedTags[1] : null;
}

/**
 * Security channel: only versions whose release notes mention CVE/security.
 *
 * Falls back to the latest tag if the API is unreachable (conservative —
 * we'd rather update than miss a security patch).
 */
async function resolveSecurityVersion(
  sortedTags: readonly string[],
  signal?: AbortSignal,
): Promise<string | null> {
  if (sortedTags.length === 0) return null;

  const securityPattern = /\b(CVE-\d{4}-\d+|security|vulnerab)/i;

  try {
    const url = `${GITHUB_API_BASE}/repos/${OPENCLAW_GITHUB_REPO}/releases?per_page=20`;
    const response = await fetch(url, {
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "ClawHQ-Updater/1.0",
      },
      signal: signal ?? AbortSignal.timeout(10_000),
    });

    if (response.ok) {
      const releases = (await response.json()) as readonly {
        readonly tag_name: string;
        readonly body?: string;
        readonly name?: string;
      }[];

      // Find newest release that mentions security
      for (const release of releases) {
        const text = `${release.name ?? ""} ${release.body ?? ""}`;
        if (securityPattern.test(text) && sortedTags.includes(release.tag_name)) {
          return release.tag_name;
        }
      }

      // No security releases found
      return null;
    }
  } catch {
    // API unreachable — fall through to conservative fallback
  }

  // Fallback: return latest (don't skip security patches because API is down)
  return sortedTags[0] ?? null;
}
