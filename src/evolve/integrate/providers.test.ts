import { describe, expect, it } from "vitest";

import {
  findCategory,
  findProvider,
  getIntegrationEgressDomains,
  INTEGRATION_CATEGORIES,
} from "./providers.js";

describe("INTEGRATION_CATEGORIES", () => {
  it("defines all expected categories", () => {
    const categories = INTEGRATION_CATEGORIES.map((c) => c.category);
    expect(categories).toContain("messaging");
    expect(categories).toContain("email");
    expect(categories).toContain("calendar");
    expect(categories).toContain("tasks");
    expect(categories).toContain("code");
    expect(categories).toContain("research");
  });

  it("each category has at least one provider", () => {
    for (const cat of INTEGRATION_CATEGORIES) {
      expect(cat.providers.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("each provider has required fields", () => {
    for (const cat of INTEGRATION_CATEGORIES) {
      for (const prov of cat.providers) {
        expect(prov.provider).toBeTruthy();
        expect(prov.label).toBeTruthy();
        expect(prov.envVar).toBeTruthy();
        expect(prov.promptLabel).toBeTruthy();
        expect(Array.isArray(prov.egressDomains)).toBe(true);
      }
    }
  });
});

describe("findCategory", () => {
  it("finds existing category", () => {
    const cat = findCategory("email");
    expect(cat?.category).toBe("email");
    expect(cat?.label).toBe("Email");
  });

  it("returns undefined for unknown category", () => {
    expect(findCategory("nonexistent")).toBeUndefined();
  });
});

describe("findProvider", () => {
  it("finds provider within category", () => {
    const prov = findProvider("calendar", "caldav");
    expect(prov?.provider).toBe("caldav");
    expect(prov?.envVar).toBe("CALDAV_PASSWORD");
  });

  it("returns undefined for unknown provider", () => {
    expect(findProvider("calendar", "outlook")).toBeUndefined();
  });

  it("returns undefined for unknown category", () => {
    expect(findProvider("nonexistent", "foo")).toBeUndefined();
  });
});

describe("getIntegrationEgressDomains", () => {
  it("collects domains from multiple integrations", () => {
    const domains = getIntegrationEgressDomains([
      { category: "messaging", provider: "telegram" },
      { category: "calendar", provider: "google-calendar" },
    ]);

    expect(domains).toContain("api.telegram.org");
    expect(domains).toContain("www.googleapis.com");
    expect(domains).toContain("oauth2.googleapis.com");
  });

  it("deduplicates domains", () => {
    const domains = getIntegrationEgressDomains([
      { category: "messaging", provider: "telegram" },
      { category: "messaging", provider: "telegram" }, // duplicate
    ]);

    const telegramCount = domains.filter((d) => d === "api.telegram.org").length;
    expect(telegramCount).toBe(1);
  });

  it("returns empty for integrations with no egress domains", () => {
    const domains = getIntegrationEgressDomains([
      { category: "email", provider: "imap" },
    ]);
    expect(domains).toEqual([]);
  });

  it("returns empty for unknown integrations", () => {
    const domains = getIntegrationEgressDomains([
      { category: "unknown", provider: "foo" },
    ]);
    expect(domains).toEqual([]);
  });
});
