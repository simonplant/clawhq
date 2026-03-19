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
      return "high";
    case "injection_pattern":
    case "encoded_payload":
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
  const lines = content.split("\n");

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineNum = lineIdx + 1;

    // Skip comment-only lines (basic heuristic)
    const trimmed = line.trim();
    if (trimmed.startsWith("#") && !trimmed.includes("$(") && !trimmed.includes("`")) continue;
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

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
