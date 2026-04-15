import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildAllowlistFromBlueprint,
  buildExpectedRules,
  collectIntegrationDomains,
  IPSET_NAME,
  loadAllowlist,
  loadIpsetMeta,
  parseIptablesOutput,
  resolveDomains,
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

  it("merges blueprint and integration entries without duplicates", () => {
    const entries = buildAllowlistFromBlueprint(
      ["api.example.com", "smtp.gmail.com"],
      [
        { domain: "api.telegram.org", port: 443 },
        { domain: "api.example.com", port: 443 }, // duplicate
      ],
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

  it("handles integration-only entries", () => {
    const entries = buildAllowlistFromBlueprint([], [{ domain: "api.anthropic.com", port: 443 }]);
    expect(entries).toHaveLength(1);
    expect(entries[0].domain).toBe("api.anthropic.com");
  });
});

// ── collectIntegrationDomains Tests ────────────────────────────────────────

describe("collectIntegrationDomains", () => {
  it("returns egress entries for known integrations", () => {
    const entries = collectIntegrationDomains(["telegram", "anthropic"]);
    const domains = entries.map((e) => e.domain);
    expect(domains).toContain("api.telegram.org");
    expect(domains).toContain("api.anthropic.com");
    expect(entries.every((e) => e.port === 443)).toBe(true);
  });

  it("returns empty array for integrations with no egress domains and no env", () => {
    const entries = collectIntegrationDomains(["ollama"]);
    expect(entries).toEqual([]);
  });

  it("skips unknown integration names", () => {
    const entries = collectIntegrationDomains(["nonexistent", "telegram"]);
    expect(entries).toHaveLength(1);
    expect(entries[0].domain).toBe("api.telegram.org");
  });

  it("returns empty for empty input", () => {
    expect(collectIntegrationDomains([])).toEqual([]);
  });

  it("handles case-insensitive lookup", () => {
    const entries = collectIntegrationDomains(["Telegram"]);
    expect(entries[0].domain).toBe("api.telegram.org");
  });

  it("collects multiple domains from one integration", () => {
    const entries = collectIntegrationDomains(["onepassword"]);
    const domains = entries.map((e) => e.domain);
    expect(domains).toContain("my.1password.com");
    expect(domains).toContain("events.1password.com");
    expect(entries).toHaveLength(2);
  });

  it("resolves dynamic IMAP/SMTP domains with correct ports from env", () => {
    const entries = collectIntegrationDomains(["email"], {
      IMAP_HOST: "imap.mail.me.com",
      IMAP_PORT: "993",
      SMTP_HOST: "smtp.mail.me.com",
      SMTP_PORT: "587",
      IMAP_USER: "user",
      IMAP_PASS: "pass",
      SMTP_USER: "user",
      SMTP_PASS: "pass",
    });
    const imap = entries.find((e) => e.domain === "imap.mail.me.com");
    const smtp = entries.find((e) => e.domain === "smtp.mail.me.com");
    expect(imap).toBeDefined();
    expect(imap!.port).toBe(993);
    expect(smtp).toBeDefined();
    expect(smtp!.port).toBe(587);
  });

  it("auto-detects integrations from env vars", () => {
    const entries = collectIntegrationDomains([], {
      ANTHROPIC_API_KEY: "sk-ant-test",
      GH_TOKEN: "ghp_test",
    });
    const domains = entries.map((e) => e.domain);
    expect(domains).toContain("api.anthropic.com");
    expect(domains).toContain("api.github.com");
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

// ── resolveDomains Tests ────────────────────────────────────────────────────

describe("resolveDomains", () => {
  it("resolves a real domain to at least one IPv4 address", async () => {
    const result = await resolveDomains(["dns.google"]);
    // dns.google has well-known IPs: 8.8.8.8, 8.8.4.4
    expect(result.v4.length).toBeGreaterThan(0);
  });

  it("deduplicates IPs across duplicate domain entries", async () => {
    const result = await resolveDomains(["dns.google", "dns.google"]);
    // Should deduplicate — same set of IPs
    const unique = new Set(result.v4);
    expect(result.v4.length).toBe(unique.size);
  });

  it("handles non-existent domains gracefully", async () => {
    const result = await resolveDomains(["this-domain-definitely-does-not-exist-clawhq.invalid"]);
    expect(result.v4).toEqual([]);
    expect(result.v6).toEqual([]);
  });

  it("handles mix of valid and invalid domains", async () => {
    const result = await resolveDomains([
      "dns.google",
      "this-domain-definitely-does-not-exist-clawhq.invalid",
    ]);
    // Should still resolve the valid domain
    expect(result.v4.length).toBeGreaterThan(0);
  });

  it("returns empty arrays for empty input", async () => {
    const result = await resolveDomains([]);
    expect(result.v4).toEqual([]);
    expect(result.v6).toEqual([]);
  });
});

// ── buildExpectedRules (ipset-based) Tests ──────────────────────────────────

describe("buildExpectedRules (ipset-based)", () => {
  it("includes ipset match rule for allowlisted domains", () => {
    const rules = buildExpectedRules(
      [{ domain: "api.example.com", port: 443 }],
      false,
    );

    // Should have: ESTABLISHED, DNS(udp), DNS(tcp), ipset match for port 443, LOG, DROP
    expect(rules).toHaveLength(6);

    const ipsetRule = rules.find((r) => r.extra.includes("match-set"));
    expect(ipsetRule).toBeDefined();
    expect(ipsetRule!.extra).toContain(`match-set ${IPSET_NAME} dst`);
    expect(ipsetRule!.dport).toBe("443");
    expect(ipsetRule!.destination).toBe("0.0.0.0/0");
  });

  it("creates one ipset match rule per unique port", () => {
    const rules = buildExpectedRules(
      [
        { domain: "api.example.com", port: 443 },
        { domain: "smtp.gmail.com", port: 587 },
        { domain: "api.other.com", port: 443 }, // duplicate port
      ],
      false,
    );

    const ipsetRules = rules.filter((r) => r.extra.includes("match-set"));
    expect(ipsetRules).toHaveLength(2); // one for 443, one for 587
    expect(ipsetRules.map((r) => r.dport).sort()).toEqual(["443", "587"]);
  });

  it("has no ipset rules in air-gap mode", () => {
    const rules = buildExpectedRules(
      [{ domain: "api.example.com", port: 443 }],
      true,
    );

    const ipsetRules = rules.filter((r) => r.extra.includes("match-set"));
    expect(ipsetRules).toHaveLength(0);

    // Air-gap: ESTABLISHED + LOG + DROP only
    expect(rules).toHaveLength(3);
  });

  it("has no DNS rules in air-gap mode", () => {
    const rules = buildExpectedRules([], true);

    const dnsRules = rules.filter((r) => r.dport === "53");
    expect(dnsRules).toHaveLength(0);
  });
});

// ── parseIptablesOutput + ipset verification ────────────────────────────────

describe("destination comparison in verification (ipset-based)", () => {
  it("parseIptablesOutput extracts destination from iptables output", () => {
    const output = [
      "Chain CLAWHQ_FWD (1 references)",
      "num   target     prot opt source               destination",
      "1     ACCEPT     tcp  --  0.0.0.0/0            0.0.0.0/0            match-set clawhq_egress dst tcp dpt:443",
      "2     DROP       all  --  0.0.0.0/0            0.0.0.0/0",
    ].join("\n");

    const rules = parseIptablesOutput(output);
    expect(rules).toHaveLength(2);
    expect(rules[0].destination).toBe("0.0.0.0/0");
    expect(rules[0].dport).toBe("443");
    expect(rules[1].target).toBe("DROP");
  });
});

// ── Ipset Metadata Tests ────────────────────────────────────────────────────

describe("loadIpsetMeta", () => {
  it("loads valid metadata", async () => {
    const meta = {
      lastRefreshed: "2026-03-30T15:00:00.000Z",
      refreshIntervalMs: 300000,
      domains: ["api.example.com", "smtp.gmail.com"],
      resolvedV4: 4,
      resolvedV6: 2,
      setName: "clawhq_egress",
      setNameV6: "clawhq_egress_v6",
    };
    await writeFile(
      join(testDir, "ops", "firewall", "ipset-meta.json"),
      JSON.stringify(meta, null, 2),
      "utf-8",
    );

    const loaded = await loadIpsetMeta(testDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.lastRefreshed).toBe("2026-03-30T15:00:00.000Z");
    expect(loaded!.domains).toEqual(["api.example.com", "smtp.gmail.com"]);
    expect(loaded!.resolvedV4).toBe(4);
    expect(loaded!.resolvedV6).toBe(2);
  });

  it("returns null when metadata file doesn't exist", async () => {
    const loaded = await loadIpsetMeta(testDir);
    expect(loaded).toBeNull();
  });

  it("returns null for invalid JSON", async () => {
    await writeFile(
      join(testDir, "ops", "firewall", "ipset-meta.json"),
      "not json",
      "utf-8",
    );

    const loaded = await loadIpsetMeta(testDir);
    expect(loaded).toBeNull();
  });
});

// ── Stale Detection Tests ───────────────────────────────────────────────────

describe("stale ipset detection", () => {
  it("identifies fresh metadata (within threshold)", async () => {
    const meta = {
      lastRefreshed: new Date().toISOString(),
      refreshIntervalMs: 300000, // 5 min
      domains: ["api.example.com"],
      resolvedV4: 2,
      resolvedV6: 0,
      setName: "clawhq_egress",
      setNameV6: "clawhq_egress_v6",
    };
    await writeFile(
      join(testDir, "ops", "firewall", "ipset-meta.json"),
      JSON.stringify(meta),
      "utf-8",
    );

    const loaded = await loadIpsetMeta(testDir);
    expect(loaded).not.toBeNull();
    const ageMs = Date.now() - new Date(loaded!.lastRefreshed).getTime();
    const staleThresholdMs = loaded!.refreshIntervalMs * 2;
    expect(ageMs).toBeLessThan(staleThresholdMs);
  });

  it("identifies stale metadata (beyond threshold)", async () => {
    const staleDate = new Date(Date.now() - 20 * 60 * 1000); // 20 minutes ago
    const meta = {
      lastRefreshed: staleDate.toISOString(),
      refreshIntervalMs: 300000, // 5 min → stale threshold = 10 min
      domains: ["api.example.com"],
      resolvedV4: 2,
      resolvedV6: 0,
      setName: "clawhq_egress",
      setNameV6: "clawhq_egress_v6",
    };
    await writeFile(
      join(testDir, "ops", "firewall", "ipset-meta.json"),
      JSON.stringify(meta),
      "utf-8",
    );

    const loaded = await loadIpsetMeta(testDir);
    expect(loaded).not.toBeNull();
    const ageMs = Date.now() - new Date(loaded!.lastRefreshed).getTime();
    const staleThresholdMs = loaded!.refreshIntervalMs * 2; // 10 min
    expect(ageMs).toBeGreaterThan(staleThresholdMs);
  });

  it("detects domain mismatch between metadata and allowlist", async () => {
    // Metadata has domains A, B
    const meta = {
      lastRefreshed: new Date().toISOString(),
      refreshIntervalMs: 300000,
      domains: ["api.example.com", "old.example.com"],
      resolvedV4: 4,
      resolvedV6: 0,
      setName: "clawhq_egress",
      setNameV6: "clawhq_egress_v6",
    };
    await writeFile(
      join(testDir, "ops", "firewall", "ipset-meta.json"),
      JSON.stringify(meta),
      "utf-8",
    );

    // Allowlist has domains A, C (different from metadata)
    await writeFile(
      join(testDir, "ops", "firewall", "allowlist.yaml"),
      `- domain: api.example.com
  port: 443
- domain: new.example.com
  port: 443
`,
      "utf-8",
    );

    const loaded = await loadIpsetMeta(testDir);
    const allowlist = await (await import("./firewall.js")).loadAllowlist(testDir);
    const currentDomains = allowlist.map((e) => e.domain).sort();
    const metaDomains = [...loaded!.domains].sort();

    expect(JSON.stringify(currentDomains)).not.toBe(JSON.stringify(metaDomains));
  });
});
