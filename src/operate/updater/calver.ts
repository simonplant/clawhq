/**
 * CalVer version parsing and comparison.
 *
 * OpenClaw uses calendar-based versioning: vYYYY.M.PATCH (e.g. v2026.4.12).
 * Earlier releases used semver (v0.8.x) — both formats are handled by
 * treating all versions as dot-separated numeric segments.
 */

// ── Types ──────────────────────────────────────────────────────────────────

/** Parsed CalVer version. */
export interface CalVer {
  /** Major segment (year in CalVer, major in semver). */
  readonly year: number;
  /** Minor segment (month in CalVer, minor in semver). */
  readonly minor: number;
  /** Patch segment. */
  readonly patch: number;
  /** Original input string. */
  readonly raw: string;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Parse a version string into a CalVer object.
 *
 * Accepts: "v2026.4.12", "2026.4.12", "v0.8.7", "0.8.7"
 * Returns null on invalid input.
 */
export function parseCalVer(version: string): CalVer | null {
  const stripped = version.startsWith("v") ? version.slice(1) : version;
  const parts = stripped.split(".");
  if (parts.length < 2 || parts.length > 3) return null;

  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || !Number.isInteger(n))) {
    return null;
  }

  return {
    year: nums[0],
    minor: nums[1],
    patch: nums[2] ?? 0,
    raw: version,
  };
}

/**
 * Compare two CalVer versions.
 *
 * Returns negative if a < b, 0 if equal, positive if a > b.
 * Works with both CalVer (2026.4.12) and legacy semver (0.8.7).
 */
export function compareCalVer(a: CalVer, b: CalVer): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Compare two version strings directly.
 *
 * Convenience wrapper — parses both strings, compares numerically.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 * Falls back to segment-by-segment comparison if parsing fails.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseCalVer(a);
  const pb = parseCalVer(b);

  if (pa && pb) return compareCalVer(pa, pb);

  // Fallback: split on dots and compare numerically (handles arbitrary segment counts)
  const sa = a.replace(/^v/, "").split(".").map(Number);
  const sb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const na = sa[i] ?? 0;
    const nb = sb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * Check if a version falls within a range (exclusive lower, inclusive upper).
 *
 * Returns true when `from < version <= to`. Used by migration registry
 * to select applicable migrations.
 */
export function calVerInRange(version: CalVer, from: CalVer, to: CalVer): boolean {
  return compareCalVer(version, from) > 0 && compareCalVer(version, to) <= 0;
}

/**
 * Format a CalVer object back to "vYYYY.M.PATCH" string.
 */
export function formatCalVer(v: CalVer): string {
  return `v${v.year}.${v.minor}.${v.patch}`;
}

/**
 * Sort version strings from oldest to newest.
 *
 * Invalid version strings are placed at the end.
 */
export function sortVersions(versions: readonly string[]): string[] {
  return [...versions].sort((a, b) => compareVersions(a, b));
}
