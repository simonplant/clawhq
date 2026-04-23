/**
 * Canonical .env merge + credential-protection logic.
 *
 * This replaces two parallel implementations that had drifted:
 *   1. `src/design/configure/writer.ts::mergeEnv` (used by the bundle writer).
 *   2. `src/evolve/apply/index.ts::protectCredentials` (used by apply).
 *
 * A single source of truth avoids the class of bug where a fix is made to one
 * path but not the other, and the writer and apply pipelines diverge on how
 * credentials are preserved. It also fixes:
 *
 *   - Multi-line quoted values (PEM keys, JSON tokens embedded as
 *     `KEY="{"a": \n "b"}"`). The previous line-based parsers corrupted them.
 *   - CRLF line endings. Existing files written on Windows or edited through
 *     tools that normalize to CRLF used to trip the orphan-append branch
 *     because `lastLine.trim()` saw `\r` instead of empty, so the preserved
 *     block got jammed onto the same line as a key.
 */

/** Placeholder value the compiler emits for unfilled credentials. */
export const ENV_PLACEHOLDER = "CHANGE_ME";

// ── Multi-line aware line grouping ───────────────────────────────────────────

/**
 * Group raw `.env` text into one logical "entry" per line-or-multiline-value.
 *
 * Walks the text character by character, tracking whether we're inside a
 * quoted value; newlines inside a quoted value keep accumulating instead of
 * terminating the line. This is what `.env` format actually means when a
 * PEM block is assigned to a variable.
 */
function normalizeLineEndings(content: string): string {
  // Strip CRLF to LF — we operate on LF internally. The writer appends LF on
  // emit so round-trip format is consistent.
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export interface EnvLine {
  /** The raw text as it should round-trip back out, minus the trailing LF. */
  readonly raw: string;
  /** Set only for KEY=VALUE entries. */
  readonly key?: string;
  /** The parsed (unquoted, un-commented) value. */
  readonly value?: string;
}

export function parseEnvLines(content: string): EnvLine[] {
  const text = normalizeLineEndings(content);
  const out: EnvLine[] = [];

  let i = 0;
  while (i < text.length) {
    // Find the end of this logical entry. In a quoted value, newlines are
    // part of the value and don't terminate.
    const startIdx = i;
    let inQuote: '"' | "'" | null = null;
    while (i < text.length) {
      const ch = text[i];
      if (inQuote) {
        if (ch === "\\" && i + 1 < text.length) {
          i += 2;
          continue;
        }
        if (ch === inQuote) {
          inQuote = null;
          i++;
          continue;
        }
        i++;
        continue;
      } else {
        if (ch === "\n") break;
        if (ch === '"' || ch === "'") {
          inQuote = ch;
          i++;
          continue;
        }
        i++;
      }
    }
    const raw = text.slice(startIdx, i);
    // Skip the newline itself so the next iteration starts at the next line.
    if (i < text.length && text[i] === "\n") i++;

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
