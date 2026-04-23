/**
 * Return `Object.entries(obj)` sorted by key.
 *
 * Used at compile boundaries where output lands on disk (.env sections,
 * cron/jobs.json, openclaw.json channels, docker-compose environment)
 * so two compiles of identical input produce byte-equal output regardless
 * of the source object's insertion order.
 */
export function sortedEntries<T>(
  obj: Record<string, T> | undefined | null,
): Array<[string, T]> {
  if (!obj) return [];
  return Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
