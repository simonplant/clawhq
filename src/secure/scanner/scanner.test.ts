/**
 * Tests for PII + secrets scanner.
 *
 * Tests pattern detection, false-positive filtering, redaction,
 * directory walk, and output formatting.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { formatScanJson, formatScanTable } from "./format.js";
import { isFalsePositive, shouldSkipFile } from "./patterns.js";
import { runScan } from "./scan.js";
import { redact, scanContent } from "./scanner.js";
import type { Finding, ScanReport } from "./types.js";
import { walkAndScan } from "./walk.js";

// ── Test Fixtures ───────────────────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
  testDir = join(
    tmpdir(),
    `clawhq-scanner-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(join(testDir, "workspace"), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

/** Find a finding by description or category, throwing if not found. */
function findFinding(findings: Finding[], match: Partial<Finding>): Finding {
  const result = findings.find((f) =>
    Object.entries(match).every(
      ([k, v]) => f[k as keyof Finding] === v,
    ),
  );
  if (!result) {
    throw new Error(`Expected finding matching ${JSON.stringify(match)} not found`);
  }
  return result;
}

// ── Pattern Detection ───────────────────────────────────────────────────────

describe("scanContent", () => {
  it("detects AWS access key", () => {
    const content = "AWS_KEY=AKIAIOSFODNN7EXAMPLE";
    const findings = scanContent(content, "config.env");
    const aws = findFinding(findings, { description: "AWS access key ID" });
    expect(aws.category).toBe("api-key");
    expect(aws.severity).toBe("critical");
  });

  it("detects OpenAI API key", () => {
    const content = "OPENAI_API_KEY=sk-proj-abc123xyz789def456ghi";
    const findings = scanContent(content, ".env");
    const openai = findFinding(findings, { description: "OpenAI API key" });
    expect(openai.severity).toBe("critical");
  });

  it("detects Anthropic API key", () => {
    const content = "ANTHROPIC_KEY=sk-ant-api03-abc123xyz789def456ghi";
    const findings = scanContent(content, ".env");
    findFinding(findings, { description: "Anthropic API key" });
  });

  it("detects GitHub token", () => {
    const content = "token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn";
    const findings = scanContent(content, "config.yaml");
    findFinding(findings, { description: "GitHub token" });
  });

  it("detects Slack token", () => {
    const content = "SLACK_TOKEN=xoxb-123456789012-1234567890123-abcdefghijklmnopqrstuvwx";
    const findings = scanContent(content, ".env");
    findFinding(findings, { description: "Slack token" });
  });

  it("detects Stripe key", () => {
    const content = "stripe_key: sk_live_abc123def456ghi789jkl012";
    const findings = scanContent(content, "config.yaml");
    findFinding(findings, { description: "Stripe API key" });
  });

  it("detects private key header", () => {
    const content = "-----BEGIN RSA PRIVATE KEY-----\nMIIE...";
    const findings = scanContent(content, "key.pem");
    const pk = findFinding(findings, { category: "private-key" });
    expect(pk.severity).toBe("critical");
  });

  it("detects password assignment", () => {
    const content = 'password="SuperSecretP@ss123"';
    const findings = scanContent(content, "config.ts");
    findFinding(findings, { category: "password" });
  });

  it("detects database connection string", () => {
    const content = "DATABASE_URL=postgres://user:pass@db.example.internal:5432/mydb";
    const findings = scanContent(content, ".env");
    findFinding(findings, { category: "connection-string" });
  });

  it("detects SSN pattern", () => {
    const content = "ssn: 234-56-7890";
    const findings = scanContent(content, "data.txt");
    const ssn = findFinding(findings, { category: "pii-ssn" });
    expect(ssn.severity).toBe("critical");
  });

  it("detects email address", () => {
    const content = "contact: john.doe@realcompany.com";
    const findings = scanContent(content, "contacts.yaml");
    findFinding(findings, { category: "pii-email" });
  });

  it("returns line numbers (1-based)", () => {
    const content = "line1\nline2\nkey=sk-proj-abc123xyz789def456ghi\nline4";
    const findings = scanContent(content, "test.env");
    const key = findFinding(findings, { description: "OpenAI API key" });
    expect(key.line).toBe(3);
  });

  it("returns redacted values, never raw secrets", () => {
    const content = "OPENAI_API_KEY=sk-proj-abc123xyz789def456ghi";
    const findings = scanContent(content, ".env");
    const f = findFinding(findings, { description: "OpenAI API key" });
    expect(f.redacted).toContain("****");
    expect(f.redacted).not.toBe("sk-proj-abc123xyz789def456ghi");
  });
});

// ── False-Positive Filtering ────────────────────────────────────────────────

describe("isFalsePositive", () => {
  it("filters comment lines (JS single-line)", () => {
    expect(isFalsePositive("openai-key", "sk-proj-test", "  // sk-proj-test")).toBe(true);
  });

  it("filters comment lines (shell/yaml)", () => {
    expect(isFalsePositive("openai-key", "sk-proj-test", "# API key: sk-proj-test")).toBe(true);
  });

  it("filters placeholder values (example.com)", () => {
    expect(isFalsePositive("pii-email", "user@example.com", "email: user@example.com")).toBe(true);
  });

  it("filters placeholder values (CHANGEME)", () => {
    expect(isFalsePositive("password-assignment", "CHANGEME", 'password="CHANGEME"')).toBe(true);
  });

  it("filters placeholder values (your-)", () => {
    expect(isFalsePositive("generic-api-key", "your-api-key-here", "api_key: your-api-key-here")).toBe(true);
  });

  it("filters test SSN (123-45-6789)", () => {
    expect(isFalsePositive("pii-ssn", "123-45-6789", "ssn: 123-45-6789")).toBe(true);
  });

  it("filters test credit card (4111111111111111)", () => {
    expect(isFalsePositive("pii-credit-card", "4111111111111111", "card: 4111111111111111")).toBe(true);
  });

  it("does not filter real-looking values", () => {
    expect(isFalsePositive("openai-key", "sk-proj-realkey123abc", "key=sk-proj-realkey123abc")).toBe(false);
  });
});

// ── Redaction ───────────────────────────────────────────────────────────────

describe("redact", () => {
  it("redacts short values completely", () => {
    expect(redact("short")).toBe("****");
  });

  it("preserves prefix for provider keys", () => {
    const result = redact("sk-proj-abc123xyz789def456ghi");
    expect(result).toMatch(/^sk-proj-\*\*\*\*/);
    expect(result).not.toContain("abc123");
  });

  it("shows first/last 4 for generic values", () => {
    const result = redact("abcdefghijklmnop");
    expect(result).toBe("abcd****mnop");
  });

  it("never returns the original value", () => {
    const value = "sk-ant-api03-abc123xyz789";
    expect(redact(value)).not.toBe(value);
    expect(redact(value)).toContain("****");
  });
});

// ── File Skip Logic ─────────────────────────────────────────────────────────

describe("shouldSkipFile", () => {
  it("skips markdown files", () => {
    expect(shouldSkipFile("README.md")).toBe(true);
  });

  it("skips lock files", () => {
    expect(shouldSkipFile("package-lock.json")).toBe(true);
  });

  it("skips image files", () => {
    expect(shouldSkipFile("logo.png")).toBe(true);
  });

  it("does not skip TypeScript files", () => {
    expect(shouldSkipFile("config.ts")).toBe(false);
  });

  it("does not skip .env files", () => {
    expect(shouldSkipFile(".env")).toBe(false);
  });

  it("does not skip YAML files", () => {
    expect(shouldSkipFile("config.yaml")).toBe(false);
  });
});

// ── Directory Walk ──────────────────────────────────────────────────────────

describe("walkAndScan", () => {
  it("scans files recursively", async () => {
    await mkdir(join(testDir, "workspace", "subdir"), { recursive: true });
    await writeFile(
      join(testDir, "workspace", "config.env"),
      "OPENAI_KEY=sk-proj-abc123xyz789def456ghi\n",
    );
    await writeFile(
      join(testDir, "workspace", "subdir", "secrets.yaml"),
      "anthropic_key: sk-ant-api03-xyz789abc123def456\n",
    );

    const result = await walkAndScan(join(testDir, "workspace"));
    expect(result.filesScanned).toBeGreaterThanOrEqual(2);
    expect(result.findings.length).toBeGreaterThanOrEqual(2);
  });

  it("skips node_modules", async () => {
    await mkdir(join(testDir, "workspace", "node_modules", "pkg"), { recursive: true });
    await writeFile(
      join(testDir, "workspace", "node_modules", "pkg", "index.js"),
      'const key = "sk-proj-shouldnotfindthiskey123";\n',
    );

    const result = await walkAndScan(join(testDir, "workspace"));
    expect(result.findings).toHaveLength(0);
  });

  it("skips binary files", async () => {
    await writeFile(
      join(testDir, "workspace", "binary.dat"),
      Buffer.from([0x00, 0x01, 0x02, 0x03]),
    );

    const result = await walkAndScan(join(testDir, "workspace"));
    expect(result.findings).toHaveLength(0);
  });

  it("returns zero findings for clean directory", async () => {
    await writeFile(
      join(testDir, "workspace", "clean.ts"),
      'const greeting = "Hello, world!";\n',
    );

    const result = await walkAndScan(join(testDir, "workspace"));
    expect(result.findings).toHaveLength(0);
    expect(result.filesScanned).toBe(1);
  });
});

// ── Orchestrator ────────────────────────────────────────────────────────────

describe("runScan", () => {
  it("produces a clean report for empty workspace", async () => {
    const report = await runScan({ deployDir: testDir });
    expect(report.clean).toBe(true);
    expect(report.findings).toHaveLength(0);
  });

  it("finds secrets in workspace files", async () => {
    await writeFile(
      join(testDir, "workspace", ".env"),
      "OPENAI_API_KEY=sk-proj-abc123xyz789def456ghi\n",
    );

    const report = await runScan({ deployDir: testDir });
    expect(report.clean).toBe(false);
    expect(report.fileFindings.length).toBeGreaterThan(0);
  });

  it("includes timestamp and scan root", async () => {
    const report = await runScan({ deployDir: testDir });
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.scanRoot).toContain("workspace");
  });
});

// ── Formatters ──────────────────────────────────────────────────────────────

describe("formatScanTable", () => {
  it("shows clean message when no findings", () => {
    const report = makeReport({ clean: true, findings: [], filesScanned: 5 });
    const output = formatScanTable(report);
    expect(output).toContain("No secrets or PII found");
    expect(output).toContain("5 files");
  });

  it("shows findings grouped by severity", () => {
    const report = makeReport({
      clean: false,
      findings: [
        {
          category: "api-key",
          severity: "critical",
          description: "OpenAI API key",
          file: ".env",
          line: 1,
          redacted: "sk-proj-****ghi",
          source: "file" as const,
        },
      ],
      fileFindings: [
        {
          category: "api-key",
          severity: "critical",
          description: "OpenAI API key",
          file: ".env",
          line: 1,
          redacted: "sk-proj-****ghi",
          source: "file" as const,
        },
      ],
      filesScanned: 10,
    });

    const output = formatScanTable(report);
    expect(output).toContain("CRIT");
    expect(output).toContain("OpenAI API key");
    expect(output).toContain("sk-proj-****ghi");
    expect(output).toContain(".env:1");
  });
});

describe("formatScanJson", () => {
  it("produces valid JSON", () => {
    const report = makeReport({ clean: true, findings: [], filesScanned: 3 });
    const json = formatScanJson(report);
    const parsed = JSON.parse(json);
    expect(parsed.clean).toBe(true);
    expect(parsed.summary.filesScanned).toBe(3);
  });

  it("includes findings in JSON output", () => {
    const finding = {
      category: "api-key" as const,
      severity: "critical" as const,
      description: "OpenAI API key",
      file: ".env",
      line: 1,
      redacted: "sk-proj-****ghi",
      source: "file" as const,
    };
    const report = makeReport({
      clean: false,
      findings: [finding],
      fileFindings: [finding],
      filesScanned: 1,
    });

    const json = formatScanJson(report);
    const parsed = JSON.parse(json);
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].redacted).toBe("sk-proj-****ghi");
    expect(parsed.summary.bySeverity.critical).toBe(1);
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeReport(overrides: Partial<ScanReport>): ScanReport {
  return {
    timestamp: new Date().toISOString(),
    scanRoot: "/test/workspace",
    findings: [],
    fileFindings: [],
    gitFindings: [],
    filesScanned: 0,
    commitsScanned: 0,
    clean: true,
    ...overrides,
  };
}
