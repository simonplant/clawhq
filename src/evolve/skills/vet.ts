/**
 * Skill vetting — scans skill files for suspicious patterns before installation.
 *
 * Checks for: outbound network calls, filesystem access outside workspace,
 * credential/secret access, and dangerous shell patterns.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { VetResult, VetWarning } from "./types.js";

/** Patterns that indicate suspicious behavior in skill scripts. */
const SUSPICIOUS_PATTERNS: Array<{
  rule: string;
  pattern: RegExp;
  severity: "warn" | "fail";
  message: string;
}> = [
  {
    rule: "outbound-network",
    pattern: /\bcurl\b|\bwget\b|\bfetch\(|\bhttp\.get\b|\bhttp\.request\b|\brequests?\.\w+\b|\burllib\b/,
    severity: "warn",
    message: "Outbound network call detected",
  },
  {
    rule: "credential-access",
    pattern: /\b(API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY)\b/i,
    severity: "warn",
    message: "Potential credential access",
  },
  {
    rule: "env-access",
    pattern: /process\.env|os\.environ|\$\{?\w*KEY\w*\}?|\$\{?\w*SECRET\w*\}?|\$\{?\w*TOKEN\w*\}?/,
    severity: "warn",
    message: "Environment variable access (may read secrets)",
  },
  {
    rule: "fs-outside-workspace",
    pattern: /\/etc\/|\/root\/|\/home\/(?!node\/\.openclaw\/workspace)|\/var\/|\/tmp\/|\/proc\/|\/sys\//,
    severity: "fail",
    message: "Filesystem access outside agent workspace",
  },
  {
    rule: "dangerous-exec",
    pattern: /\beval\b|\bexec\b.*\bshell\b|\bchild_process\b|\bsubprocess\.call\b|\bos\.system\b/,
    severity: "warn",
    message: "Dynamic code execution detected",
  },
  {
    rule: "reverse-shell",
    pattern: /\/dev\/tcp|nc\s+-[elp]|ncat\b|socat\b|bash\s+-i/,
    severity: "fail",
    message: "Potential reverse shell pattern",
  },
  {
    rule: "data-exfil",
    pattern: /base64.*curl|curl.*--data.*\$|wget.*--post-data/,
    severity: "fail",
    message: "Potential data exfiltration pattern",
  },
];

/**
 * Vet a skill directory for suspicious patterns.
 *
 * Scans all files in the skill directory against known suspicious patterns.
 * Returns a VetResult with pass/fail and any warnings found.
 */
export async function vetSkill(
  skillDir: string,
  files: string[],
): Promise<VetResult> {
  const warnings: VetWarning[] = [];

  for (const relPath of files) {
    const fullPath = join(skillDir, relPath);
    let content: string;
    try {
      content = await readFile(fullPath, "utf-8");
    } catch {
      // Binary file or unreadable — skip
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const check of SUSPICIOUS_PATTERNS) {
        if (check.pattern.test(lines[i])) {
          warnings.push({
            rule: check.rule,
            severity: check.severity,
            message: check.message,
            file: relPath,
            line: i + 1,
          });
        }
      }
    }
  }

  const passed = !warnings.some((w) => w.severity === "fail");

  return { passed, warnings };
}

/**
 * Format vetting results for display.
 */
export function formatVetResult(result: VetResult): string {
  if (result.warnings.length === 0) {
    return "  Vetting: PASS (no suspicious patterns found)";
  }

  const lines = [
    `  Vetting: ${result.passed ? "PASS with warnings" : "FAIL"}`,
  ];

  for (const w of result.warnings) {
    const loc = w.file ? ` (${w.file}${w.line ? `:${w.line}` : ""})` : "";
    const icon = w.severity === "fail" ? "FAIL" : "WARN";
    lines.push(`    ${icon}  [${w.rule}] ${w.message}${loc}`);
  }

  return lines.join("\n");
}
