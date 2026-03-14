/**
 * PII and secret pattern scanner.
 *
 * Detects API keys, tokens, credentials, and PII embedded in workspace files.
 * Also detects dangerous filenames (.env, *.pem, *.key).
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type MatchType = "secret" | "pii" | "filename";

export interface SecretPattern {
  name: string;
  pattern: RegExp;
  type: MatchType;
}

export interface ScanMatch {
  file: string;
  pattern: string;
  line: number;
  type: MatchType;
  preview: string;
}

export interface ScanResult {
  matches: ScanMatch[];
  filesScanned: number;
}

/** Patterns that indicate embedded secrets. */
export const SECRET_PATTERNS: SecretPattern[] = [
  { name: "Anthropic API key", pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/, type: "secret" },
  { name: "OpenAI API key", pattern: /sk-[a-zA-Z0-9]{20,}/, type: "secret" },
  { name: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/, type: "secret" },
  { name: "GitHub token", pattern: /ghp_[a-zA-Z0-9]{36}/, type: "secret" },
  { name: "GitHub OAuth token", pattern: /gho_[a-zA-Z0-9]{36}/, type: "secret" },
  { name: "Bearer token", pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/, type: "secret" },
  {
    name: "Generic API key",
    pattern:
      /["'](?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token)["']\s*:\s*["'][^"']{8,}["']/,
    type: "secret",
  },
  { name: "Google API key", pattern: /AIza[0-9A-Za-z_-]{35}/, type: "secret" },
  { name: "Slack token", pattern: /xox[bpors]-[0-9a-zA-Z-]{10,}/, type: "secret" },
  { name: "Telegram bot token", pattern: /\d{8,10}:[a-zA-Z0-9_-]{35}/, type: "secret" },
  { name: "JWT", pattern: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/, type: "secret" },
  { name: "Private key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, type: "secret" },
];

/** PII patterns. */
export const PII_PATTERNS: SecretPattern[] = [
  {
    name: "Person name (structured field)",
    pattern: /["'](?:full[_-]?name|first[_-]?name|last[_-]?name|patient[_-]?name|customer[_-]?name|user[_-]?name|recipient|beneficiary)["']\s*[:=]\s*["'][A-Z][a-z]+(?:\s+[A-Z][a-z]+)+["']/,
    type: "pii",
  },
  { name: "SSN", pattern: /\b\d{3}-\d{2}-\d{4}\b/, type: "pii" },
  { name: "Credit card", pattern: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[- ]?\d{4}[- ]?\d{4}[- ]?\d{3,4}\b/, type: "pii" },
  { name: "Phone number", pattern: /\b(?:\+1[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}\b/, type: "pii" },
  { name: "Email address", pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/, type: "pii" },
];

/** All scan patterns combined. */
export const ALL_PATTERNS: SecretPattern[] = [...SECRET_PATTERNS, ...PII_PATTERNS];

/** Dangerous filename patterns. */
const DANGEROUS_FILENAMES = new Set([".env", ".env.local", ".env.production", ".env.staging"]);
const DANGEROUS_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx"]);
const DANGEROUS_PREFIXES = ["id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"];

/** File extensions to scan. */
const SCANNABLE_EXTENSIONS = new Set([
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".md",
  ".txt",
  ".ts",
  ".js",
  ".cfg",
  ".conf",
  ".ini",
  ".py",
  ".sh",
  ".env.example",
]);

/** Files to skip (they're supposed to contain secrets). */
const SKIP_FILES = new Set([".env", ".env.example", ".env.local"]);

/** False positive patterns to filter out. */
const FALSE_POSITIVE_PATTERNS = [
  /CHANGE_ME/i,
  /YOUR_[A-Z_]+_HERE/i,
  /REPLACE_WITH/i,
  /TODO:/i,
  /FIXME:/i,
  /\$\{[A-Z_]+\}/,
  /\$[A-Z_]{2,}/,
  /process\.env\./,
  /example\.com/i,
  /placeholder/i,
  /xxx+/i,
];

/** Check if a line is a comment. */
function isComment(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("<!--")
  );
}

/** Check if a match is a false positive. */
export function isFalsePositive(line: string): boolean {
  if (isComment(line)) return true;
  for (const fp of FALSE_POSITIVE_PATTERNS) {
    if (fp.test(line)) return true;
  }
  return false;
}

/** Redact a match preview — show pattern type context but mask the actual value. */
export function redactPreview(line: string, patternName: string, pattern: RegExp): string {
  const trimmed = line.trim();
  if (trimmed.length <= 80) {
    return trimmed.replace(pattern, (m) => m.slice(0, 4) + "…" + m.slice(-4));
  }
  const match = pattern.exec(trimmed);
  if (!match) return trimmed.slice(0, 80) + "…";
  const start = Math.max(0, match.index - 10);
  const end = Math.min(trimmed.length, match.index + match[0].length + 10);
  let snippet = trimmed.slice(start, end);
  snippet = snippet.replace(pattern, (m) => m.slice(0, 4) + "…" + m.slice(-4));
  return (start > 0 ? "…" : "") + snippet + (end < trimmed.length ? "…" : "");
}

/**
 * Check if a filename is dangerous (shouldn't be in a repo).
 */
export function isDangerousFilename(filename: string): string | null {
  const base = basename(filename);

  if (DANGEROUS_FILENAMES.has(base)) return "Dangerous file";
  const ext = base.slice(base.lastIndexOf("."));
  if (DANGEROUS_EXTENSIONS.has(ext)) return "Private key file";
  for (const prefix of DANGEROUS_PREFIXES) {
    if (base.startsWith(prefix)) return "SSH private key";
  }
  return null;
}

/**
 * Scan a single file for secret and PII patterns.
 */
export function scanContent(
  content: string,
  filePath: string,
): ScanMatch[] {
  const matches: ScanMatch[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isFalsePositive(line)) continue;

    for (const { name, pattern, type } of ALL_PATTERNS) {
      if (pattern.test(line)) {
        matches.push({
          file: filePath,
          pattern: name,
          line: i + 1,
          type,
          preview: redactPreview(line, name, pattern),
        });
      }
    }
  }

  return matches;
}

/**
 * Recursively collect scannable files from a directory.
 * Also checks for dangerous filenames.
 */
async function collectFiles(
  dir: string,
  dangerousFiles: ScanMatch[],
): Promise<string[]> {
  const files: string[] = [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return files;
  }

  for (const entry of entries) {
    // Skip hidden dirs and node_modules
    if (entry.startsWith(".") && entry !== ".env" && !DANGEROUS_FILENAMES.has(entry)) {
      continue;
    }
    if (entry === "node_modules") continue;

    const fullPath = join(dir, entry);
    const s = await stat(fullPath);

    if (s.isDirectory()) {
      const sub = await collectFiles(fullPath, dangerousFiles);
      files.push(...sub);
    } else if (s.isFile()) {
      // Check for dangerous filenames
      const danger = isDangerousFilename(entry);
      if (danger) {
        dangerousFiles.push({
          file: fullPath,
          pattern: danger,
          line: 0,
          type: "filename",
          preview: entry,
        });
      }

      if (SKIP_FILES.has(entry)) continue;
      const ext = entry.slice(entry.lastIndexOf("."));
      if (SCANNABLE_EXTENSIONS.has(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

/**
 * Scan all files in a directory for PII, secrets, and dangerous filenames.
 */
export async function scanFiles(directory: string): Promise<ScanResult> {
  const dangerousFiles: ScanMatch[] = [];
  const files = await collectFiles(directory, dangerousFiles);
  const allMatches: ScanMatch[] = [...dangerousFiles];

  for (const file of files) {
    try {
      const content = await readFile(file, "utf-8");
      const matches = scanContent(content, file);
      allMatches.push(...matches);
    } catch {
      // Skip unreadable files
    }
  }

  return {
    matches: allMatches,
    filesScanned: files.length,
  };
}

/**
 * Scan git history for leaked secrets and PII.
 */
export async function scanGitHistory(directory: string): Promise<ScanMatch[]> {
  const matches: ScanMatch[] = [];

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "--all", "-p", "--diff-filter=A", "--no-color", "--format=commit %H"],
      { cwd: directory, maxBuffer: 50 * 1024 * 1024 },
    );

    let currentCommit = "";
    let currentFile = "";
    let lineInDiff = 0;

    for (const rawLine of stdout.split("\n")) {
      if (rawLine.startsWith("commit ")) {
        currentCommit = rawLine.slice(7, 19);
        continue;
      }
      if (rawLine.startsWith("diff --git")) {
        const parts = rawLine.split(" b/");
        currentFile = parts[1] ?? "";
        lineInDiff = 0;
        continue;
      }
      if (rawLine.startsWith("@@")) {
        const hunkMatch = /\+(\d+)/.exec(rawLine);
        lineInDiff = hunkMatch ? parseInt(hunkMatch[1], 10) - 1 : 0;
        continue;
      }
      if (!rawLine.startsWith("+") || rawLine.startsWith("+++")) continue;

      lineInDiff++;
      const line = rawLine.slice(1);
      if (isFalsePositive(line)) continue;

      for (const { name, pattern, type } of ALL_PATTERNS) {
        if (pattern.test(line)) {
          const label = `${currentFile} (${currentCommit})`;
          matches.push({
            file: label,
            pattern: name,
            line: lineInDiff,
            type,
            preview: redactPreview(line, name, pattern),
          });
        }
      }
    }
  } catch {
    // git not available or not a git repo — skip history scan
  }

  return matches;
}

/**
 * Format scan results as a table string.
 */
export function formatScanTable(result: ScanResult, historyMatches: ScanMatch[] = []): string {
  const all = [...result.matches, ...historyMatches];

  if (all.length === 0) {
    return `Scanned ${result.filesScanned} files — no issues found.`;
  }

  const lines: string[] = [];

  // Calculate column widths
  const headers = ["File", "Line", "Type", "Pattern", "Preview"];
  const rows = all.map((m) => [
    m.file,
    m.line === 0 ? "-" : String(m.line),
    m.type,
    m.pattern,
    m.preview.slice(0, 60),
  ]);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );

  // Cap widths for readability
  widths[0] = Math.min(widths[0], 40);
  widths[4] = Math.min(widths[4], 60);

  const pad = (s: string, w: number) => s.slice(0, w).padEnd(w);
  const separator = widths.map((w) => "─".repeat(w)).join("─┼─");

  lines.push(headers.map((h, i) => pad(h, widths[i])).join(" │ "));
  lines.push(separator);

  for (const row of rows) {
    lines.push(row.map((c, i) => pad(c, widths[i])).join(" │ "));
  }

  const secretCount = all.filter((m) => m.type === "secret").length;
  const piiCount = all.filter((m) => m.type === "pii").length;
  const fileCount = all.filter((m) => m.type === "filename").length;
  const historyCount = historyMatches.length;

  lines.push("");
  const parts: string[] = [];
  if (secretCount > 0) parts.push(`${secretCount} secret(s)`);
  if (piiCount > 0) parts.push(`${piiCount} PII match(es)`);
  if (fileCount > 0) parts.push(`${fileCount} dangerous file(s)`);
  if (historyCount > 0) parts.push(`${historyCount} in git history`);
  lines.push(
    `Found ${all.length} issue(s): ${parts.join(", ")}. Scanned ${result.filesScanned} files.`,
  );

  return lines.join("\n");
}
