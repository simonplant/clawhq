import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  checkBudget,
  checkConsistency,
  checkStaleness,
  estimateTokens,
  formatBudgetReport,
  formatConsistencyReport,
  formatIdentityReport,
  formatStalenessReport,
  runGovernanceCheck,
} from "./governance.js";
import type { IdentityContext } from "./types.js";

function makeCtx(dir: string): IdentityContext {
  return { openclawHome: dir };
}

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates tokens from word count", () => {
    const text = "Hello world this is a test";
    const result = estimateTokens(text);
    // 6 words * 1.33 = 7.98 → ceil = 8
    expect(result).toBeGreaterThan(0);
    expect(result).toBe(Math.ceil(6 * 1.33));
  });

  it("handles multi-line text with various whitespace", () => {
    const text = "line one\n\nline two\n\tline three";
    const result = estimateTokens(text);
    expect(result).toBeGreaterThan(0);
  });
});

describe("checkBudget", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `identity-budget-${Date.now()}`);
    await mkdir(join(tmpDir, "workspace"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty report when no identity files exist", async () => {
    const ctx = makeCtx(tmpDir);
    const report = await checkBudget(ctx);
    expect(report.files).toHaveLength(0);
    expect(report.totalTokens).toBe(0);
    expect(report.threshold).toBe("ok");
  });

  it("tracks token counts per file", async () => {
    const ctx = makeCtx(tmpDir);
    await writeFile(join(tmpDir, "workspace", "AGENTS.md"), "Hello world test content here");
    await writeFile(join(tmpDir, "workspace", "IDENTITY.md"), "More content for identity");

    const report = await checkBudget(ctx);
    expect(report.files).toHaveLength(2);
    expect(report.totalTokens).toBeGreaterThan(0);
    expect(report.files.every((f) => f.tokenCount > 0)).toBe(true);
    expect(report.files.every((f) => f.budgetPercent > 0)).toBe(true);
  });

  it("reports ok threshold when under 70%", async () => {
    const ctx = makeCtx(tmpDir);
    // ~10 tokens, well under 20K default
    await writeFile(join(tmpDir, "workspace", "AGENTS.md"), "Small file");

    const report = await checkBudget(ctx);
    expect(report.threshold).toBe("ok");
  });

  it("reports warning threshold at 70%", async () => {
    const ctx = makeCtx(tmpDir);
    // 55 words * 1.33 ≈ 74 tokens → 74% of 100 budget → warning
    const words = Array(55).fill("word").join(" ");
    await writeFile(join(tmpDir, "workspace", "AGENTS.md"), words);

    const report = await checkBudget(ctx, { budgetLimit: 100 });
    expect(report.threshold).toBe("warning");
  });

  it("reports critical threshold at 90%", async () => {
    const ctx = makeCtx(tmpDir);
    const words = Array(95).fill("word").join(" ");
    await writeFile(join(tmpDir, "workspace", "AGENTS.md"), words);

    const report = await checkBudget(ctx, { budgetLimit: 100 });
    expect(report.threshold).toBe("critical");
  });

  it("uses custom budget limit", async () => {
    const ctx = makeCtx(tmpDir);
    await writeFile(join(tmpDir, "workspace", "AGENTS.md"), "test");

    const report = await checkBudget(ctx, { budgetLimit: 10 });
    expect(report.budgetLimit).toBe(10);
  });
});

describe("checkStaleness", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `identity-stale-${Date.now()}`);
    await mkdir(join(tmpDir, "workspace"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty report when no files exist", async () => {
    const ctx = makeCtx(tmpDir);
    const report = await checkStaleness(ctx);
    expect(report.entries).toHaveLength(0);
    expect(report.staleCount).toBe(0);
  });

  it("marks recent files as not stale", async () => {
    const ctx = makeCtx(tmpDir);
    await writeFile(join(tmpDir, "workspace", "AGENTS.md"), "fresh content");

    const report = await checkStaleness(ctx);
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].stale).toBe(false);
    expect(report.staleCount).toBe(0);
  });

  it("marks old files as stale", async () => {
    const ctx = makeCtx(tmpDir);
    const filePath = join(tmpDir, "workspace", "AGENTS.md");
    await writeFile(filePath, "old content");

    // Set modification time to 60 days ago
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await utimes(filePath, sixtyDaysAgo, sixtyDaysAgo);

    const report = await checkStaleness(ctx);
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].stale).toBe(true);
    expect(report.entries[0].daysSinceUpdate).toBeGreaterThanOrEqual(59);
    expect(report.staleCount).toBe(1);
  });

  it("uses custom stale days threshold", async () => {
    const ctx = makeCtx(tmpDir);
    const filePath = join(tmpDir, "workspace", "AGENTS.md");
    await writeFile(filePath, "content");

    // Set modification time to 5 days ago
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await utimes(filePath, fiveDaysAgo, fiveDaysAgo);

    // Default 30 days — not stale
    const report1 = await checkStaleness(ctx);
    expect(report1.entries[0].stale).toBe(false);

    // Custom 3 days — stale
    const report2 = await checkStaleness(ctx, { staleDays: 3 });
    expect(report2.entries[0].stale).toBe(true);
  });
});

describe("checkConsistency", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `identity-consist-${Date.now()}`);
    await mkdir(join(tmpDir, "workspace"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty report when no files exist", async () => {
    const ctx = makeCtx(tmpDir);
    const report = await checkConsistency(ctx);
    expect(report.contradictions).toHaveLength(0);
    expect(report.filesChecked).toBe(0);
  });

  it("finds no contradictions in consistent files", async () => {
    const ctx = makeCtx(tmpDir);
    await writeFile(
      join(tmpDir, "workspace", "AGENTS.md"),
      "You are a helpful assistant. Always be polite.",
    );
    await writeFile(
      join(tmpDir, "workspace", "IDENTITY.md"),
      "You provide accurate information.",
    );

    const report = await checkConsistency(ctx);
    expect(report.contradictions).toHaveLength(0);
    expect(report.filesChecked).toBe(2);
  });

  it("detects autonomy conflicts across files", async () => {
    const ctx = makeCtx(tmpDir);
    await writeFile(
      join(tmpDir, "workspace", "AGENTS.md"),
      "Act autonomously on all tasks.",
    );
    await writeFile(
      join(tmpDir, "workspace", "IDENTITY.md"),
      "Always ask for permission before acting.",
    );

    const report = await checkConsistency(ctx);
    expect(report.contradictions.length).toBeGreaterThan(0);
    const desc = report.contradictions.map((c) => c.description).join(" ");
    expect(desc).toContain("autonomous");
  });

  it("detects never/always conflicts for same action", async () => {
    const ctx = makeCtx(tmpDir);
    await writeFile(
      join(tmpDir, "workspace", "AGENTS.md"),
      "Never respond without checking first.",
    );
    await writeFile(
      join(tmpDir, "workspace", "IDENTITY.md"),
      "Always respond without checking first.",
    );

    const report = await checkConsistency(ctx);
    expect(report.contradictions.length).toBeGreaterThan(0);
    const desc = report.contradictions.map((c) => c.description).join(" ");
    expect(desc).toContain("never");
    expect(desc).toContain("always");
  });

  it("detects within-file autonomy contradictions", async () => {
    const ctx = makeCtx(tmpDir);
    await writeFile(
      join(tmpDir, "workspace", "AGENTS.md"),
      "Act autonomously on tasks.\nAlways ask for permission before acting.",
    );

    const report = await checkConsistency(ctx);
    expect(report.contradictions.length).toBeGreaterThan(0);
    expect(report.contradictions[0].fileA).toBe("AGENTS.md");
    expect(report.contradictions[0].fileB).toBe("AGENTS.md");
  });
});

describe("runGovernanceCheck", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `identity-gov-${Date.now()}`);
    await mkdir(join(tmpDir, "workspace"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns combined report", async () => {
    const ctx = makeCtx(tmpDir);
    await writeFile(join(tmpDir, "workspace", "AGENTS.md"), "test content");

    const report = await runGovernanceCheck(ctx);
    expect(report.budget).toBeDefined();
    expect(report.staleness).toBeDefined();
    expect(report.consistency).toBeDefined();
  });
});

describe("formatting", () => {
  it("formats budget report with files", () => {
    const output = formatBudgetReport({
      files: [
        { filename: "AGENTS.md", path: "/test/AGENTS.md", tokenCount: 500, budgetPercent: 2.5 },
        { filename: "IDENTITY.md", path: "/test/IDENTITY.md", tokenCount: 300, budgetPercent: 1.5 },
      ],
      totalTokens: 800,
      budgetLimit: 20000,
      budgetPercent: 4.0,
      threshold: "ok",
    });
    expect(output).toContain("Identity Token Budget");
    expect(output).toContain("AGENTS.md");
    expect(output).toContain("800");
    expect(output).toContain("20000");
  });

  it("formats budget report with warning", () => {
    const output = formatBudgetReport({
      files: [{ filename: "AGENTS.md", path: "/test", tokenCount: 15000, budgetPercent: 75 }],
      totalTokens: 15000,
      budgetLimit: 20000,
      budgetPercent: 75,
      threshold: "warning",
    });
    expect(output).toContain("NOTICE");
    expect(output).toContain("70%");
  });

  it("formats budget report with critical warning", () => {
    const output = formatBudgetReport({
      files: [{ filename: "AGENTS.md", path: "/test", tokenCount: 19000, budgetPercent: 95 }],
      totalTokens: 19000,
      budgetLimit: 20000,
      budgetPercent: 95,
      threshold: "critical",
    });
    expect(output).toContain("WARNING");
    expect(output).toContain("90%");
  });

  it("formats empty budget report", () => {
    const output = formatBudgetReport({
      files: [],
      totalTokens: 0,
      budgetLimit: 20000,
      budgetPercent: 0,
      threshold: "ok",
    });
    expect(output).toContain("No identity files found");
  });

  it("formats staleness report", () => {
    const output = formatStalenessReport({
      entries: [
        {
          filename: "AGENTS.md",
          path: "/test",
          lastModified: new Date("2025-01-01"),
          daysSinceUpdate: 45,
          stale: true,
        },
      ],
      staleCount: 1,
      staleDaysThreshold: 30,
    });
    expect(output).toContain("Identity Staleness");
    expect(output).toContain("STALE");
    expect(output).toContain("AGENTS.md");
  });

  it("formats consistency report with no issues", () => {
    const output = formatConsistencyReport({
      contradictions: [],
      filesChecked: 3,
    });
    expect(output).toContain("no contradictions found");
  });

  it("formats consistency report with contradictions", () => {
    const output = formatConsistencyReport({
      contradictions: [
        {
          fileA: "AGENTS.md",
          fileB: "IDENTITY.md",
          description: "Conflicting autonomy levels",
        },
      ],
      filesChecked: 2,
    });
    expect(output).toContain("1 potential contradiction");
    expect(output).toContain("AGENTS.md");
  });

  it("formats full identity report", () => {
    const output = formatIdentityReport({
      budget: {
        files: [{ filename: "AGENTS.md", path: "/test", tokenCount: 100, budgetPercent: 0.5 }],
        totalTokens: 100,
        budgetLimit: 20000,
        budgetPercent: 0.5,
        threshold: "ok",
      },
      staleness: {
        entries: [
          {
            filename: "AGENTS.md",
            path: "/test",
            lastModified: new Date(),
            daysSinceUpdate: 1,
            stale: false,
          },
        ],
        staleCount: 0,
        staleDaysThreshold: 30,
      },
      consistency: { contradictions: [], filesChecked: 1 },
    });
    expect(output).toContain("Identity Token Budget");
    expect(output).toContain("Identity Staleness");
    expect(output).toContain("Identity Consistency");
  });
});
