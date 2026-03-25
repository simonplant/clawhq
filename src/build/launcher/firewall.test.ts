import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildAllowlistFromBlueprint,
  buildExpectedRules,
  loadAllowlist,
  parseIptablesOutput,
  rulesMatch,
  serializeAllowlist,
} from "./firewall.js";
import type { FirewallRuleDescriptor } from "./firewall.js";

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

// ── buildAllowlistFromBlueprint Tests ──────────────────────────────────────

describe("buildAllowlistFromBlueprint", () => {
  it("converts blueprint egress_domains to allowlist entries", () => {
    const entries = buildAllowlistFromBlueprint([
      "imap.gmail.com",
      "smtp.gmail.com",
      "api.todoist.com",
    ]);

    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ domain: "imap.gmail.com", port: 443 });
    expect(entries[1]).toEqual({ domain: "smtp.gmail.com", port: 443 });
    expect(entries[2]).toEqual({ domain: "api.todoist.com", port: 443 });
  });

  it("merges blueprint and integration domains without duplicates", () => {
    const entries = buildAllowlistFromBlueprint(
      ["api.example.com", "smtp.gmail.com"],
      ["api.telegram.org", "api.example.com"], // api.example.com is a duplicate
    );

    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.domain)).toEqual([
      "api.example.com",
      "smtp.gmail.com",
      "api.telegram.org",
    ]);
  });

  it("returns empty array for empty domains", () => {
    const entries = buildAllowlistFromBlueprint([]);
    expect(entries).toEqual([]);
  });

  it("handles integration-only domains", () => {
    const entries = buildAllowlistFromBlueprint([], ["api.anthropic.com"]);
    expect(entries).toHaveLength(1);
    expect(entries[0].domain).toBe("api.anthropic.com");
  });
});

// ── serializeAllowlist Tests ───────────────────────────────────────────────

describe("serializeAllowlist", () => {
  it("serializes entries to YAML", () => {
    const yaml = serializeAllowlist([
      { domain: "api.example.com", port: 443 },
      { domain: "smtp.gmail.com", port: 587, comment: "Email" },
    ]);

    expect(yaml).toContain("domain: api.example.com");
    expect(yaml).toContain("port: 443");
    expect(yaml).toContain("domain: smtp.gmail.com");
    expect(yaml).toContain("port: 587");
    expect(yaml).toContain("comment: Email");
  });

  it("produces air-gap comment for empty allowlist", () => {
    const yaml = serializeAllowlist([]);
    expect(yaml).toContain("air-gap");
    expect(yaml).toContain("[]");
  });

  it("round-trips through loadAllowlist", async () => {
    const original = [
      { domain: "api.example.com", port: 443 },
      { domain: "smtp.gmail.com", port: 587 },
    ];

    const yaml = serializeAllowlist(original);
    await writeFile(join(testDir, "ops", "firewall", "allowlist.yaml"), yaml, "utf-8");

    const loaded = await loadAllowlist(testDir);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].domain).toBe("api.example.com");
    expect(loaded[0].port).toBe(443);
    expect(loaded[1].domain).toBe("smtp.gmail.com");
    expect(loaded[1].port).toBe(587);
  });
});

// ── rulesMatch Tests ──────────────────────────────────────────────────────

describe("rulesMatch", () => {
  const baseRule: FirewallRuleDescriptor = {
    target: "ACCEPT",
    protocol: "tcp",
    destination: "10.0.0.1",
    dport: "443",
    extra: "tcp dpt:443",
  };

  it("matches identical rules", () => {
    expect(rulesMatch(baseRule, { ...baseRule })).toBe(true);
  });

  it("does not match rules with different destinations but same port", () => {
    const other: FirewallRuleDescriptor = { ...baseRule, destination: "10.0.0.2" };
    expect(rulesMatch(baseRule, other)).toBe(false);
  });

  it("does not match rules with different ports but same destination", () => {
    const other: FirewallRuleDescriptor = { ...baseRule, dport: "587" };
    expect(rulesMatch(baseRule, other)).toBe(false);
  });

  it("does not match rules with different protocols", () => {
    const other: FirewallRuleDescriptor = { ...baseRule, protocol: "udp" };
    expect(rulesMatch(baseRule, other)).toBe(false);
  });

  it("does not match rules with different targets", () => {
    const other: FirewallRuleDescriptor = { ...baseRule, target: "DROP" };
    expect(rulesMatch(baseRule, other)).toBe(false);
  });

  it("ignores extra field differences", () => {
    const other: FirewallRuleDescriptor = { ...baseRule, extra: "different extra" };
    expect(rulesMatch(baseRule, other)).toBe(true);
  });
});

// ── parseIptablesOutput + buildExpectedRules + verifyFirewall destination tests ─

describe("destination comparison in verification", () => {
  it("buildExpectedRules includes destination for allowlisted domains", () => {
    const rules = buildExpectedRules(
      [{ domain: "api.example.com", port: 443 }, { domain: "smtp.gmail.com", port: 587 }],
      false,
    );

    const apiRule = rules.find((r) => r.destination === "api.example.com");
    const smtpRule = rules.find((r) => r.destination === "smtp.gmail.com");

    expect(apiRule).toBeDefined();
    expect(apiRule!.dport).toBe("443");
    expect(smtpRule).toBeDefined();
    expect(smtpRule!.dport).toBe("587");
  });

  it("parseIptablesOutput extracts destination from iptables output", () => {
    const output = [
      "Chain CLAWHQ_FWD (1 references)",
      "num   target     prot opt source               destination",
      "1     ACCEPT     tcp  --  0.0.0.0/0            10.0.0.1             tcp dpt:443",
      "2     ACCEPT     tcp  --  0.0.0.0/0            10.0.0.2             tcp dpt:443",
    ].join("\n");

    const rules = parseIptablesOutput(output);
    expect(rules).toHaveLength(2);
    expect(rules[0].destination).toBe("10.0.0.1");
    expect(rules[1].destination).toBe("10.0.0.2");
  });

  it("detects wrong destination when same port exists for different IP", () => {
    // Expected: allow tcp to api.example.com:443
    const expected = buildExpectedRules([{ domain: "api.example.com", port: 443 }], false);

    // Live: has a rule for wrong-ip.example.com:443 instead
    const liveOutput = [
      "Chain CLAWHQ_FWD (1 references)",
      "num   target     prot opt source               destination",
      "1     ACCEPT     all  --  0.0.0.0/0            0.0.0.0/0            ctstate RELATED,ESTABLISHED",
      "2     ACCEPT     udp  --  0.0.0.0/0            0.0.0.0/0            udp dpt:53",
      "3     ACCEPT     tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpt:53",
      "4     ACCEPT     tcp  --  0.0.0.0/0            wrong-ip.example.com tcp dpt:443",
      "5     LOG        all  --  0.0.0.0/0            0.0.0.0/0            LOG flags 0 level 4 prefix \"CLAWHQ_DROP: \"",
      "6     DROP       all  --  0.0.0.0/0            0.0.0.0/0",
    ].join("\n");

    const liveRules = parseIptablesOutput(liveOutput);

    // The expected rule for api.example.com should be missing
    const missing = expected.filter((e) => !liveRules.some((l) => rulesMatch(e, l)));
    const extra = liveRules.filter((l) => !expected.some((e) => rulesMatch(e, l)));

    // api.example.com rule is missing (wrong destination doesn't match)
    expect(missing.some((r) => r.destination === "api.example.com")).toBe(true);
    // wrong-ip.example.com rule is extra
    expect(extra.some((r) => r.destination === "wrong-ip.example.com")).toBe(true);
  });
});
