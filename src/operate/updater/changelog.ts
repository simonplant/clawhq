/**
 * Changelog display — fetch and format release notes between versions.
 *
 * Highlights breaking changes by scanning for common markers in release bodies.
 */

import type { ChangelogEntry, ChangelogResult } from "./types.js";
import { UpdateError } from "./types.js";

const DEFAULT_REPO = "openclaw/openclaw";

const BREAKING_MARKERS = [
  /breaking\s*change/i,
  /\bBREAKING\b/,
  /⚠️/,
  /\b(removed|dropped|renamed|incompatible)\b/i,
];

/**
 * Detect whether a release body contains breaking change indicators.
 */
export function hasBreakingChanges(body: string): boolean {
  return BREAKING_MARKERS.some((pattern) => pattern.test(body));
}

/**
 * Fetch changelog entries between current tag and latest.
 * Returns entries newest-first.
 */
export async function fetchChangelog(
  currentTag: string,
  options: { repo?: string; signal?: AbortSignal } = {},
): Promise<ChangelogResult> {
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
    body?: string;
  }>;

  const entries: ChangelogEntry[] = [];

  for (const r of releases) {
    const tag = r.tag_name ?? "";
    if (!tag) continue;
    if (tag === currentTag) break;

    const body = r.body ?? "";
    entries.push({
      tag,
      version: tag.replace(/^v/, ""),
      date: r.published_at ?? "",
      body,
      breaking: hasBreakingChanges(body),
    });
  }

  return {
    entries,
    hasBreaking: entries.some((e) => e.breaking),
  };
}

/**
 * Format changelog entries for terminal display.
 */
export function formatChangelog(result: ChangelogResult): string {
  if (result.entries.length === 0) {
    return "No changelog entries found.";
  }

  const lines: string[] = [];

  if (result.hasBreaking) {
    lines.push("WARNING: This update contains breaking changes!");
    lines.push("");
  }

  for (const entry of result.entries) {
    const breakingLabel = entry.breaking ? " [BREAKING]" : "";
    const date = entry.date ? ` (${entry.date.split("T")[0]})` : "";
    lines.push(`--- ${entry.tag}${date}${breakingLabel} ---`);

    if (entry.body.trim()) {
      lines.push(entry.body.trim());
    } else {
      lines.push("(no release notes)");
    }

    lines.push("");
  }

  return lines.join("\n");
}
