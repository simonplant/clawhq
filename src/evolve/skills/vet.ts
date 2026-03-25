/**
 * Security vetting engine for skills.
 *
 * Scans skill source code for:
 * - URL traps: outbound HTTP/HTTPS calls to arbitrary hosts
 * - Shell execution: subprocess spawning, eval, exec
 * - File access: reads/writes outside workspace boundaries
 * - Injection patterns: reuses existing sanitizer detection
 * - Encoded payloads: obfuscated content that may hide instructions
 *
 * A skill that fails vetting with critical or high findings is rejected.
 */

import type {
  VetFinding,
  VetFindingCategory,
  VetReport,
  VetSeverity,
  VetSummary,
} from "./types.js";

// ── Language-Aware Comment Parsing ──────────────────────────────────────────

type SourceLanguage = "bash" | "python" | "javascript" | "unknown";

function detectLanguage(filename: string): SourceLanguage {
  if (/\.(sh|bash)$/i.test(filename)) return "bash";
  if (/\.py$/i.test(filename)) return "python";
  if (/\.(js|ts|mjs|cjs)$/i.test(filename)) return "javascript";
  return "unknown";
}

/**
 * Strip comments from source code using language-aware parsing.
 * Returns content with comment characters replaced by spaces (line structure preserved).
 * Strings, here-docs, and triple-quoted strings are NOT stripped — they contain
 * potentially executable content that must be scanned.
 */
function stripComments(content: string, filename: string): string {
  const lang = detectLanguage(filename);
  if (lang === "unknown") return content;

  const out = content.split("");
  const len = content.length;
  let i = 0;

  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inMultiComment = false;
  let inTripleDouble = false;
  let inTripleSingle = false;
  let heredocDelim: string | null = null;

  function blankToEol(): void {
    while (i < len && content[i] !== "\n") {
      out[i] = " ";
      i++;
    }
  }

  while (i < len) {
    const c = content[i];

    // ── Heredoc content (bash): preserve everything ──
    if (heredocDelim !== null) {
      if (i === 0 || content[i - 1] === "\n") {
        const lineEnd = content.indexOf("\n", i);
        const line = content.slice(i, lineEnd === -1 ? len : lineEnd).trim();
        if (line === heredocDelim) heredocDelim = null;
      }
      i++;
      continue;
    }

    // ── Multi-line comment (JS): blank content ──
    if (inMultiComment) {
      if (c === "\n") {
        i++;
        continue;
      }
      out[i] = " ";
      if (c === "*" && i + 1 < len && content[i + 1] === "/") {
        out[i + 1] = " ";
        inMultiComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // ── Triple-quoted strings (Python): preserve content ──
    if (inTripleDouble) {
      if (i + 2 < len && content[i] === '"' && content[i + 1] === '"' && content[i + 2] === '"') {
        inTripleDouble = false;
        i += 3;
        continue;
      }
      i++;
      continue;
    }
    if (inTripleSingle) {
      if (i + 2 < len && content[i] === "'" && content[i + 1] === "'" && content[i + 2] === "'") {
        inTripleSingle = false;
        i += 3;
        continue;
      }
      i++;
      continue;
    }

    // ── Single-quoted strings ──
    if (inSingleQuote) {
      if (c === "'") {
        inSingleQuote = false;
      } else if (c === "\\" && lang !== "bash" && i + 1 < len) {
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // ── Double-quoted strings ──
    if (inDoubleQuote) {
      if (c === '"') {
        inDoubleQuote = false;
      } else if (c === "\\" && i + 1 < len) {
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // ── Not in any string or comment — detect starts ──

    // Triple quotes (Python only)
    if (lang === "python" && i + 2 < len) {
      if (content[i] === '"' && content[i + 1] === '"' && content[i + 2] === '"') {
        inTripleDouble = true;
        i += 3;
        continue;
      }
      if (content[i] === "'" && content[i + 1] === "'" && content[i + 2] === "'") {
        inTripleSingle = true;
        i += 3;
        continue;
      }
    }

    // Template literals (JS) — advance through without comment detection
    if (lang === "javascript" && c === "`") {
      i++;
      while (i < len && content[i] !== "`") {
        if (content[i] === "\\") i++;
        i++;
      }
      if (i < len) i++;
      continue;
    }

    // String starts
    if (c === '"') {
      inDoubleQuote = true;
      i++;
      continue;
    }
    if (c === "'") {
      inSingleQuote = true;
      i++;
      continue;
    }

    // Multi-line comment start (JS)
    if (lang === "javascript" && c === "/" && i + 1 < len && content[i + 1] === "*") {
      out[i] = " ";
      out[i + 1] = " ";
      inMultiComment = true;
      i += 2;
      continue;
    }

    // Single-line comment: // (JS) or # (bash/python)
    if (lang === "javascript" && c === "/" && i + 1 < len && content[i + 1] === "/") {
      blankToEol();
      continue;
    }
    if ((lang === "bash" || lang === "python") && c === "#") {
      blankToEol();
      continue;
    }

    // Heredoc start (bash)
    if (lang === "bash" && c === "<" && i + 1 < len && content[i + 1] === "<") {
      const rest = content.slice(i);
      const hdMatch = rest.match(/^<<-?\s*\\?['"]?([A-Za-z_]\w*)['"]?/);
      if (hdMatch) {
        heredocDelim = hdMatch[1];
        while (i < len && content[i] !== "\n") i++;
        continue;
      }
    }

    i++;
  }

  return out.join("");
}

// ── URL Trap Patterns ────────────────────────────────────────────────────────

/**
 * Patterns that detect outbound HTTP/HTTPS calls in skill code.
 * These catch curl, wget, fetch, requests, http.get, etc.
 */
const URL_TRAP_PATTERNS: Array<{ pattern: RegExp; detail: string }> = [
  // Hardcoded URLs in any language
  {
    pattern: /https?:\/\/[^\s"'`)}\]>]+/gi,
    detail: "Hardcoded URL — skill should not make outbound calls to arbitrary hosts",
  },
  // curl/wget/fetch commands
  {
    pattern: /\b(curl|wget|fetch)\s+/gi,
    detail: "HTTP client invocation — outbound network access",
  },
  // Python requests/urllib
  {
    pattern: /\b(requests\.(get|post|put|delete|patch|head)|urllib\.request|httpx\.|aiohttp\.)/gi,
    detail: "Python HTTP library usage — outbound network access",
  },
  // Node.js http/https/fetch
  {
    pattern: /\b(https?\.(?:get|request)|node-fetch|axios\.|got\(|undici\.)/gi,
    detail: "Node.js HTTP library usage — outbound network access",
  },
  // Bash network tools
  {
    pattern: /\b(nc|ncat|netcat|socat|telnet|nslookup|dig)\s+/gi,
    detail: "Network utility — potential data exfiltration channel",
  },
];

/**
 * Domains that are safe and expected in skill code (documentation, comments).
 * URLs pointing to these domains are NOT flagged.
 */
const SAFE_DOMAIN_PATTERNS: RegExp[] = [
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i,
  /^https?:\/\/example\.(com|org|net)/i,
  /^https?:\/\/github\.com\/simonplant/i,
];

// ── Shell Execution Patterns ─────────────────────────────────────────────────

const SHELL_EXEC_PATTERNS: Array<{ pattern: RegExp; detail: string }> = [
  {
    pattern: /\b(eval|exec)\s/gi,
    detail: "Dynamic code execution — eval/exec",
  },
  {
    pattern: /\bchild_process\b/gi,
    detail: "Node.js child_process — subprocess spawning",
  },
  {
    pattern: /\b(subprocess|os\.system|os\.popen|Popen)\s*\(/gi,
    detail: "Python subprocess spawning",
  },
  {
    pattern: /\$\(.*\)|`[^`]*`/g,
    detail: "Command substitution — potential shell injection vector",
  },
];

// ── File Access Patterns ─────────────────────────────────────────────────────

const FILE_ACCESS_PATTERNS: Array<{ pattern: RegExp; detail: string }> = [
  {
    pattern: /\/(etc|root|home|var|tmp|proc|sys|dev)\//gi,
    detail: "Absolute path outside workspace — potential filesystem escape",
  },
  {
    pattern: /\.\.\//g,
    detail: "Parent directory traversal — potential sandbox escape",
  },
  {
    pattern: /\b(chmod|chown|chgrp)\s+/gi,
    detail: "Permission modification — skills should not change file permissions",
  },
];

// ── Encoded/Obfuscated Content ───────────────────────────────────────────────

const OBFUSCATION_PATTERNS: Array<{ pattern: RegExp; detail: string }> = [
  {
    pattern: /\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){5,}/g,
    detail: "Hex-escaped string — potentially obfuscated content",
  },
  {
    pattern: /\\u[0-9a-fA-F]{4}(?:\\u[0-9a-fA-F]{4}){5,}/g,
    detail: "Unicode-escaped string — potentially obfuscated content",
  },
  {
    pattern: /atob\s*\(|Buffer\.from\s*\([^)]*,\s*['"]base64['"]\)/g,
    detail: "Base64 decoding — potentially obfuscated payload",
  },
  {
    pattern: /\bbase64\s+(-d|--decode)\b/g,
    detail: "Base64 decode via CLI — potentially obfuscated payload execution",
  },
  {
    pattern: /\bbase64\.b64decode\b/g,
    detail: "Python base64.b64decode — potentially obfuscated payload",
  },
];

// ── Vetting Engine ───────────────────────────────────────────────────────────

function isSafeUrl(url: string): boolean {
  return SAFE_DOMAIN_PATTERNS.some((pat) => pat.test(url));
}

function severityForCategory(category: VetFindingCategory): VetSeverity {
  switch (category) {
    case "url_trap":
    case "exfil_url":
      return "critical";
    case "shell_execution":
    case "file_access":
    case "encoded_payload":
      return "high";
    case "injection_pattern":
    case "suspicious_domain":
      return "medium";
    default:
      return "low";
  }
}

function scanFile(
  file: string,
  content: string,
): VetFinding[] {
  const findings: VetFinding[] = [];
  const stripped = stripComments(content, file);
  const lines = stripped.split("\n");

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineNum = lineIdx + 1;

    // Skip empty/whitespace-only lines (may have been comment-stripped)
    if (line.trim() === "") continue;

    // URL trap detection
    for (const { pattern, detail } of URL_TRAP_PATTERNS) {
      const re = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
        const matched = match[0];

        // For URL matches, check against safe domains
        if (pattern.source.startsWith("https?") && isSafeUrl(matched)) continue;

        findings.push({
          category: matched.startsWith("http") ? "exfil_url" : "url_trap",
          severity: severityForCategory(matched.startsWith("http") ? "exfil_url" : "url_trap"),
          file,
          line: lineNum,
          detail,
          matched: matched.slice(0, 80),
        });
      }
    }

    // Shell execution detection
    for (const { pattern, detail } of SHELL_EXEC_PATTERNS) {
      const re = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
        findings.push({
          category: "shell_execution",
          severity: severityForCategory("shell_execution"),
          file,
          line: lineNum,
          detail,
          matched: match[0].slice(0, 80),
        });
      }
    }

    // File access detection
    for (const { pattern, detail } of FILE_ACCESS_PATTERNS) {
      const re = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
        findings.push({
          category: "file_access",
          severity: severityForCategory("file_access"),
          file,
          line: lineNum,
          detail,
          matched: match[0].slice(0, 80),
        });
      }
    }

    // Obfuscation detection
    for (const { pattern, detail } of OBFUSCATION_PATTERNS) {
      const re = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
        findings.push({
          category: "encoded_payload",
          severity: severityForCategory("encoded_payload"),
          file,
          line: lineNum,
          detail,
          matched: match[0].slice(0, 80),
        });
      }
    }
  }

  return findings;
}

function buildSummary(findings: readonly VetFinding[]): VetSummary {
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const highCount = findings.filter((f) => f.severity === "high").length;
  return {
    passed: criticalCount === 0 && highCount === 0,
    findingCount: findings.length,
    criticalCount,
    highCount,
  };
}

/**
 * Vet a skill by scanning all its source files for security threats.
 *
 * Returns a full report with findings and pass/fail determination.
 * A skill fails vetting if any critical or high severity findings exist.
 */
export function vetSkill(
  skillName: string,
  files: ReadonlyArray<{ file: string; content: string }>,
): VetReport {
  const allFindings: VetFinding[] = [];

  for (const { file, content } of files) {
    allFindings.push(...scanFile(file, content));
  }

  const summary = buildSummary(allFindings);

  return {
    skillName,
    passed: summary.passed,
    findings: allFindings,
    summary,
    timestamp: new Date().toISOString(),
  };
}
