import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  formatScanTable,
  isDangerousFilename,
  isFalsePositive,
  redactPreview,
  scanContent,
  scanFiles,
} from "./scanner.js";

describe("scanContent", () => {
  it("detects Anthropic API keys", () => {
    const content = '{"key": "sk-ant-api03-abcdefghijklmnopqrstuvwxyz"}';
    const matches = scanContent(content, "test.json");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((m) => m.pattern === "Anthropic API key")).toBe(true);
    expect(matches[0]?.type).toBe("secret");
  });

  it("detects OpenAI API keys", () => {
    const content = '{"key": "sk-abcdefghijklmnopqrstuvwxyz1234567890"}';
    const matches = scanContent(content, "test.json");
    expect(matches.some((m) => m.pattern === "OpenAI API key")).toBe(true);
  });

  it("detects AWS access keys", () => {
    const content = '{"key": "AKIAIOSFODNN7EXAMPLE"}';
    const matches = scanContent(content, "test.json");
    expect(matches.some((m) => m.pattern === "AWS access key")).toBe(true);
  });

  it("detects GitHub tokens", () => {
    const content = '{"token": "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"}';
    const matches = scanContent(content, "test.json");
    expect(matches.some((m) => m.pattern === "GitHub token")).toBe(true);
  });

  it("detects Telegram bot tokens", () => {
    const content = '{"token": "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi"}';
    const matches = scanContent(content, "test.json");
    expect(matches.some((m) => m.pattern === "Telegram bot token")).toBe(true);
  });

  it("detects JWTs", () => {
    const content = 'token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const matches = scanContent(content, "test.json");
    expect(matches.some((m) => m.pattern === "JWT")).toBe(true);
  });

  it("detects private keys", () => {
    const content = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA";
    const matches = scanContent(content, "test.json");
    expect(matches.some((m) => m.pattern === "Private key")).toBe(true);
  });

  it("returns empty for clean content", () => {
    const content = '{"name": "my-agent", "port": 18789}';
    const matches = scanContent(content, "test.json");
    expect(matches).toHaveLength(0);
  });

  it("reports correct line numbers", () => {
    const content = 'line1\nline2\n{"key": "sk-ant-api03-abcdefghijklmnopqrstuvwxyz"}';
    const matches = scanContent(content, "test.json");
    expect(matches[0]?.line).toBe(3);
  });

  it("detects multiple secrets on different lines", () => {
    const content = 'key1: sk-ant-api03-abcdefghijklmnopqrstuvwxyz\nkey2: AKIAIOSFODNN7EXAMPLE';
    const matches = scanContent(content, "test.json");
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("includes redacted preview", () => {
    const content = '{"key": "sk-ant-api03-abcdefghijklmnopqrstuvwxyz"}';
    const matches = scanContent(content, "test.json");
    expect(matches[0]?.preview).toBeDefined();
    expect(matches[0]?.preview).toContain("…");
  });
});

describe("PII patterns", () => {
  it("detects SSN", () => {
    const content = "ssn: 123-45-6789";
    const matches = scanContent(content, "test.txt");
    expect(matches.some((m) => m.pattern === "SSN")).toBe(true);
    expect(matches[0]?.type).toBe("pii");
  });

  it("detects credit card numbers", () => {
    const content = "card: 4111-1111-1111-1111";
    const matches = scanContent(content, "test.txt");
    expect(matches.some((m) => m.pattern === "Credit card")).toBe(true);
  });

  it("detects email addresses", () => {
    // example.com is a false positive, so use a real-looking domain
    const matches = scanContent("contact: user@company.org", "test.txt");
    expect(matches.some((m) => m.pattern === "Email address")).toBe(true);
  });

  it("detects phone numbers", () => {
    const content = "phone: (555) 123-4567";
    const matches = scanContent(content, "test.txt");
    expect(matches.some((m) => m.pattern === "Phone number")).toBe(true);
  });
});

describe("false positive filtering", () => {
  it("skips CHANGE_ME placeholders", () => {
    expect(isFalsePositive('key: "CHANGE_ME_sk-ant-api03-xxx"')).toBe(true);
  });

  it("skips env var references", () => {
    expect(isFalsePositive("key: ${API_KEY}")).toBe(true);
    expect(isFalsePositive("key: $API_KEY")).toBe(true);
  });

  it("skips process.env references", () => {
    expect(isFalsePositive("const key = process.env.API_KEY")).toBe(true);
  });

  it("skips comments", () => {
    expect(isFalsePositive("// sk-ant-api03-abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(isFalsePositive("# sk-ant-api03-abcdefghijklmnopqrstuvwxyz")).toBe(true);
  });

  it("does not skip real secrets", () => {
    expect(isFalsePositive('"key": "sk-ant-api03-abcdefghijklmnopqrstuvwxyz"')).toBe(false);
  });

  it("filters false positives from scanContent", () => {
    const content = '// Example: sk-ant-api03-abcdefghijklmnopqrstuvwxyz\nreal: sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
    const matches = scanContent(content, "test.json");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.line).toBe(2);
  });
});

describe("isDangerousFilename", () => {
  it("detects .env files", () => {
    expect(isDangerousFilename(".env")).toBe("Dangerous file");
    expect(isDangerousFilename("/path/to/.env")).toBe("Dangerous file");
  });

  it("detects PEM files", () => {
    expect(isDangerousFilename("server.pem")).toBe("Private key file");
    expect(isDangerousFilename("cert.key")).toBe("Private key file");
  });

  it("detects SSH key files", () => {
    expect(isDangerousFilename("id_rsa")).toBe("SSH private key");
    expect(isDangerousFilename("id_ed25519")).toBe("SSH private key");
  });

  it("returns null for safe files", () => {
    expect(isDangerousFilename("config.json")).toBeNull();
    expect(isDangerousFilename("README.md")).toBeNull();
  });
});

describe("redactPreview", () => {
  it("redacts matched pattern", () => {
    const line = 'key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
    const preview = redactPreview(line, "Anthropic API key", /sk-ant-[a-zA-Z0-9_-]{20,}/);
    expect(preview).toContain("…");
    expect(preview).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });
});

describe("scanFiles", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scanner-test-"));
  });

  afterEach(() => {
    // cleanup handled by OS
  });

  it("scans all config files in a directory", async () => {
    await writeFile(
      join(tmpDir, "config.json"),
      '{"key": "sk-ant-api03-abcdefghijklmnopqrstuvwxyz"}',
    );
    await writeFile(join(tmpDir, "clean.json"), '{"name": "agent"}');

    const result = await scanFiles(tmpDir);
    expect(result.filesScanned).toBe(2);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0]?.file).toContain("config.json");
  });

  it("skips .env files for content scanning", async () => {
    await writeFile(
      join(tmpDir, ".env"),
      "API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
    );

    const result = await scanFiles(tmpDir);
    expect(result.filesScanned).toBe(0);
    // But it should still detect .env as a dangerous filename
    expect(result.matches.some((m) => m.type === "filename")).toBe(true);
  });

  it("scans subdirectories", async () => {
    const subDir = join(tmpDir, "sub");
    await mkdir(subDir);
    await writeFile(
      join(subDir, "nested.yml"),
      "key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
    );

    const result = await scanFiles(tmpDir);
    expect(result.matches.some((m) => m.type === "secret")).toBe(true);
  });

  it("returns empty for clean directory", async () => {
    await writeFile(join(tmpDir, "config.json"), '{"clean": true}');

    const result = await scanFiles(tmpDir);
    expect(result.matches).toHaveLength(0);
  });

  it("handles empty directory", async () => {
    const result = await scanFiles(tmpDir);
    expect(result.filesScanned).toBe(0);
    expect(result.matches).toHaveLength(0);
  });

  it("detects dangerous filenames", async () => {
    await writeFile(join(tmpDir, "server.pem"), "cert data");

    const result = await scanFiles(tmpDir);
    expect(result.matches.some((m) => m.type === "filename" && m.pattern === "Private key file")).toBe(true);
  });

  it("detects PII in files", async () => {
    await writeFile(
      join(tmpDir, "data.json"),
      '{"ssn": "123-45-6789", "name": "John"}',
    );

    const result = await scanFiles(tmpDir);
    expect(result.matches.some((m) => m.pattern === "SSN")).toBe(true);
  });
});

describe("formatScanTable", () => {
  it("shows no issues message for clean scan", () => {
    const output = formatScanTable({ matches: [], filesScanned: 5 });
    expect(output).toContain("no issues found");
    expect(output).toContain("5 files");
  });

  it("formats table with findings", () => {
    const output = formatScanTable({
      matches: [
        { file: "config.json", pattern: "Anthropic API key", line: 3, type: "secret", preview: "sk-a…wxyz" },
      ],
      filesScanned: 2,
    });
    expect(output).toContain("config.json");
    expect(output).toContain("Anthropic API key");
    expect(output).toContain("1 secret(s)");
  });

  it("includes history matches in count", () => {
    const output = formatScanTable(
      { matches: [], filesScanned: 1 },
      [{ file: "old.json (abc123)", pattern: "AWS access key", line: 5, type: "secret", preview: "AKIA…MPLE" }],
    );
    expect(output).toContain("1 in git history");
  });
});
