/**
 * Canonical .env merge + credential-protection logic.
 *
 * Replaces two parallel implementations that had drifted: the one in
 * `src/design/configure/writer.ts` (bundle writer) and the one in
 * `src/evolve/apply/index.ts` (apply pipeline). A single source of truth
 * keeps them from diverging again.
 *
 * Scope note: this parser is line-based and deliberately does NOT handle
 * multi-line quoted values. No code in ClawHQ produces such values — the
 * compiler, wizard, and integration pipelines all emit single-line
 * entries. CRLF input is normalized to LF so existing files edited on
 * Windows don't trip the orphan-append branch.
 */

/** Placeholder value the compiler emits for unfilled credentials. */
export const ENV_PLACEHOLDER = "CHANGE_ME";

export interface EnvLine {
  /** The raw text as it should round-trip back out, minus the trailing LF. */
  readonly raw: string;
  /** Set only for KEY=VALUE entries. */
  readonly key?: string;
  /** The parsed (unquoted, un-commented) value. */
  readonly value?: string;
}

export function parseEnvLines(content: string): EnvLine[] {
  // Normalize CRLF to LF so Windows-edited files round-trip cleanly.
  const text = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const out: EnvLine[] = [];
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      out.push({ raw });
      continue;
    }
    const eq = raw.indexOf("=");
    if (eq < 1) {
      out.push({ raw });
      continue;
    }
    const key = raw.slice(0, eq).trim();
    const value = parseEnvValue(raw.slice(eq + 1));
    out.push({ raw, key, value });
  }
  // split() on a terminated input produces a trailing empty element that
  // round-trips as an empty line; callers join with "\n" so this is fine,
  // but strip the synthetic trailing empty to keep the EnvLine list clean.
  if (out.length > 0 && out[out.length - 1]!.raw === "") out.pop();
  return out;
}

/**
 * Parse a raw value: strip surrounding quotes (respecting escapes) and any
 * trailing inline comment that begins with whitespace-then-`#`.
 */
function parseEnvValue(raw: string): string {
  const first = raw.charAt(0);
  if ((first === '"' || first === "'") && raw.length >= 2) {
    let i = 1;
    while (i < raw.length) {
      if (raw[i] === "\\" && i + 1 < raw.length) {
        i += 2;
        continue;
      }
      if (raw[i] === first) {
        return raw.slice(1, i).replace(/\\(.)/g, "$1");
      }
      i++;
    }
    return raw.slice(1);
  }
  const commentIdx = raw.search(/\s#/);
  if (commentIdx !== -1) return raw.slice(0, commentIdx).trimEnd();
  return raw;
}

/** Map of KEY → parsed value. Duplicates resolve to the last occurrence. */
export function parseEnvFile(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of parseEnvLines(content)) {
    if (line.key !== undefined && line.value !== undefined) {
      map.set(line.key, line.value);
    }
  }
  return map;
}

// ── Merge ────────────────────────────────────────────────────────────────────

/**
 * Merge a generated .env with the existing on-disk .env, preserving real
 * credentials and keys the user has added out of band.
 *
 * Rules (same as the old writer mergeEnv, but multi-line-safe):
 *   - Structure (comments, blank lines, ordering) comes from `generated`.
 *   - For every KEY present in both:
 *       - if existing has a real value and generated has CHANGE_ME → keep existing.
 *       - otherwise → use generated.
 *   - Keys that exist on disk but not in the generated template, where the
 *     on-disk value is real, get appended in a `# Preserved` block.
 */
export function mergeEnv(existing: string, generated: string): string {
  if (!existing) return generated;

  const existingLines = parseEnvLines(existing);
  const existingValues = new Map<string, string>();
  const existingRaw = new Map<string, string>();
  for (const line of existingLines) {
    if (line.key !== undefined && line.value !== undefined) {
      existingValues.set(line.key, line.value);
      existingRaw.set(line.key, line.raw);
    }
  }

  const generatedLines = parseEnvLines(generated);
  const generatedKeys = new Set<string>();
  const out: string[] = [];

  for (const line of generatedLines) {
    if (line.key === undefined) {
      out.push(line.raw);
      continue;
    }
    generatedKeys.add(line.key);
    const existingVal = existingValues.get(line.key);
    if (
      existingVal !== undefined &&
      existingVal !== ENV_PLACEHOLDER &&
      line.value === ENV_PLACEHOLDER
    ) {
      // Preserve the existing value by re-using the existing raw representation.
      out.push(existingRaw.get(line.key) ?? line.raw);
    } else {
      out.push(line.raw);
    }
  }

  // Collect preserved orphans (keys on disk but not in the generated template).
  const orphaned: string[] = [];
  for (const line of existingLines) {
    if (
      line.key !== undefined &&
      line.value !== undefined &&
      line.value !== ENV_PLACEHOLDER &&
      !generatedKeys.has(line.key)
    ) {
      orphaned.push(line.raw);
    }
  }

  if (orphaned.length > 0) {
    // Ensure exactly one blank line between generated content and preserved.
    // CRLF was normalized to LF by parseEnvLines, so the trim here is simple.
    while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
    out.push("", "# Preserved from previous configuration", ...orphaned);
  }

  return out.join("\n") + "\n";
}

// ── Credential protection ────────────────────────────────────────────────────

/**
 * Replace generated non-placeholder values with CHANGE_ME for keys where the
 * existing .env already holds a real value. This makes the writer's `mergeEnv`
 * preserve the existing value on disk.
 *
 * Typical use: the compiler emits a fresh random token for
 * `OPENCLAW_GATEWAY_TOKEN`, but apply should not rotate it every run.
 * Protect-then-merge turns the fresh token into a placeholder, and the
 * existing token survives into the merged output.
 */
export function protectCredentials(
  generated: string,
  existingEnv: Record<string, string>,
): string {
  const parsed = parseEnvLines(generated);
  const out: string[] = [];
  for (const line of parsed) {
    if (
      line.key !== undefined &&
      line.value !== undefined &&
      existingEnv[line.key] !== undefined &&
      line.value !== ENV_PLACEHOLDER
    ) {
      out.push(`${line.key}=${ENV_PLACEHOLDER}`);
    } else {
      out.push(line.raw);
    }
  }
  return out.join("\n");
}
