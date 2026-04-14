/**
 * Security vetting engine for skills.
 *
 * Scans skill source code for obvious risks:
 * - Outbound HTTP: hardcoded URLs, curl/wget/fetch, HTTP libraries
 * - Shell execution: subprocess spawning, eval, exec
 * - File escape: path traversal, absolute paths outside workspace
 *
 * All findings are advisory — the real defense is the approval gate
 * and egress firewall. Regex can't catch obfuscated malware.
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

    if (heredocDelim !== null) {
      if (i === 0 || content[i - 1] === "\n") {
        const lineEnd = content.indexOf("\n", i);
        const line = content.slice(i, lineEnd === -1 ? len : lineEnd).trim();
        if (line === heredocDelim) heredocDelim = null;
      }
      i++;
      continue;
    }

    if (inMultiComment) {
      if (c === "\n") { i++; continue; }
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

    if (inSingleQuote) {
      if (c === "'") inSingleQuote = false;
      else if (c === "\\" && lang !== "bash" && i + 1 < len) { i += 2; continue; }
      i++;
      continue;
    }

    if (inDoubleQuote) {
      if (c === '"') inDoubleQuote = false;
      else if (c === "\\" && i + 1 < len) { i += 2; continue; }
      i++;
      continue;
    }

    if (lang === "python" && i + 2 < len) {
      if (content[i] === '"' && content[i + 1] === '"' && content[i + 2] === '"') {
        inTripleDouble = true; i += 3; continue;
      }
      if (content[i] === "'" && content[i + 1] === "'" && content[i + 2] === "'") {
        inTripleSingle = true; i += 3; continue;
      }
    }

    if (lang === "javascript" && c === "`") {
      i++;
      while (i < len && content[i] !== "`") {
        if (content[i] === "\\") i++;
        i++;
      }
      if (i < len) i++;
      continue;
    }

    if (c === '"') { inDoubleQuote = true; i++; continue; }
    if (c === "'") { inSingleQuote = true; i++; continue; }

    if (lang === "javascript" && c === "/" && i + 1 < len && content[i + 1] === "*") {
      out[i] = " "; out[i + 1] = " ";
      inMultiComment = true; i += 2; continue;
    }
    if (lang === "javascript" && c === "/" && i + 1 < len && content[i + 1] === "/") {
      blankToEol(); continue;
    }
    if ((lang === "bash" || lang === "python") && c === "#") {
      blankToEol(); continue;
    }

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

// ── Outbound HTTP Patterns ──────────────────────────────────────────────────

const HTTP_PATTERNS: Array<{ pattern: RegExp; detail: string }> = [
  { pattern: /https?:\/\/[^\s"'`)}\]>]+/gi, detail: "Hardcoded URL" },
  { pattern: /\b(curl|wget|fetch)\s+/gi, detail: "HTTP client invocation" },
  { pattern: /\b(requests\.(get|post|put|delete|patch|head)|urllib\.request|httpx\.|aiohttp\.)/gi, detail: "Python HTTP library" },
  { pattern: /\b(https?\.(?:get|request)|node-fetch|axios\.|got\(|undici\.)/gi, detail: "Node.js HTTP library" },
  { pattern: /\b(nc|ncat|netcat|socat|telnet)\s+/gi, detail: "Network utility" },
];

const SAFE_DOMAIN_PATTERNS: RegExp[] = [
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i,
  /^https?:\/\/example\.(com|org|net)/i,
  /^https?:\/\/github\.com\/simonplant/i,
];

// ── Shell Execution Patterns ─────────────────────────────────────────────────

const SHELL_EXEC_PATTERNS: Array<{ pattern: RegExp; detail: string }> = [
  { pattern: /\b(eval|exec)\s/gi, detail: "Dynamic code execution" },
  { pattern: /\bchild_process\b/gi, detail: "Node.js subprocess spawning" },
  { pattern: /\b(subprocess|os\.system|os\.popen|Popen)\s*\(/gi, detail: "Python subprocess spawning" },
  { pattern: /\$\(.*\)|`[^`]*`/g, detail: "Command substitution" },
];

// ── File Escape Patterns ────────────────────────────────────────────────────

const FILE_ESCAPE_PATTERNS: Array<{ pattern: RegExp; detail: string }> = [
  { pattern: /\/(etc|root|home|var|tmp|proc|sys|dev)\//gi, detail: "Absolute path outside workspace" },
  { pattern: /\.\.\//g, detail: "Parent directory traversal" },
  { pattern: /\b(chmod|chown|chgrp)\s+/gi, detail: "Permission modification" },
];

// ── Vetting Engine ───────────────────────────────────────────────────────────

function isSafeUrl(url: string): boolean {
  return SAFE_DOMAIN_PATTERNS.some((pat) => pat.test(url));
}

function severityForCategory(category: VetFindingCategory): VetSeverity {
  switch (category) {
    case "outbound_http":
      return "high";
    case "shell_execution":
      return "high";
    case "file_escape":
      return "high";
  }
}

function scanFile(file: string, content: string): VetFinding[] {
  const findings: VetFinding[] = [];
  const stripped = stripComments(content, file);
  const lines = stripped.split("\n");

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineNum = lineIdx + 1;
    if (line.trim() === "") continue;

    // Outbound HTTP detection
    // Check if any URL on this line is safe (localhost, example.com, etc.)
    const urlRe = /https?:\/\/[^\s"'`)}\]>]+/gi;
    const urlsOnLine: string[] = [];
    let urlMatch: RegExpExecArray | null;
    while ((urlMatch = urlRe.exec(line)) !== null) urlsOnLine.push(urlMatch[0]);
    const allUrlsSafe = urlsOnLine.length > 0 && urlsOnLine.every(isSafeUrl);

    for (const { pattern, detail } of HTTP_PATTERNS) {
      const re = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
        // Skip safe URLs
        if (pattern.source.startsWith("https?") && isSafeUrl(match[0])) continue;
        // Skip HTTP client commands when all URLs on the line are safe (e.g. curl http://localhost:...)
        if (!pattern.source.startsWith("https?") && allUrlsSafe) continue;
        findings.push({
          category: "outbound_http",
          severity: severityForCategory("outbound_http"),
          file,
          line: lineNum,
          detail,
          matched: match[0].slice(0, 80),
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

    // File escape detection
    for (const { pattern, detail } of FILE_ESCAPE_PATTERNS) {
      const re = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
        findings.push({
          category: "file_escape",
          severity: severityForCategory("file_escape"),
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
 * Vet a skill by scanning all its source files for obvious security risks.
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
