/**
 * Tests for memory lifecycle management.
 *
 * Covers tier transitions, PII masking, decision tracing,
 * and preference pattern detection.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadManifest, runLifecycle, scanAllTiers } from "./lifecycle.js";
import { analyzePreferences } from "./preferences.js";
import { getMemoryStatus } from "./status.js";
import { logDecision, readTraces, recordFeedback } from "./trace.js";
import type { MemoryLifecycleConfig } from "./types.js";

// ── Test Setup ───────────────────────────────────────────────────────────────

let testDir: string;
let deployDir: string;

beforeEach(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  testDir = await mkdtemp(join(tmpdir(), "clawhq-memory-test-"));
  deployDir = join(testDir, "deploy");

  // Create memory tier directories
  mkdirSync(join(deployDir, "workspace", "memory", "hot"), { recursive: true });
  mkdirSync(join(deployDir, "workspace", "memory", "warm"), { recursive: true });
  mkdirSync(join(deployDir, "workspace", "memory", "cold"), { recursive: true });
  mkdirSync(join(deployDir, "ops", "audit"), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ── Scan Tests ───────────────────────────────────────────────────────────────

describe("scanAllTiers", () => {
  it("returns empty array when no memory files exist", () => {
    const entries = scanAllTiers(deployDir);
    expect(entries).toEqual([]);
  });

  it("discovers memory files across all tiers", async () => {
    await writeFile(join(deployDir, "workspace/memory/hot/conv1.md"), "hello");
    await writeFile(join(deployDir, "workspace/memory/warm/summary1.md"), "summarized");
    await writeFile(join(deployDir, "workspace/memory/cold/archive1.md"), "archived");

    const entries = scanAllTiers(deployDir);
    expect(entries).toHaveLength(3);

    const tiers = entries.map((e) => e.tier).sort();
    expect(tiers).toEqual(["cold", "hot", "warm"]);
  });

  it("ignores hidden files and non-text files", async () => {
    await writeFile(join(deployDir, "workspace/memory/hot/.manifest.json"), "{}");
    await writeFile(join(deployDir, "workspace/memory/hot/data.bin"), "binary");
    await writeFile(join(deployDir, "workspace/memory/hot/notes.md"), "text");

    const entries = scanAllTiers(deployDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("notes");
  });
});

// ── Lifecycle Tests ──────────────────────────────────────────────────────────

describe("runLifecycle", () => {
  it("runs without error on empty memory", async () => {
    const result = await runLifecycle({ deployDir });

    expect(result.success).toBe(true);
    expect(result.transitions).toHaveLength(0);
    expect(result.purged).toHaveLength(0);
    expect(result.totalEntries).toBe(0);
  });

  it("transitions hot entries to warm when retention expires", async () => {
    // Create a hot memory file with old timestamp
    const hotFile = join(deployDir, "workspace/memory/hot/old-convo.md");
    await writeFile(hotFile, "This is a conversation about scheduling meetings.");

    // Set file mtime to 25 hours ago
    const { utimes } = await import("node:fs/promises");
    const past = new Date(Date.now() - 25 * 3600 * 1000);
    await utimes(hotFile, past, past);

    // Ollama won't be available in tests — summarizer falls back gracefully
    // and preserves the original text (no data loss)
    const config: MemoryLifecycleConfig = {
      hotMaxBytes: 50 * 1024,
      hotRetentionHours: 24,
      warmRetentionHours: 168,
      coldRetentionHours: 0,
      summarization: "balanced",
    };

    const result = await runLifecycle({ deployDir, config });

    expect(result.success).toBe(true);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0].fromTier).toBe("hot");
    expect(result.transitions[0].toTier).toBe("warm");

    // Verify file moved
    expect(existsSync(hotFile)).toBe(false);
    expect(
      existsSync(join(deployDir, "workspace/memory/warm/old-convo.md")),
    ).toBe(true);

    // Content preserved when summarization unavailable
    const warmContent = readFileSync(
      join(deployDir, "workspace/memory/warm/old-convo.md"),
      "utf-8",
    );
    expect(warmContent).toContain("scheduling meetings");
  });

  it("masks PII when transitioning warm to cold", async () => {
    const warmFile = join(deployDir, "workspace/memory/warm/with-pii.md");
    await writeFile(
      warmFile,
      "User email: john@example.com, phone: 555-123-4567, notes about preferences.",
    );

    // Set file mtime to 8 days ago
    const { utimes } = await import("node:fs/promises");
    const past = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    await utimes(warmFile, past, past);

    const config: MemoryLifecycleConfig = {
      hotMaxBytes: 50 * 1024,
      hotRetentionHours: 24,
      warmRetentionHours: 168, // 7 days
      coldRetentionHours: 0,
      summarization: "balanced",
    };

    const result = await runLifecycle({ deployDir, config });

    expect(result.success).toBe(true);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0].fromTier).toBe("warm");
    expect(result.transitions[0].toTier).toBe("cold");
    expect(result.transitions[0].piiMasked).toBe(true);

    // Verify PII is masked in cold file
    const coldContent = readFileSync(
      join(deployDir, "workspace/memory/cold/with-pii.md"),
      "utf-8",
    );
    expect(coldContent).not.toContain("john@example.com");
    expect(coldContent).toContain("[EMAIL REDACTED]");
    expect(coldContent).toContain("[PHONE REDACTED]");
    // Non-PII content preserved
    expect(coldContent).toContain("notes about preferences");
  });

  it("updates manifest after lifecycle run", async () => {
    await writeFile(join(deployDir, "workspace/memory/hot/active.md"), "active memory");

    const result = await runLifecycle({ deployDir });

    expect(result.success).toBe(true);

    const manifest = await loadManifest(deployDir);
    expect(manifest.version).toBe(1);
    expect(manifest.lastRunAt).toBeDefined();
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0].tier).toBe("hot");
  });
});

// ── Memory Status Tests ──────────────────────────────────────────────────────

describe("getMemoryStatus", () => {
  it("returns tier breakdown", async () => {
    await writeFile(join(deployDir, "workspace/memory/hot/a.md"), "hot1");
    await writeFile(join(deployDir, "workspace/memory/hot/b.md"), "hot2");
    await writeFile(join(deployDir, "workspace/memory/warm/c.md"), "warm1");

    const status = await getMemoryStatus({ deployDir });

    expect(status.totalEntries).toBe(3);
    expect(status.tiers).toHaveLength(3);

    const hot = status.tiers.find((t) => t.tier === "hot");
    expect(hot?.entryCount).toBe(2);

    const warm = status.tiers.find((t) => t.tier === "warm");
    expect(warm?.entryCount).toBe(1);

    const cold = status.tiers.find((t) => t.tier === "cold");
    expect(cold?.entryCount).toBe(0);
  });
});

// ── Decision Trace Tests ─────────────────────────────────────────────────────

describe("decision trace", () => {
  it("logs and reads trace entries", async () => {
    await logDecision(deployDir, {
      decision: "Auto-reply to routine inquiry",
      reasoning: "Email matches known pattern for low-priority inquiries",
      action: "Sent template response",
      outcome: "success",
    });

    await logDecision(deployDir, {
      decision: "Escalate urgent email",
      reasoning: "Email from priority contact with 'urgent' keyword",
      action: "Notified user via Telegram",
      outcome: "success",
    });

    const traces = await readTraces(deployDir);
    expect(traces).toHaveLength(2);
    expect(traces[0].decision).toBe("Auto-reply to routine inquiry");
    expect(traces[1].decision).toBe("Escalate urgent email");
    expect(traces[0].id).toBeDefined();
    expect(traces[0].timestamp).toBeDefined();
  });

  it("records feedback on a decision", async () => {
    const trace = await logDecision(deployDir, {
      decision: "Schedule meeting at 3pm",
      reasoning: "Open slot found",
      action: "Created calendar event",
      outcome: "success",
    });

    const result = await recordFeedback(deployDir, trace.id, "approved");
    expect(result).toBe(true);

    const traces = await readTraces(deployDir);
    expect(traces).toHaveLength(2);
    expect(traces[1].feedback).toBe("approved");
  });

  it("returns false for feedback on unknown trace", async () => {
    const result = await recordFeedback(deployDir, "nonexistent-id", "rejected");
    expect(result).toBe(false);
  });
});

// ── Preference Pattern Tests ─────────────────────────────────────────────────

describe("analyzePreferences", () => {
  it("returns empty patterns with insufficient data", async () => {
    const report = await analyzePreferences({ deployDir });
    expect(report.patterns).toHaveLength(0);
    expect(report.totalDecisions).toBe(0);
  });

  it("detects patterns from repeated decisions", async () => {
    // Create enough traces to form a pattern
    for (let i = 0; i < 5; i++) {
      await logDecision(deployDir, {
        decision: "Auto-reply to routine email inquiry",
        reasoning: "Matches known pattern",
        action: "Sent email template response",
        outcome: "success",
      });
    }

    const report = await analyzePreferences({ deployDir });
    expect(report.totalDecisions).toBe(5);
    expect(report.patterns.length).toBeGreaterThan(0);

    const commPattern = report.patterns.find(
      (p) => p.category === "communication",
    );
    expect(commPattern).toBeDefined();
    expect(commPattern?.supportCount).toBe(5);
    expect(commPattern?.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("persists preference report to disk", async () => {
    for (let i = 0; i < 4; i++) {
      await logDecision(deployDir, {
        decision: "Schedule meeting in morning slot",
        reasoning: "User prefers morning meetings",
        action: "Created calendar event at 9am",
        outcome: "success",
      });
    }

    await analyzePreferences({ deployDir });

    const reportPath = join(deployDir, "workspace/memory/.preferences.json");
    expect(existsSync(reportPath)).toBe(true);

    const saved = JSON.parse(readFileSync(reportPath, "utf-8"));
    expect(saved.totalDecisions).toBe(4);
  });
});
