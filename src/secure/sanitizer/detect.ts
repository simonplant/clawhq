/**
 * Threat detection engine. Analyzes untrusted text against all known
 * prompt injection, obfuscation, and exfiltration patterns.
 */

import {
  CONFUSABLE_MAP,
  DECODE_KEYWORDS,
  DELIMITER_PATTERNS,
  ENCODING_PATTERNS,
  EXFIL_INSTRUCTIONS,
  EXFIL_PATTERNS,
  FEWSHOT_PATTERNS,
  INJECTION_PATTERNS,
  INVISIBLE_RANGES,
  MORSE_PATTERN,
  MULTILINGUAL_INJECTION,
} from "./patterns.js";

// ── Types ───────────────────────────────────────────────────────────────────

export type ThreatCategory =
  | "invisible_unicode"
  | "injection_keyword"
  | "delimiter_spoof"
  | "encoded_payload"
  | "decode_instruction"
  | "exfil_markup"
  | "homoglyph"
  | "obfuscated_injection"
  | "morse_encoding"
  | "fewshot_spoof"
  | "multilingual_injection"
  | "exfil_instruction";

export type ThreatSeverity = "high" | "medium" | "low";

export interface Threat {
  readonly category: ThreatCategory;
  readonly tier: 1 | 2;
  readonly detail: string;
  readonly span: readonly [start: number, end: number];
  readonly severity: ThreatSeverity;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function threat(
  category: ThreatCategory,
  tier: 1 | 2,
  detail: string,
  span: readonly [number, number] = [0, 0],
  severity: ThreatSeverity = "medium",
): Threat {
  return { category, tier, detail, span, severity };
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

export function normalizeConfusables(text: string): NormalizeResult {
  let hadConfusables = false;
  const chars: string[] = [];
  for (const ch of text) {
    const replacement = CONFUSABLE_MAP.get(ch);
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

  // Tier 1: Invisible unicode
  for (const m of matchAll(INVISIBLE_RANGES, text)) {
    threats.push(
      threat(
        "invisible_unicode",
        1,
        `Invisible chars: ${codepoints(m[0])}`,
        [m.index, m.index + m[0].length],
        "high",
      ),
    );
  }

  // Tier 1: Direct injection keywords
  for (const pat of INJECTION_PATTERNS) {
    for (const m of matchAll(pat, text)) {
      threats.push(
        threat(
          "injection_keyword",
          1,
          `Prompt override: "${m[0].slice(0, 60)}"`,
          [m.index, m.index + m[0].length],
          "high",
        ),
      );
    }
  }

  // Tier 1: Delimiter spoofing
  for (const pat of DELIMITER_PATTERNS) {
    for (const m of matchAll(pat, text)) {
      threats.push(
        threat(
          "delimiter_spoof",
          1,
          `Fake delimiter: "${m[0].slice(0, 40)}"`,
          [m.index, m.index + m[0].length],
          "high",
        ),
      );
    }
  }

  // Tier 1: Encoded payloads
  const hasDecodeKeyword = DECODE_KEYWORDS.test(text);
  for (const { pattern, type } of ENCODING_PATTERNS) {
    for (const m of matchAll(pattern, text)) {
      if (hasDecodeKeyword || m[0].length > 40) {
        threats.push(
          threat(
            "encoded_payload",
            1,
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
      threat("decode_instruction", 1, "Decode instruction for encoded content", [0, 0], "high"),
    );
  }

  // Tier 1: Exfiltration markup
  for (const pat of EXFIL_PATTERNS) {
    for (const m of matchAll(pat, text)) {
      threats.push(
        threat(
          "exfil_markup",
          1,
          `Exfil markup: "${m[0].slice(0, 60)}"`,
          [m.index, m.index + m[0].length],
          "high",
        ),
      );
    }
  }

  // Tier 2: Homoglyph obfuscation
  const normalized = normalizeConfusables(text);
  if (normalized.hadConfusables) {
    threats.push(threat("homoglyph", 2, "Lookalike chars from other scripts", [0, 0], "medium"));
    for (const pat of INJECTION_PATTERNS) {
      for (const m of matchAll(pat, normalized.text)) {
        threats.push(
          threat(
            "obfuscated_injection",
            2,
            `Post-normalization: "${m[0].slice(0, 60)}"`,
            [m.index, m.index + m[0].length],
            "high",
          ),
        );
      }
    }
  }

  // Tier 2: Morse encoding
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 20 && MORSE_PATTERN.test(trimmed)) {
      threats.push(
        threat("morse_encoding", 2, `Morse content (${trimmed.length} chars)`, [0, 0], "medium"),
      );
    }
  }

  // Tier 2: Few-shot conversation spoofing
  const userTurns = matchAll(FEWSHOT_PATTERNS.user, text).length;
  const assistantTurns = matchAll(FEWSHOT_PATTERNS.assistant, text).length;
  if (userTurns >= 2 && assistantTurns >= 1) {
    threats.push(
      threat(
        "fewshot_spoof",
        2,
        `Conversation spoofing (${userTurns}u + ${assistantTurns}a turns)`,
        [0, 0],
        "medium",
      ),
    );
  }

  // Tier 2: Multilingual injection
  for (const pat of MULTILINGUAL_INJECTION) {
    for (const m of matchAll(pat, text)) {
      threats.push(
        threat(
          "multilingual_injection",
          2,
          `Non-English injection: "${m[0].slice(0, 60)}"`,
          [m.index, m.index + m[0].length],
          "high",
        ),
      );
    }
  }

  // Tier 2: Exfiltration instructions
  for (const pat of EXFIL_INSTRUCTIONS) {
    for (const m of matchAll(pat, text)) {
      threats.push(
        threat(
          "exfil_instruction",
          2,
          `Exfil instruction: "${m[0].slice(0, 60)}"`,
          [m.index, m.index + m[0].length],
          "medium",
        ),
      );
    }
  }

  return threats;
}
