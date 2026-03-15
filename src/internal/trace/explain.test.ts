import { describe, expect, it } from "vitest";

import { explainWithTemplate } from "./explain.js";
import type { DecisionEntry } from "./types.js";

describe("explainWithTemplate", () => {
  const baseEntry: DecisionEntry = {
    id: "dec-001",
    timestamp: "2026-03-14T08:00:00.000Z",
    actionType: "email_triage",
    summary: "Marked email from John as urgent",
    factors: [
      {
        kind: "rule",
        source: "AGENTS.md",
        content: "Flag emails from VIP contacts as urgent",
        weight: 0.9,
      },
      {
        kind: "preference",
        source: "USER.md",
        content: "John is a VIP contact",
        weight: 0.8,
      },
    ],
    outcome: "Email flagged as urgent",
  };

  it("generates explanation citing rules", () => {
    const result = explainWithTemplate(baseEntry, [baseEntry]);

    expect(result.decisionId).toBe("dec-001");
    expect(result.text).toContain("marked email from john as urgent");
    expect(result.text).toContain("AGENTS.md");
    expect(result.text).toContain("Flag emails from VIP contacts as urgent");
  });

  it("generates explanation citing preferences", () => {
    const result = explainWithTemplate(baseEntry, [baseEntry]);

    expect(result.text).toContain("USER.md");
    expect(result.text).toContain("John is a VIP contact");
  });

  it("extracts citations from factors", () => {
    const result = explainWithTemplate(baseEntry, [baseEntry]);

    expect(result.citations).toHaveLength(2);
    expect(result.citations[0].source).toBe("AGENTS.md");
    expect(result.citations[0].kind).toBe("rule");
    expect(result.citations[1].source).toBe("USER.md");
    expect(result.citations[1].kind).toBe("preference");
  });

  it("includes context factors in explanation", () => {
    const entry: DecisionEntry = {
      ...baseEntry,
      factors: [
        {
          kind: "context",
          source: "email",
          content: "Email was from a known sender",
          weight: 0.5,
        },
      ],
    };

    const result = explainWithTemplate(entry, [entry]);

    expect(result.text).toContain("Email was from a known sender");
    expect(result.citations).toHaveLength(0);
  });

  it("includes chain context for multi-step decisions", () => {
    const parent: DecisionEntry = {
      id: "dec-000",
      timestamp: "2026-03-14T07:59:00.000Z",
      actionType: "email_read",
      summary: "Read inbox",
      factors: [],
      outcome: "40 emails found",
    };

    const chain = [parent, baseEntry];
    const result = explainWithTemplate(baseEntry, chain);

    expect(result.text).toContain("read inbox");
    expect(result.text).toContain("part of a sequence");
  });

  it("sets generatedAt timestamp", () => {
    const result = explainWithTemplate(baseEntry, [baseEntry]);
    expect(result.generatedAt).toBeTruthy();
    expect(new Date(result.generatedAt).getTime()).toBeGreaterThan(0);
  });

  it("handles entry with no factors", () => {
    const entry: DecisionEntry = {
      ...baseEntry,
      factors: [],
    };

    const result = explainWithTemplate(entry, [entry]);

    expect(result.text).toContain("marked email from john as urgent");
    expect(result.citations).toHaveLength(0);
  });
});
