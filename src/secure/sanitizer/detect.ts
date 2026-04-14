/**
 * Threat detection engine. Analyzes untrusted text for deterministic
 * prompt injection, encoding tricks, and exfiltration patterns.
 *
 * Tier 1 only: catches invisible unicode, delimiter spoofing, encoded payloads,
 * exfil markup, and secret leaks. For adversarial prompt injection
 * (semantic override, social engineering), use model-based detection.
 */

import {
  CONFUSABLE_MAP,
  DECODE_KEYWORDS,
  DELIMITER_PATTERNS,
  ENCODING_PATTERNS,
  EXTENDED_CONFUSABLE_MAP,
  EXFIL_INSTRUCTIONS,
  EXFIL_PATTERNS,
  INJECTION_PATTERNS,
  INVISIBLE_RANGES,
  SECRET_PATTERNS,
} from "./patterns.js";

// ── Types ───────────────────────────────────────────────────────────────────

export type ThreatCategory =
  | "invisible_unicode"
  | "injection_keyword"
  | "delimiter_spoof"
  | "encoded_payload"
  | "decode_instruction"
  | "exfil_markup"
  | "exfil_instruction"
  | "secret_leak";

export type ThreatSeverity = "high" | "medium" | "low";

export interface Threat {
  readonly category: ThreatCategory;
  readonly tier: 1;
  readonly detail: string;
  readonly span: readonly [start: number, end: number];
  readonly severity: ThreatSeverity;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function threat(
  category: ThreatCategory,
  detail: string,
  span: readonly [number, number] = [0, 0],
  severity: ThreatSeverity = "medium",
): Threat {
  return { category, tier: 1, detail, span, severity };
}

function codepoints(match: string, max = 5): string {
  return [...match]
    .slice(0, max)
    .map((c) => `U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`)
    .join(", ");
}

function matchAll(pattern: RegExp, text: string): RegExpExecArray[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const re = new RegExp(pattern.source, flags);
  const results: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    results.push(m);
    if (m[0].length === 0) re.lastIndex++;
  }
  return results;
}

// ── Confusable Normalization ────────────────────────────────────────────────

export interface NormalizeResult {
  readonly text: string;
  readonly hadConfusables: boolean;
}

/** Normalize confusable Unicode characters to ASCII equivalents. */
export function normalizeConfusables(text: string): NormalizeResult {
  let hadConfusables = false;
  const chars: string[] = [];
  for (const ch of text) {
    const replacement = CONFUSABLE_MAP.get(ch) ?? EXTENDED_CONFUSABLE_MAP.get(ch);
    if (replacement !== undefined) {
      chars.push(replacement);
      hadConfusables = true;
    } else {
      chars.push(ch);
    }
  }
  return { text: chars.join(""), hadConfusables };
}

// ── Detection Engine ────────────────────────────────────────────────────────

export function detectThreats(text: string): Threat[] {
  const threats: Threat[] = [];

  // Invisible unicode
  for (const m of matchAll(INVISIBLE_RANGES, text)) {
    threats.push(
      threat(
        "invisible_unicode",
        `Invisible chars: ${codepoints(m[0])}`,
        [m.index, m.index + m[0].length],
        "high",
      ),
    );
  }

  // Direct injection keywords
  for (const pat of INJECTION_PATTERNS) {
    for (const m of matchAll(pat, text)) {
      threats.push(
        threat(
          "injection_keyword",
          `Prompt override: "${m[0].slice(0, 60)}"`,
          [m.index, m.index + m[0].length],
          "high",
        ),
      );
    }
  }

  // Also check after confusable normalization (catches Cyrillic/fullwidth obfuscation)
  const normalized = normalizeConfusables(text);
  if (normalized.hadConfusables) {
    for (const pat of INJECTION_PATTERNS) {
      for (const m of matchAll(pat, normalized.text)) {
        threats.push(
          threat(
            "injection_keyword",
            `Post-normalization: "${m[0].slice(0, 60)}"`,
            [m.index, m.index + m[0].length],
            "high",
          ),
        );
      }
    }
  }

  // Delimiter spoofing
  for (const pat of DELIMITER_PATTERNS) {
    for (const m of matchAll(pat, text)) {
      threats.push(
        threat(
          "delimiter_spoof",
          `Fake delimiter: "${m[0].slice(0, 40)}"`,
          [m.index, m.index + m[0].length],
          "high",
        ),
      );
    }
  }

  // Encoded payloads
  const hasDecodeKeyword = DECODE_KEYWORDS.test(text);
  for (const { pattern, type } of ENCODING_PATTERNS) {
    for (const m of matchAll(pattern, text)) {
      if (hasDecodeKeyword || m[0].length > 40) {
        threats.push(
          threat(
            "encoded_payload",
            `${type} (${m[0].length} chars)`,
            [m.index, m.index + m[0].length],
            hasDecodeKeyword ? "high" : "medium",
          ),
        );
      }
    }
  }
  if (hasDecodeKeyword) {
    threats.push(
      threat("decode_instruction", "Decode instruction for encoded content", [0, 0], "high"),
    );
  }

  // Exfiltration markup
  for (const pat of EXFIL_PATTERNS) {
    for (const m of matchAll(pat, text)) {
      threats.push(
        threat(
          "exfil_markup",
          `Exfil markup: "${m[0].slice(0, 60)}"`,
          [m.index, m.index + m[0].length],
          "high",
        ),
      );
    }
  }

  // Exfiltration instructions
  for (const pat of EXFIL_INSTRUCTIONS) {
    for (const m of matchAll(pat, text)) {
      threats.push(
        threat(
          "exfil_instruction",
          `Exfil instruction: "${m[0].slice(0, 60)}"`,
          [m.index, m.index + m[0].length],
          "medium",
        ),
      );
    }
  }

  // Secret leak detection
  for (const { pattern, type } of SECRET_PATTERNS) {
    for (const m of matchAll(pattern, text)) {
      threats.push(
        threat(
          "secret_leak",
          `Secret detected: ${type}`,
          [m.index, m.index + m[0].length],
          "high",
        ),
      );
    }
  }

  return threats;
}
