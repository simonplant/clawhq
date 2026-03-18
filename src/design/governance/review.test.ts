import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildReviewSummary,
  formatReviewSummary,
  identityFilePath,
  readIdentityFile,
  saveIdentityFile,
  simpleDiff,
} from "./review.js";
import type { IdentityContext } from "./types.js";

function makeCtx(dir: string): IdentityContext {
  return { openclawHome: dir };
}

describe("buildReviewSummary", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `identity-review-${Date.now()}`);
    await mkdir(join(tmpDir, "workspace"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty summary when no files exist", async () => {
    const ctx = makeCtx(tmpDir);
    const summary = await buildReviewSummary(ctx);
    expect(summary.files).toHaveLength(0);
    expect(summary.totalTokens).toBe(0);
  });

  it("returns combined file status", async () => {
    const ctx = makeCtx(tmpDir);
    await writeFile(join(tmpDir, "workspace", "AGENTS.md"), "Hello world test content");
    await writeFile(join(tmpDir, "workspace", "IDENTITY.md"), "Identity content here");

    const summary = await buildReviewSummary(ctx);
    expect(summary.files).toHaveLength(2);
    expect(summary.totalTokens).toBeGreaterThan(0);
    expect(summary.files[0].tokenCount).toBeGreaterThan(0);
    expect(summary.files[0].daysSinceUpdate).toBeDefined();
    expect(summary.files[0].stale).toBe(false);
  });

  it("reports contradictions", async () => {
    const ctx = makeCtx(tmpDir);
    await writeFile(
      join(tmpDir, "workspace", "AGENTS.md"),
      "Act autonomously on all tasks.",
    );
    await writeFile(
      join(tmpDir, "workspace", "IDENTITY.md"),
      "Always ask for permission before acting.",
    );

    const summary = await buildReviewSummary(ctx);
    expect(summary.contradictionCount).toBeGreaterThan(0);
    expect(summary.contradictions.length).toBeGreaterThan(0);
  });
});

describe("formatReviewSummary", () => {
  it("formats empty summary", () => {
    const output = formatReviewSummary({
      files: [],
      totalTokens: 0,
      budgetLimit: 20000,
      budgetPercent: 0,
      threshold: "ok",
      staleCount: 0,
      contradictionCount: 0,
      contradictions: [],
    });
    expect(output).toContain("No identity files found");
  });

  it("formats summary with files", () => {
    const output = formatReviewSummary({
      files: [
        {
          filename: "AGENTS.md",
          path: "/test/AGENTS.md",
          tokenCount: 500,
          budgetPercent: 2.5,
          daysSinceUpdate: 5,
          stale: false,
          lastModified: new Date(),
        },
      ],
      totalTokens: 500,
      budgetLimit: 20000,
      budgetPercent: 2.5,
      threshold: "ok",
      staleCount: 0,
      contradictionCount: 0,
      contradictions: [],
    });
    expect(output).toContain("AGENTS.md");
    expect(output).toContain("500");
    expect(output).toContain("20000");
  });

  it("shows stale count", () => {
    const output = formatReviewSummary({
      files: [
        {
          filename: "AGENTS.md",
          path: "/test",
          tokenCount: 100,
          budgetPercent: 0.5,
          daysSinceUpdate: 45,
          stale: true,
          lastModified: new Date(),
        },
      ],
      totalTokens: 100,
      budgetLimit: 20000,
      budgetPercent: 0.5,
      threshold: "ok",
      staleCount: 1,
      contradictionCount: 0,
      contradictions: [],
    });
    expect(output).toContain("Stale files: 1");
  });

  it("shows contradictions", () => {
    const output = formatReviewSummary({
      files: [
        {
          filename: "AGENTS.md",
          path: "/test",
          tokenCount: 100,
          budgetPercent: 0.5,
          daysSinceUpdate: 1,
          stale: false,
          lastModified: new Date(),
        },
      ],
      totalTokens: 100,
      budgetLimit: 20000,
      budgetPercent: 0.5,
      threshold: "ok",
      staleCount: 0,
      contradictionCount: 1,
      contradictions: ["[AGENTS.md <-> IDENTITY.md] Conflicting autonomy"],
    });
    expect(output).toContain("Contradictions: 1");
    expect(output).toContain("Conflicting autonomy");
  });
});

describe("simpleDiff", () => {
  it("returns null when contents are identical", () => {
    expect(simpleDiff("hello\n", "hello\n", "test.md")).toBeNull();
  });

  it("shows added lines", () => {
    const diff = simpleDiff("line1\n", "line1\nline2\n", "test.md");
    expect(diff).toContain("+line2");
    expect(diff).toContain("--- a/test.md");
    expect(diff).toContain("+++ b/test.md");
  });

  it("shows removed lines", () => {
    const diff = simpleDiff("line1\nline2\n", "line1\n", "test.md");
    expect(diff).toContain("-line2");
  });

  it("shows changed lines", () => {
    const diff = simpleDiff("old content\n", "new content\n", "test.md");
    expect(diff).toContain("-old content");
    expect(diff).toContain("+new content");
  });
});

describe("saveIdentityFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `identity-save-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("saves new content and returns diff", async () => {
    const filePath = join(tmpDir, "AGENTS.md");
    await writeFile(filePath, "Old content.\n");

    const result = await saveIdentityFile(filePath, "New content.\n");
    expect(result.saved).toBe(true);
    expect(result.diff).toContain("-Old content.");
    expect(result.diff).toContain("+New content.");
  });

  it("returns no diff when content is identical", async () => {
    const filePath = join(tmpDir, "AGENTS.md");
    await writeFile(filePath, "Same content.\n");

    const result = await saveIdentityFile(filePath, "Same content.\n");
    expect(result.saved).toBe(false);
    expect(result.diff).toBeNull();
  });

  it("preserves customizations block from original file", async () => {
    const filePath = join(tmpDir, "AGENTS.md");
    const original = [
      "# AGENTS.md",
      "",
      "Old instructions.",
      "",
      "<!-- CUSTOMIZATIONS -->",
      "My custom rule: always be brief.",
      "<!-- /CUSTOMIZATIONS -->",
      "",
    ].join("\n");
    await writeFile(filePath, original);

    const newContent = "# AGENTS.md\n\nNew instructions.\n";
    const result = await saveIdentityFile(filePath, newContent);
    expect(result.saved).toBe(true);

    const { readFile: rf } = await import("node:fs/promises");
    const saved = await rf(filePath, "utf-8");
    expect(saved).toContain("New instructions.");
    expect(saved).toContain("My custom rule: always be brief.");
  });
});

describe("readIdentityFile", () => {
  it("returns empty string for non-existent file", async () => {
    const content = await readIdentityFile("/nonexistent/path.md");
    expect(content).toBe("");
  });
});

describe("identityFilePath", () => {
  it("builds correct path", () => {
    const ctx = makeCtx("/home/test/.openclaw");
    expect(identityFilePath(ctx, "AGENTS.md")).toBe(
      "/home/test/.openclaw/workspace/AGENTS.md",
    );
  });
});
