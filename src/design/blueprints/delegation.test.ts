import { describe, expect, it } from "vitest";

import { matchGlob } from "./delegation-types.js";
import {
  APPOINTMENT_CONFIRM,
  EMAIL_DELEGATION_DEFAULTS,
  UNSUBSCRIBE,
  VENDOR_REPLY,
} from "./delegation-defaults.js";
import { loadBlueprint } from "./loader.js";
import { validateBlueprint } from "./validate.js";
import { parse as parseYaml } from "yaml";

// ── matchGlob Tests ─────────────────────────────────────────────────────────

describe("matchGlob", () => {
  it("matches exact strings", () => {
    expect(matchGlob("email:send:reply", "email:send:reply")).toBe(true);
    expect(matchGlob("email:send:reply", "email:send:forward")).toBe(false);
  });

  it("matches wildcard *", () => {
    expect(matchGlob("anything", "*")).toBe(true);
    expect(matchGlob("", "*")).toBe(true);
  });

  it("matches trailing wildcard", () => {
    expect(matchGlob("email:send:reply", "email:send:*")).toBe(true);
    expect(matchGlob("email:send:forward", "email:send:*")).toBe(true);
    expect(matchGlob("calendar:update", "email:send:*")).toBe(false);
  });

  it("matches leading wildcard", () => {
    expect(matchGlob("user@company.com", "*@company.com")).toBe(true);
    expect(matchGlob("user@other.com", "*@company.com")).toBe(false);
  });

  it("matches middle wildcard", () => {
    expect(matchGlob("email:send:reply", "email:*:reply")).toBe(true);
    expect(matchGlob("email:draft:reply", "email:*:reply")).toBe(true);
    expect(matchGlob("email:send:forward", "email:*:reply")).toBe(false);
  });

  it("matches multiple wildcards", () => {
    expect(matchGlob("email:send:reply", "*:*:*")).toBe(true);
    expect(matchGlob("a:b:c", "*:*:*")).toBe(true);
  });

  it("handles regex special characters in patterns", () => {
    expect(matchGlob("file.txt", "file.txt")).toBe(true);
    expect(matchGlob("file.txt", "file.*")).toBe(true);
    expect(matchGlob("file(1).txt", "file(1).*")).toBe(true);
  });
});

// ── Email Delegation Defaults ───────────────────────────────────────────────

describe("email delegation defaults", () => {
  it("APPOINTMENT_CONFIRM has correct structure", () => {
    expect(APPOINTMENT_CONFIRM.id).toBe("appointment-confirm");
    expect(APPOINTMENT_CONFIRM.tool).toBe("email");
    expect(APPOINTMENT_CONFIRM.rules.length).toBeGreaterThan(0);
    for (const rule of APPOINTMENT_CONFIRM.rules) {
      expect(rule.action).toBeTruthy();
      expect(["execute", "propose", "approve"]).toContain(rule.tier);
      expect(rule.description).toBeTruthy();
    }
  });

  it("VENDOR_REPLY has correct structure", () => {
    expect(VENDOR_REPLY.id).toBe("vendor-reply");
    expect(VENDOR_REPLY.tool).toBe("email");
    expect(VENDOR_REPLY.rules.length).toBeGreaterThan(0);
  });

  it("UNSUBSCRIBE has correct structure", () => {
    expect(UNSUBSCRIBE.id).toBe("unsubscribe");
    expect(UNSUBSCRIBE.tool).toBe("email");
    expect(UNSUBSCRIBE.rules.length).toBeGreaterThan(0);
  });

  it("EMAIL_DELEGATION_DEFAULTS contains all three categories", () => {
    expect(EMAIL_DELEGATION_DEFAULTS).toHaveLength(3);
    const ids = EMAIL_DELEGATION_DEFAULTS.map((c) => c.id);
    expect(ids).toContain("appointment-confirm");
    expect(ids).toContain("vendor-reply");
    expect(ids).toContain("unsubscribe");
  });

  it("all defaults have unique category IDs", () => {
    const ids = EMAIL_DELEGATION_DEFAULTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rules with match conditions have valid structure", () => {
    for (const category of EMAIL_DELEGATION_DEFAULTS) {
      for (const rule of category.rules) {
        if (rule.match) {
          for (const condition of rule.match) {
            expect(condition.field).toBeTruthy();
            expect(condition.pattern).toBeTruthy();
          }
        }
      }
    }
  });
});

// ── Blueprint Validation with delegation_rules ──────────────────────────────

describe("delegation_rules validation", () => {
  it("email-manager blueprint validates with delegation_rules", () => {
    const loaded = loadBlueprint("email-manager");
    expect(loaded.blueprint.delegation_rules).toBeDefined();
    expect(loaded.blueprint.delegation_rules!.categories.length).toBeGreaterThan(0);
  });

  it("validates delegation_rules categories have required fields", () => {
    const raw = {
      name: "Test",
      version: "1.0.0",
      delegation_rules: {
        categories: [
          { id: "test", name: "Test", tool: "email", rules: [] },
        ],
      },
    };
    const report = validateBlueprint(raw);
    const delegationChecks = report.results.filter((r) =>
      r.check.startsWith("delegation_rules"),
    );
    expect(delegationChecks.length).toBeGreaterThan(0);
    const categoryChecks = delegationChecks.filter((r) => r.check.includes("categories[0]"));
    expect(categoryChecks.every((r) => r.passed)).toBe(true);
  });

  it("rejects delegation_rules with missing category fields", () => {
    const raw = {
      name: "Test",
      version: "1.0.0",
      delegation_rules: {
        categories: [
          { id: "test" }, // missing name, tool, rules
        ],
      },
    };
    const report = validateBlueprint(raw);
    const errors = report.errors.filter((r) =>
      r.check.startsWith("delegation_rules.categories[0]"),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects delegation_rules with invalid tier", () => {
    const raw = {
      name: "Test",
      version: "1.0.0",
      delegation_rules: {
        categories: [
          {
            id: "test",
            name: "Test",
            tool: "email",
            rules: [
              { action: "test:action", tier: "invalid", description: "bad tier" },
            ],
          },
        ],
      },
    };
    const report = validateBlueprint(raw);
    const tierErrors = report.errors.filter((r) =>
      r.check.includes("tier"),
    );
    expect(tierErrors.length).toBeGreaterThan(0);
  });

  it("rejects duplicate category IDs", () => {
    const raw = {
      name: "Test",
      version: "1.0.0",
      delegation_rules: {
        categories: [
          { id: "dup", name: "First", tool: "email", rules: [] },
          { id: "dup", name: "Second", tool: "email", rules: [] },
        ],
      },
    };
    const report = validateBlueprint(raw);
    const dupeCheck = report.errors.find((r) =>
      r.check === "delegation_rules.unique_category_ids",
    );
    expect(dupeCheck).toBeDefined();
    expect(dupeCheck?.message).toContain("dup");
  });

  it("validates match conditions have field and pattern", () => {
    const raw = {
      name: "Test",
      version: "1.0.0",
      delegation_rules: {
        categories: [
          {
            id: "test",
            name: "Test",
            tool: "email",
            rules: [
              {
                action: "email:send:*",
                tier: "execute",
                description: "test",
                match: [{ field: "subject", pattern: "*invoice*" }],
              },
            ],
          },
        ],
      },
    };
    const report = validateBlueprint(raw);
    const matchChecks = report.results.filter((r) =>
      r.check.includes("match"),
    );
    expect(matchChecks.every((r) => r.passed)).toBe(true);
  });

  it("rejects match conditions with missing fields", () => {
    const raw = {
      name: "Test",
      version: "1.0.0",
      delegation_rules: {
        categories: [
          {
            id: "test",
            name: "Test",
            tool: "email",
            rules: [
              {
                action: "test",
                tier: "execute",
                description: "test",
                match: [{ field: "subject" }], // missing pattern
              },
            ],
          },
        ],
      },
    };
    const report = validateBlueprint(raw);
    const matchErrors = report.errors.filter((r) =>
      r.check.includes("match") && r.check.includes("pattern"),
    );
    expect(matchErrors.length).toBeGreaterThan(0);
  });

  it("accepts blueprint without delegation_rules (optional)", () => {
    const raw = {
      name: "Test",
      version: "1.0.0",
    };
    const report = validateBlueprint(raw);
    const delegationChecks = report.results.filter((r) =>
      r.check.startsWith("delegation_rules"),
    );
    expect(delegationChecks).toHaveLength(0); // No checks if absent
  });
});
