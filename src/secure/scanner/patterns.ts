/**
 * Secret and PII detection patterns with false-positive filtering.
 *
 * Each pattern includes a regex, category, severity, and description.
 * False-positive filters prevent comments, placeholders, and example values
 * from polluting scan results — users must trust the output, not ignore it.
 */

import type { FindingCategory, FindingSeverity } from "./types.js";

// ── Pattern Definition ──────────────────────────────────────────────────────

export interface SecretPattern {
  readonly id: string;
  readonly pattern: RegExp;
  readonly category: FindingCategory;
  readonly severity: FindingSeverity;
  readonly description: string;
}

// ── Secret Patterns ─────────────────────────────────────────────────────────

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  // API keys — provider-specific patterns
  {
    id: "aws-access-key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    category: "api-key",
    severity: "critical",
    description: "AWS access key ID",
  },
  {
    id: "aws-secret-key",
    pattern: /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g,
    category: "api-key",
    severity: "critical",
    description: "Possible AWS secret access key",
  },
  {
    id: "anthropic-key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    category: "api-key",
    severity: "critical",
    description: "Anthropic API key",
  },
  {
    id: "openai-key",
    pattern: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
    category: "api-key",
    severity: "critical",
    description: "OpenAI API key",
  },
  {
    id: "github-token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/g,
    category: "token",
    severity: "critical",
    description: "GitHub token",
  },
  {
    id: "slack-token",
    pattern: /\bxox[bporas]-[A-Za-z0-9-]{10,}\b/g,
    category: "token",
    severity: "critical",
    description: "Slack token",
  },
  {
    id: "stripe-key",
    pattern: /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
    category: "api-key",
    severity: "critical",
    description: "Stripe API key",
  },
  {
    id: "telegram-token",
    pattern: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g,
    category: "token",
    severity: "high",
    description: "Telegram bot token",
  },
  {
    id: "generic-api-key",
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?([A-Za-z0-9_\-/.]{16,})["']?/gi,
    category: "api-key",
    severity: "high",
    description: "Generic API key assignment",
  },

  // Passwords and secrets
  {
    id: "password-assignment",
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*["']([^"'\s]{8,})["']/gi,
    category: "password",
    severity: "high",
    description: "Password assignment",
  },
  {
    id: "secret-assignment",
    pattern: /(?:secret|private[_-]?key|signing[_-]?key)\s*[:=]\s*["']([^"'\s]{8,})["']/gi,
    category: "generic-secret",
    severity: "high",
    description: "Secret value assignment",
  },
  {
    id: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9_\-.~+/]+=*\b/g,
    category: "token",
    severity: "high",
    description: "Bearer token",
  },
  {
    id: "basic-auth",
    pattern: /\bBasic\s+[A-Za-z0-9+/]{20,}={0,2}\b/g,
    category: "token",
    severity: "high",
    description: "Basic auth credentials",
  },

  // Private keys
  {
    id: "private-key-header",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    category: "private-key",
    severity: "critical",
    description: "Private key",
  },

  // Connection strings
  {
    id: "connection-string",
    pattern: /(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp)s?:\/\/[^\s"']{10,}/gi,
    category: "connection-string",
    severity: "high",
    description: "Database connection string",
  },

  // PII patterns
  {
    id: "pii-email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    category: "pii-email",
    severity: "medium",
    description: "Email address",
  },
  {
    id: "pii-phone",
    pattern: /\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    category: "pii-phone",
    severity: "medium",
    description: "Phone number",
  },
  {
    id: "pii-ssn",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    category: "pii-ssn",
    severity: "critical",
    description: "Social Security number",
  },
  {
    id: "pii-credit-card",
    pattern: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,
    category: "pii-credit-card",
    severity: "critical",
    description: "Credit card number",
  },
];

// ── False-Positive Filters ──────────────────────────────────────────────────

/** Domains/values that indicate placeholder or example data, not real secrets. */
const PLACEHOLDER_DOMAINS = [
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "localhost",
  "placeholder",
  "your-",
  "my-",
  "<your",
  "{your",
  "CHANGEME",
  "changeme",
  "TODO",
  "FIXME",
  "xxx",
  "XXX",
  "yyy",
  "YYY",
  "zzz",
  "ZZZ",
  "1234567890",
  "0000000000",
  "abcdef",
  "ABCDEF",
  "000-00-0000",
  "123-45-6789",
  "4111111111111111",
  "5500000000000004",
  "555-555-5555",
  "555-0100",
  "user@",
  "admin@",
  "test@",
  "noreply@",
  "no-reply@",
  "foo@",
  "bar@",
];

/** Line-level patterns that indicate the match is in a comment or doc. */
const COMMENT_PATTERNS = [
  /^\s*\/\//,   // JS/TS single-line comment
  /^\s*#/,      // Shell/Python/YAML comment
  /^\s*\*/,     // JSDoc continuation
  /^\s*<!--/,   // HTML comment
  /^\s*\*\//,   // Block comment end
];

/** File extensions that are unlikely to contain real secrets. */
const SKIP_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".lock",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".map",
]);

/** Files that should never be scanned. */
const SKIP_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  ".gitignore",
  ".gitattributes",
  "LICENSE",
  "CHANGELOG.md",
]);

/** Directories to skip during recursive walk. */
export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".cache",
  "__pycache__",
  ".tox",
  "vendor",
]);

/**
 * Check whether a matched value is a false positive.
 *
 * Returns true if the match should be suppressed.
 */
export function isFalsePositive(
  patternId: string,
  matchedValue: string,
  line: string,
): boolean {
  const trimmedLine = line.trim();

  // Comments are not secrets
  for (const cp of COMMENT_PATTERNS) {
    if (cp.test(trimmedLine)) return true;
  }

  // Provider-specific tokens with known prefixes are unlikely to be placeholders
  const PROVIDER_PREFIXES = ["sk-ant-", "sk-proj-", "sk-", "ghp_", "gho_", "ghu_", "ghs_", "ghr_", "xox", "pk_", "sk_"];
  const isProviderToken = PROVIDER_PREFIXES.some((p) => matchedValue.startsWith(p));

  // Placeholder values
  const lowerMatch = matchedValue.toLowerCase();
  const lowerLine = line.toLowerCase();
  for (const placeholder of PLACEHOLDER_DOMAINS) {
    const lowerPlaceholder = placeholder.toLowerCase();
    // For provider tokens, only check if the ENTIRE value equals a placeholder
    if (isProviderToken) {
      if (lowerMatch === lowerPlaceholder) return true;
    } else {
      if (lowerMatch.includes(lowerPlaceholder)) return true;
    }
    if (lowerLine.includes(lowerPlaceholder) && patternId.startsWith("pii-")) return true;
  }

  // Suppress generic AWS secret key pattern — too noisy without AKIA nearby
  if (patternId === "aws-secret-key") {
    if (!/AKIA/.test(line)) return true;
  }

  // Email: skip if in an import, require, or URL pattern
  if (patternId === "pii-email") {
    if (/(?:import|require|from)\s/.test(line)) return true;
    if (/https?:\/\//.test(line)) return true;
    // Skip package.json-style author fields with common domains
    if (/@(?:gmail|yahoo|hotmail|outlook|icloud)\.com/.test(matchedValue)) {
      // Only flag real-looking emails, not in code contexts
      if (/["'].*@.*["']/.test(line) && !/(?:author|email|contact)/i.test(line)) return true;
    }
  }

  // Phone: common false positives in version strings, timestamps, port numbers
  if (patternId === "pii-phone") {
    if (/\d+\.\d+\.\d+/.test(matchedValue)) return true;
    if (/:\d{4}/.test(line)) return true; // port numbers
  }

  // Credit card: Luhn check to avoid false positives on random 16-digit numbers
  if (patternId === "pii-credit-card") {
    const digits = matchedValue.replace(/[- ]/g, "");
    if (!luhnCheck(digits)) return true;
  }

  return false;
}

/** Luhn algorithm to validate credit card numbers. */
function luhnCheck(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

/**
 * Check whether a file should be skipped based on name/extension.
 */
export function shouldSkipFile(filename: string): boolean {
  if (SKIP_FILES.has(filename)) return true;
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return SKIP_EXTENSIONS.has(ext);
}
