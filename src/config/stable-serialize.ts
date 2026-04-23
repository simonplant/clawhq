/**
 * Deterministic serialization helpers.
 *
 * `Object.entries` iteration order on string keys follows insertion order in
 * modern JS engines. That's fine for code that builds objects in a fixed
 * order, but is a correctness hazard for code that serializes user-provided
 * or disk-loaded objects — two runs that produce a logically identical
 * object can emit byte-different artifacts if the source keys arrived in a
 * different order. `clawhq apply` then sees spurious diffs, `clawhq build`
 * sees spurious cache invalidation, and image SHAs rotate on every run.
 *
 * Use these helpers at every compile boundary where output lands on disk:
 *   - env var maps in .env generation
 *   - cron job dictionaries in jobs.json
 *   - workspace manifest paths
 *   - docker-compose environment / networks / volumes
 *   - allowlist domain emission
 */

/**
 * Return `Object.entries(obj)` sorted by key. Callers that iterate over the
 * result emit their output in deterministic order regardless of insertion
 * order on the source.
 */
export function sortedEntries<T>(
  obj: Record<string, T> | undefined | null,
): Array<[string, T]> {
  if (!obj) return [];
  return Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Return sorted keys of `obj` — thin wrapper on sortedEntries for callers
 * that only need the key list.
 */
export function sortedKeys(obj: Record<string, unknown> | undefined | null): string[] {
  if (!obj) return [];
  return Object.keys(obj).sort();
}

/**
 * JSON.stringify variant that walks values recursively and sorts object
 * keys at every level. Arrays are left in their input order — order is
 * usually semantic for arrays (e.g. cron job list, ordered egress rules)
 * and sorting them silently would break behavior.
 *
 * Pass `indent` to pretty-print, matching `JSON.stringify`'s third argument.
 */
export function stableJsonStringify(value: unknown, indent?: number): string {
  const sortKeys = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(sortKeys);
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      out[k] = sortKeys(obj[k]);
    }
    return out;
  };
  return JSON.stringify(sortKeys(value), null, indent);
}
