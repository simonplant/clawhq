import { describe, expect, it } from "vitest";

import { renderDnsmasqConf } from "./dnsmasq.js";
import type { FirewallAllowEntry } from "./types.js";

describe("renderDnsmasqConf", () => {
  it("emits one ipset= line per allowlisted FQDN, sorted and deduped", () => {
    const allowlist: FirewallAllowEntry[] = [
      { domain: "api.tradier.com", port: 443 },
      { domain: "smtp.gmail.com", port: 587 },
      { domain: "api.tradier.com", port: 80 }, // dup domain, different port
      { domain: "api.openai.com", port: 443 },
    ];
    const conf = renderDnsmasqConf(allowlist, "172.28.0.1");
    const ipsetLines = conf.split("\n").filter((l) => l.startsWith("ipset="));
    expect(ipsetLines).toEqual([
      "ipset=/api.openai.com/clawhq_egress,clawhq_egress_v6",
      "ipset=/api.tradier.com/clawhq_egress,clawhq_egress_v6",
      "ipset=/smtp.gmail.com/clawhq_egress,clawhq_egress_v6",
    ]);
  });

  it("pins listen-address and uses IP-literal upstreams (no bootstrap dependency)", () => {
    const conf = renderDnsmasqConf([{ domain: "x.example.com", port: 443 }], "10.42.0.1");
    expect(conf).toContain("listen-address=10.42.0.1");
    expect(conf).toContain("bind-interfaces");
    expect(conf).toContain("no-resolv");
    expect(conf).toContain("server=1.1.1.1");
    expect(conf).toContain("server=8.8.8.8");
    // Must NOT use a hostname-based upstream — would chicken-and-egg dnsmasq.
    expect(conf).not.toMatch(/server=[a-z]/);
  });

  it("skips unresolvable entries (IP literals, empty, paths) without poisoning the config", () => {
    const allowlist: FirewallAllowEntry[] = [
      { domain: "valid.example.com", port: 443 },
      { domain: "192.0.2.1", port: 443 }, // IP literal — useless
      { domain: "", port: 443 }, // empty
      { domain: "no-dot", port: 443 }, // bare hostname
      { domain: ".leading-dot.com", port: 443 },
      { domain: "has space.com", port: 443 },
      { domain: "https://api.example.com/path", port: 443 },
    ];
    const conf = renderDnsmasqConf(allowlist, "172.28.0.1");
    const ipsetLines = conf.split("\n").filter((l) => l.startsWith("ipset="));
    expect(ipsetLines).toEqual([
      "ipset=/valid.example.com/clawhq_egress,clawhq_egress_v6",
    ]);
  });

  it("emits a placeholder comment when allowlist is empty (still valid dnsmasq.conf)", () => {
    const conf = renderDnsmasqConf([], "172.28.0.1");
    expect(conf).toContain("listen-address=172.28.0.1");
    // No ipset= lines, but config must still be parseable.
    expect(conf.split("\n").filter((l) => l.startsWith("ipset="))).toHaveLength(0);
    expect(conf).toContain("(no allowlisted domains");
  });

  it("respects custom ipset names (forward-compat for renamed sets)", () => {
    const conf = renderDnsmasqConf(
      [{ domain: "api.example.com", port: 443 }],
      "172.28.0.1",
      "custom_v4",
      "custom_v6",
    );
    expect(conf).toContain("ipset=/api.example.com/custom_v4,custom_v6");
  });
});
