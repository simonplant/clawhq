import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadAllowlist } from "./firewall.js";

// ── Test Fixtures ───────────────────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `clawhq-fw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(testDir, "ops", "firewall"), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ── loadAllowlist Tests ────────────────────────────────────────────────────

describe("loadAllowlist", () => {
  it("parses standard allowlist entries", async () => {
    await writeFile(
      join(testDir, "ops", "firewall", "allowlist.yaml"),
      `- domain: api.example.com
  port: 443
  comment: Example API
- domain: smtp.gmail.com
  port: 587
  comment: Email
`,
      "utf-8",
    );

    const entries = await loadAllowlist(testDir);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ domain: "api.example.com", port: 443, comment: "Example API" });
    expect(entries[1]).toEqual({ domain: "smtp.gmail.com", port: 587, comment: "Email" });
  });

  it("defaults port to 443 when omitted", async () => {
    await writeFile(
      join(testDir, "ops", "firewall", "allowlist.yaml"),
      `- domain: api.example.com\n`,
      "utf-8",
    );

    const entries = await loadAllowlist(testDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].port).toBe(443);
    expect(entries[0].comment).toBeUndefined();
  });

  it("handles quoted domain values", async () => {
    await writeFile(
      join(testDir, "ops", "firewall", "allowlist.yaml"),
      `- domain: "api.example.com"
  port: 443
- domain: 'smtp.example.com'
  port: 587
`,
      "utf-8",
    );

    const entries = await loadAllowlist(testDir);
    expect(entries).toHaveLength(2);
    expect(entries[0].domain).toBe("api.example.com");
    expect(entries[1].domain).toBe("smtp.example.com");
  });

  it("handles YAML comments", async () => {
    await writeFile(
      join(testDir, "ops", "firewall", "allowlist.yaml"),
      `# Finance API integrations
- domain: api.yahoo.com
  port: 443
  comment: Market data # inline comment
# Email
- domain: smtp.gmail.com
  port: 587
`,
      "utf-8",
    );

    const entries = await loadAllowlist(testDir);
    expect(entries).toHaveLength(2);
    expect(entries[0].domain).toBe("api.yahoo.com");
    expect(entries[0].comment).toBe("Market data");
    expect(entries[1].domain).toBe("smtp.gmail.com");
  });

  it("returns empty array for empty file", async () => {
    await writeFile(join(testDir, "ops", "firewall", "allowlist.yaml"), "", "utf-8");

    const entries = await loadAllowlist(testDir);
    expect(entries).toEqual([]);
  });

  it("returns empty array when file does not exist", async () => {
    const entries = await loadAllowlist(testDir);
    expect(entries).toEqual([]);
  });

  it("returns empty array for non-array YAML", async () => {
    await writeFile(
      join(testDir, "ops", "firewall", "allowlist.yaml"),
      `domains:
  - api.example.com
`,
      "utf-8",
    );

    const entries = await loadAllowlist(testDir);
    expect(entries).toEqual([]);
  });

  it("skips entries without domain field", async () => {
    await writeFile(
      join(testDir, "ops", "firewall", "allowlist.yaml"),
      `- domain: api.example.com
  port: 443
- port: 587
- domain: smtp.example.com
`,
      "utf-8",
    );

    const entries = await loadAllowlist(testDir);
    expect(entries).toHaveLength(2);
    expect(entries[0].domain).toBe("api.example.com");
    expect(entries[1].domain).toBe("smtp.example.com");
  });

  it("handles inline list syntax", async () => {
    await writeFile(
      join(testDir, "ops", "firewall", "allowlist.yaml"),
      `[{domain: api.example.com, port: 443}, {domain: smtp.example.com, port: 587}]`,
      "utf-8",
    );

    const entries = await loadAllowlist(testDir);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ domain: "api.example.com", port: 443, comment: undefined });
    expect(entries[1]).toEqual({ domain: "smtp.example.com", port: 587, comment: undefined });
  });
});
