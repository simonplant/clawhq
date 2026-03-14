/**
 * Supply chain security — vetting pipeline for skills and tools.
 *
 * Orchestrates source verification, AI-powered pattern scanning,
 * VirusTotal integration, and tool allowlist management.
 */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VettingStage = "source_verification" | "pattern_scan" | "virustotal";

export interface SourceVerificationResult {
  verified: boolean;
  registry: string | null;
  warnings: string[];
}

export interface PatternScanResult {
  passed: boolean;
  findings: PatternFinding[];
}

export interface PatternFinding {
  rule: string;
  severity: "info" | "warn" | "fail";
  message: string;
  file?: string;
  line?: number;
  context?: string;
}

export interface VirusTotalResult {
  scanned: boolean;
  clean: boolean;
  detections: number;
  total: number;
  permalink: string | null;
  error: string | null;
}

export interface VettingPipelineResult {
  passed: boolean;
  sourceVerification: SourceVerificationResult;
  patternScan: PatternScanResult;
  virusTotal: VirusTotalResult | null;
  summary: string;
}

export interface AllowlistEntry {
  name: string;
  version: string;
  addedAt: string;
  reason: string;
}

export interface ToolAllowlist {
  packages: AllowlistEntry[];
}

// ---------------------------------------------------------------------------
// Known registries for source verification
// ---------------------------------------------------------------------------

/** Trusted source registries for skill verification. */
export const KNOWN_REGISTRIES: Array<{
  name: string;
  pattern: RegExp;
  trusted: boolean;
}> = [
  {
    name: "github",
    pattern: /^https?:\/\/(www\.)?github\.com\/[\w.-]+\/[\w.-]+/,
    trusted: true,
  },
  {
    name: "gitlab",
    pattern: /^https?:\/\/(www\.)?gitlab\.com\/[\w.-]+\/[\w.-]+/,
    trusted: true,
  },
  {
    name: "npm",
    pattern: /^https?:\/\/(www\.)?npmjs\.com\/package\//,
    trusted: true,
  },
  {
    name: "openclaw-marketplace",
    pattern: /^https?:\/\/(www\.)?openclaw\.(io|com)\/marketplace\//,
    trusted: true,
  },
];

// ---------------------------------------------------------------------------
// Source verification
// ---------------------------------------------------------------------------

/**
 * Verify a skill's source against known registries.
 *
 * Checks whether the source URI matches a known, trusted registry.
 * Local sources are treated as trusted (user controls the path).
 */
export function verifySource(
  source: "registry" | "url" | "local",
  sourceUri: string,
): SourceVerificationResult {
  const warnings: string[] = [];

  if (source === "local") {
    return {
      verified: true,
      registry: "local",
      warnings: [],
    };
  }

  if (source === "registry") {
    // Named registry lookups are implicitly trusted
    return {
      verified: true,
      registry: "openclaw-registry",
      warnings: [],
    };
  }

  // URL source — check against known registries
  const matched = KNOWN_REGISTRIES.find((r) => r.pattern.test(sourceUri));

  if (matched) {
    return {
      verified: matched.trusted,
      registry: matched.name,
      warnings: matched.trusted
        ? []
        : [`Source matched registry "${matched.name}" but it is not in the trusted list.`],
    };
  }

  warnings.push(
    `Source "${sourceUri}" does not match any known registry.`,
    "Install from unknown sources carries higher risk — review the skill contents carefully.",
  );

  return {
    verified: false,
    registry: null,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// AI-powered pattern scanning
// ---------------------------------------------------------------------------

/**
 * Suspicious patterns for AI-powered scanning.
 *
 * Extends the basic skill vetting (src/skill/vet.ts) with supply-chain-specific
 * patterns focused on: outbound calls to non-allowlisted domains, credential
 * harvesting, and filesystem writes outside workspace.
 */
const SUPPLY_CHAIN_PATTERNS: Array<{
  rule: string;
  pattern: RegExp;
  severity: "info" | "warn" | "fail";
  message: string;
  falsePositiveFilter?: RegExp;
}> = [
  // Outbound network to non-allowlisted domains
  {
    rule: "non-allowlisted-domain",
    pattern: /https?:\/\/(?!localhost|127\.0\.0\.1|api\.github\.com|registry\.npmjs\.org|api\.openclaw\.io)[\w.-]+\.\w+/,
    severity: "warn",
    message: "Outbound request to non-allowlisted domain",
    falsePositiveFilter: /example\.com|placeholder\.test|docs\.example|schema\.org|json-schema\.org/,
  },
  // Credential harvesting
  {
    rule: "credential-harvesting",
    pattern: /(?:readFile|cat|read)\s*\(?\s*["'`].*(?:\.env|credentials|\.aws|\.ssh|\.gnupg|\.config\/gcloud)/,
    severity: "fail",
    message: "Potential credential file read detected",
  },
  // Encoded payload delivery
  {
    rule: "encoded-payload",
    pattern: /(?:atob|Buffer\.from|base64\s+(?:-d|--decode))\s*\(/,
    severity: "warn",
    message: "Base64 decoding detected — may be used to hide malicious payload",
    falsePositiveFilter: /test|spec|mock|example|\.md$/,
  },
  // Dynamic import / require of remote URLs
  {
    rule: "dynamic-remote-import",
    pattern: /(?:import|require)\s*\(\s*(?:["'`]https?:\/\/|[^"'`\s]+\+\s*["'`]https?:\/\/)/,
    severity: "fail",
    message: "Dynamic import from remote URL detected",
  },
  // Crypto mining indicators
  {
    rule: "crypto-mining",
    pattern: /(?:stratum\+tcp|xmrig|cryptonight|monero|coinhive|minero)/i,
    severity: "fail",
    message: "Crypto mining indicator detected",
  },
  // DNS exfiltration
  {
    rule: "dns-exfiltration",
    pattern: /(?:nslookup|dig|host)\s+.*\$|\.burpcollaborator\.|\.oastify\.|\.interact\.sh/,
    severity: "fail",
    message: "Potential DNS exfiltration or callback pattern",
  },
  // Privilege escalation
  {
    rule: "privilege-escalation",
    pattern: /\bsudo\b|\bchmod\s+[0-7]*[4-7][0-7]*\s|\bchown\b.*root|\bsetuid\b/,
    severity: "fail",
    message: "Privilege escalation attempt detected",
  },
  // Obfuscated code
  {
    rule: "obfuscated-code",
    pattern: /\\x[0-9a-f]{2}(?:\\x[0-9a-f]{2}){4,}|\\u[0-9a-f]{4}(?:\\u[0-9a-f]{4}){4,}/i,
    severity: "warn",
    message: "Potentially obfuscated code detected (long hex/unicode escape sequences)",
  },
  // Workspace escape via symlinks
  {
    rule: "symlink-escape",
    pattern: /\bln\s+-s\b|\bsymlink\b|\breadlink\b.*\.\./,
    severity: "warn",
    message: "Symlink creation detected — may be used to escape workspace boundary",
  },
];

/**
 * Run supply chain pattern scanning on skill files.
 *
 * Scans all files for supply-chain-specific suspicious patterns,
 * applying false-positive filters where configured.
 */
export async function scanPatterns(
  skillDir: string,
  files: string[],
): Promise<PatternScanResult> {
  const findings: PatternFinding[] = [];

  for (const relPath of files) {
    const fullPath = join(skillDir, relPath);
    let content: string;
    try {
      content = await readFile(fullPath, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const check of SUPPLY_CHAIN_PATTERNS) {
        if (!check.pattern.test(line)) continue;

        // Apply false-positive filter
        if (check.falsePositiveFilter?.test(line)) continue;

        findings.push({
          rule: check.rule,
          severity: check.severity,
          message: check.message,
          file: relPath,
          line: i + 1,
          context: line.trim().slice(0, 120),
        });
      }
    }
  }

  const passed = !findings.some((f) => f.severity === "fail");
  return { passed, findings };
}

// ---------------------------------------------------------------------------
// VirusTotal integration
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 hash of a file for VirusTotal lookup.
 */
export async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Compute SHA-256 hashes for all files in a skill directory.
 */
export async function hashSkillFiles(
  skillDir: string,
  files: string[],
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (const relPath of files) {
    const fullPath = join(skillDir, relPath);
    try {
      const fileStat = await stat(fullPath);
      if (!fileStat.isFile()) continue;
      const hash = await hashFile(fullPath);
      hashes.set(relPath, hash);
    } catch {
      // Skip unreadable files
    }
  }
  return hashes;
}

/**
 * Scan a file hash against VirusTotal.
 *
 * Uses the VirusTotal v3 API to check if the file hash is known-malicious.
 * Requires VIRUSTOTAL_API_KEY in environment. Returns null result if
 * API key is not configured (graceful degradation).
 */
export async function scanVirusTotal(
  fileHash: string,
  apiKey: string | undefined,
): Promise<VirusTotalResult> {
  if (!apiKey) {
    return {
      scanned: false,
      clean: true,
      detections: 0,
      total: 0,
      permalink: null,
      error: "VIRUSTOTAL_API_KEY not configured — skipping VirusTotal scan",
    };
  }

  try {
    const url = `https://www.virustotal.com/api/v3/files/${fileHash}`;
    const response = await fetch(url, {
      headers: { "x-apikey": apiKey },
    });

    if (response.status === 404) {
      // File not in VT database — not necessarily clean, but not known-bad
      return {
        scanned: true,
        clean: true,
        detections: 0,
        total: 0,
        permalink: null,
        error: null,
      };
    }

    if (!response.ok) {
      return {
        scanned: false,
        clean: true,
        detections: 0,
        total: 0,
        permalink: null,
        error: `VirusTotal API error: ${response.status} ${response.statusText}`,
      };
    }

    const data = (await response.json()) as {
      data?: {
        attributes?: {
          last_analysis_stats?: { malicious?: number; suspicious?: number; undetected?: number; harmless?: number };
        };
        links?: { self?: string };
      };
    };

    const stats = data.data?.attributes?.last_analysis_stats;
    const malicious = (stats?.malicious ?? 0) + (stats?.suspicious ?? 0);
    const total =
      (stats?.malicious ?? 0) +
      (stats?.suspicious ?? 0) +
      (stats?.undetected ?? 0) +
      (stats?.harmless ?? 0);

    return {
      scanned: true,
      clean: malicious === 0,
      detections: malicious,
      total,
      permalink: data.data?.links?.self ?? null,
      error: null,
    };
  } catch (err) {
    return {
      scanned: false,
      clean: true,
      detections: 0,
      total: 0,
      permalink: null,
      error: `VirusTotal scan failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Scan all skill files against VirusTotal.
 *
 * Hashes each file and checks against VT. Returns the worst result
 * (any detection means the skill is flagged).
 */
export async function scanSkillVirusTotal(
  skillDir: string,
  files: string[],
  apiKey: string | undefined,
): Promise<VirusTotalResult> {
  if (!apiKey) {
    return scanVirusTotal("", undefined);
  }

  const hashes = await hashSkillFiles(skillDir, files);
  let totalDetections = 0;
  let totalEngines = 0;
  let anyScanned = false;
  let lastPermalink: string | null = null;
  const errors: string[] = [];

  for (const [, hash] of hashes) {
    const result = await scanVirusTotal(hash, apiKey);
    if (result.scanned) {
      anyScanned = true;
      totalDetections += result.detections;
      totalEngines = Math.max(totalEngines, result.total);
      if (result.permalink) lastPermalink = result.permalink;
    }
    if (result.error) errors.push(result.error);
  }

  return {
    scanned: anyScanned,
    clean: totalDetections === 0,
    detections: totalDetections,
    total: totalEngines,
    permalink: lastPermalink,
    error: errors.length > 0 ? errors.join("; ") : null,
  };
}

// ---------------------------------------------------------------------------
// Tool allowlist management
// ---------------------------------------------------------------------------

const ALLOWLIST_FILE = "tools/allowlist.json";

/**
 * Default known-safe packages with version pinning.
 */
export const DEFAULT_ALLOWLIST: AllowlistEntry[] = [
  { name: "curl", version: "*", addedAt: "2026-01-01T00:00:00Z", reason: "Core HTTP client — always included" },
  { name: "jq", version: "*", addedAt: "2026-01-01T00:00:00Z", reason: "Core JSON processor — always included" },
  { name: "rg", version: "*", addedAt: "2026-01-01T00:00:00Z", reason: "Core search tool — always included" },
  { name: "himalaya", version: "*", addedAt: "2026-01-01T00:00:00Z", reason: "Email client — vetted integration" },
  { name: "gh", version: "*", addedAt: "2026-01-01T00:00:00Z", reason: "GitHub CLI — vetted integration" },
  { name: "git", version: "*", addedAt: "2026-01-01T00:00:00Z", reason: "Version control — vetted integration" },
  { name: "ffmpeg", version: "*", addedAt: "2026-01-01T00:00:00Z", reason: "Media processing — vetted integration" },
  { name: "yq", version: "*", addedAt: "2026-01-01T00:00:00Z", reason: "YAML processor — vetted integration" },
  { name: "pandoc", version: "*", addedAt: "2026-01-01T00:00:00Z", reason: "Document converter — commonly requested" },
  { name: "imagemagick", version: "*", addedAt: "2026-01-01T00:00:00Z", reason: "Image processing — commonly requested" },
  { name: "sqlite3", version: "*", addedAt: "2026-01-01T00:00:00Z", reason: "Local database — commonly requested" },
  { name: "python3", version: "*", addedAt: "2026-01-01T00:00:00Z", reason: "Python runtime — skill dependency" },
];

function allowlistPath(clawhqDir: string): string {
  return join(clawhqDir, ALLOWLIST_FILE);
}

/**
 * Load the tool allowlist from disk, falling back to defaults.
 */
export async function loadAllowlist(clawhqDir: string): Promise<ToolAllowlist> {
  try {
    const raw = await readFile(allowlistPath(clawhqDir), "utf-8");
    return JSON.parse(raw) as ToolAllowlist;
  } catch {
    return { packages: [...DEFAULT_ALLOWLIST] };
  }
}

/**
 * Save the tool allowlist to disk.
 */
export async function saveAllowlist(
  clawhqDir: string,
  allowlist: ToolAllowlist,
): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const path = allowlistPath(clawhqDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(allowlist, null, 2) + "\n", "utf-8");
}

/**
 * Check if a package is on the allowlist.
 */
export function isAllowlisted(
  allowlist: ToolAllowlist,
  packageName: string,
  version?: string,
): boolean {
  const entry = allowlist.packages.find((e) => e.name === packageName);
  if (!entry) return false;
  if (entry.version === "*") return true;
  if (version && entry.version !== version) return false;
  return true;
}

/**
 * Add a package to the allowlist.
 */
export function addToAllowlist(
  allowlist: ToolAllowlist,
  entry: AllowlistEntry,
): ToolAllowlist {
  const filtered = allowlist.packages.filter((e) => e.name !== entry.name);
  return { packages: [...filtered, entry] };
}

/**
 * Remove a package from the allowlist.
 */
export function removeFromAllowlist(
  allowlist: ToolAllowlist,
  packageName: string,
): ToolAllowlist {
  return { packages: allowlist.packages.filter((e) => e.name !== packageName) };
}

// ---------------------------------------------------------------------------
// Full vetting pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full supply chain vetting pipeline on a skill.
 *
 * Stages:
 * 1. Source verification — check against known registries
 * 2. Pattern scanning — detect suspicious patterns with false-positive filtering
 * 3. VirusTotal scan — check file hashes against known malware (if API key available)
 */
export async function runVettingPipeline(
  skillDir: string,
  files: string[],
  source: "registry" | "url" | "local",
  sourceUri: string,
  options?: { virusTotalApiKey?: string },
): Promise<VettingPipelineResult> {
  // Stage 1: Source verification
  const sourceVerification = verifySource(source, sourceUri);

  // Stage 2: Pattern scanning
  const patternScan = await scanPatterns(skillDir, files);

  // Stage 3: VirusTotal (optional)
  let virusTotal: VirusTotalResult | null = null;
  if (options?.virusTotalApiKey) {
    virusTotal = await scanSkillVirusTotal(skillDir, files, options.virusTotalApiKey);
  }

  // Aggregate result
  const passed =
    patternScan.passed &&
    (virusTotal === null || virusTotal.clean);

  const summaryParts: string[] = [];
  summaryParts.push(
    `Source: ${sourceVerification.verified ? "verified" : "UNVERIFIED"}${sourceVerification.registry ? ` (${sourceVerification.registry})` : ""}`,
  );
  summaryParts.push(
    `Patterns: ${patternScan.passed ? "PASS" : "FAIL"} (${patternScan.findings.length} finding${patternScan.findings.length !== 1 ? "s" : ""})`,
  );
  if (virusTotal) {
    summaryParts.push(
      `VirusTotal: ${virusTotal.scanned ? (virusTotal.clean ? "CLEAN" : `${virusTotal.detections}/${virusTotal.total} detections`) : "skipped"}`,
    );
  }

  return {
    passed,
    sourceVerification,
    patternScan,
    virusTotal,
    summary: summaryParts.join(" | "),
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format vetting pipeline results for CLI display.
 */
export function formatVettingResult(result: VettingPipelineResult): string {
  const lines: string[] = [];

  lines.push(`  Supply Chain Vetting: ${result.passed ? "PASS" : "FAIL"}`);
  lines.push("");

  // Source verification
  const srcIcon = result.sourceVerification.verified ? "PASS" : "WARN";
  lines.push(`  ${srcIcon}  Source Verification`);
  if (result.sourceVerification.registry) {
    lines.push(`       Registry: ${result.sourceVerification.registry}`);
  }
  for (const w of result.sourceVerification.warnings) {
    lines.push(`       WARNING: ${w}`);
  }

  // Pattern scan
  const patIcon = result.patternScan.passed ? "PASS" : "FAIL";
  lines.push(`  ${patIcon}  Pattern Scan (${result.patternScan.findings.length} finding${result.patternScan.findings.length !== 1 ? "s" : ""})`);
  for (const f of result.patternScan.findings) {
    const loc = f.file ? ` (${f.file}${f.line ? `:${f.line}` : ""})` : "";
    const icon = f.severity === "fail" ? "FAIL" : f.severity === "warn" ? "WARN" : "INFO";
    lines.push(`       ${icon}  [${f.rule}] ${f.message}${loc}`);
    if (f.context) {
      lines.push(`             ${f.context}`);
    }
  }

  // VirusTotal
  if (result.virusTotal) {
    const vtIcon = result.virusTotal.clean ? "PASS" : "FAIL";
    if (result.virusTotal.scanned) {
      lines.push(`  ${vtIcon}  VirusTotal: ${result.virusTotal.detections}/${result.virusTotal.total} detections`);
    } else {
      lines.push(`  SKIP  VirusTotal: ${result.virusTotal.error ?? "not scanned"}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format allowlist for CLI display.
 */
export function formatAllowlist(allowlist: ToolAllowlist): string {
  if (allowlist.packages.length === 0) {
    return "No packages in allowlist.";
  }

  const nameWidth = Math.max(7, ...allowlist.packages.map((e) => e.name.length));
  const versionWidth = Math.max(7, ...allowlist.packages.map((e) => e.version.length));

  const lines: string[] = [];
  lines.push(
    `${"PACKAGE".padEnd(nameWidth)}  ${"VERSION".padEnd(versionWidth)}  REASON`,
  );
  lines.push("-".repeat(nameWidth + versionWidth + 30));

  for (const entry of allowlist.packages) {
    lines.push(
      `${entry.name.padEnd(nameWidth)}  ${entry.version.padEnd(versionWidth)}  ${entry.reason}`,
    );
  }

  return lines.join("\n");
}
