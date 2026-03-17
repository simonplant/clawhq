/**
 * Upstream version check — fetch latest OpenClaw release tag from GitHub.
 *
 * Uses GitHub Releases API (unauthenticated, rate-limited to 60 req/hr).
 * Falls back gracefully if network is unavailable.
 */

import { notifyUpdateAvailable } from "../notifications/hooks.js";

import type { ReleaseInfo, VersionCheckResult } from "./types.js";
import { UpdateError } from "./types.js";

const DEFAULT_REPO = "openclaw/openclaw";

/**
 * Fetch the latest release from GitHub Releases API.
 */
export async function fetchLatestRelease(
  options: { repo?: string; signal?: AbortSignal } = {},
): Promise<ReleaseInfo> {
  const repo = options.repo ?? DEFAULT_REPO;
  const url = `https://api.github.com/repos/${repo}/releases/latest`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
      signal: options.signal,
    });
  } catch (err: unknown) {
    throw new UpdateError(
      `Cannot reach GitHub API: ${err instanceof Error ? err.message : String(err)}`,
      "NETWORK_ERROR",
      { repo },
    );
  }

  if (response.status === 404) {
    throw new UpdateError(
      `No releases found for ${repo}`,
      "NO_RELEASES",
      { repo },
    );
  }

  if (response.status === 403) {
    throw new UpdateError(
      "GitHub API rate limit exceeded. Try again later or provide a token.",
      "RATE_LIMITED",
      { repo },
    );
  }

  if (!response.ok) {
    throw new UpdateError(
      `GitHub API error: ${response.status} ${response.statusText}`,
      "API_ERROR",
      { repo, status: response.status },
    );
  }

  const data = (await response.json()) as {
    tag_name?: string;
    published_at?: string;
    html_url?: string;
  };

  const tag = data.tag_name ?? "";
  if (!tag) {
    throw new UpdateError(
      "Latest release has no tag",
      "INVALID_RELEASE",
      { repo },
    );
  }

  return {
    tag,
    version: tag.replace(/^v/, ""),
    publishedAt: data.published_at ?? "",
    url: data.html_url ?? "",
  };
}

/**
 * Fetch releases between two tags (for changelog).
 * Returns releases newest-first, excluding `sinceTag` itself.
 */
export async function fetchReleasesSince(
  sinceTag: string,
  options: { repo?: string; signal?: AbortSignal } = {},
): Promise<ReleaseInfo[]> {
  const repo = options.repo ?? DEFAULT_REPO;
  const url = `https://api.github.com/repos/${repo}/releases?per_page=50`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
      signal: options.signal,
    });
  } catch (err: unknown) {
    throw new UpdateError(
      `Cannot reach GitHub API: ${err instanceof Error ? err.message : String(err)}`,
      "NETWORK_ERROR",
      { repo },
    );
  }

  if (!response.ok) {
    throw new UpdateError(
      `GitHub API error: ${response.status} ${response.statusText}`,
      "API_ERROR",
      { repo, status: response.status },
    );
  }

  const releases = (await response.json()) as Array<{
    tag_name?: string;
    published_at?: string;
    html_url?: string;
    body?: string;
  }>;

  const result: ReleaseInfo[] = [];

  for (const r of releases) {
    const tag = r.tag_name ?? "";
    if (!tag) continue;
    if (tag === sinceTag) break;
    result.push({
      tag,
      version: tag.replace(/^v/, ""),
      publishedAt: r.published_at ?? "",
      url: r.html_url ?? "",
    });
  }

  return result;
}

/**
 * Compare current version against latest release.
 */
export async function checkForUpdate(
  currentTag: string,
  options: { repo?: string; signal?: AbortSignal } = {},
): Promise<VersionCheckResult> {
  const latest = await fetchLatestRelease(options);

  const result: VersionCheckResult = {
    current: currentTag,
    latest,
    updateAvailable: latest.tag !== currentTag,
  };

  if (result.updateAvailable) {
    void notifyUpdateAvailable(currentTag, latest);
  }

  return result;
}
