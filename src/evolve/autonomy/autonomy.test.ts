import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApprovalCategory, ApprovalEntry } from "../../operate/approval/types.js";

import { analyzePatterns, computeConfidence, isInCooldown } from "./analyzer.js";
import {
  acceptRecommendation,
  AutonomyError,
  formatDryRun,
  formatRecommendations,
  generateRecommendations,
  loadAuditLog,
  loadStore,
  rejectRecommendation,
  saveStore,
} from "./recommender.js";
import { computeCategoryStats } from "./tracker.js";
import type {
  AutonomyConfig,
  AutonomyContext,
  CategoryStats,
  CooldownEntry,
  RecommendationStore,
} from "./types.js";
import { DEFAULT_AUTONOMY_CONFIG } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(tmpDir: string): AutonomyContext {
  return {
    openclawHome: join(tmpDir, "openclaw"),
    clawhqDir: join(tmpDir, "clawhq"),
  };
}

function makeEntry(
  overrides: Partial<ApprovalEntry> & { status: ApprovalEntry["status"]; category: ApprovalCategory },
): ApprovalEntry {
  return {
    id: `entry-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    description: "Test action",
    timeoutMs: 86_400_000,
    ...overrides,
  };
}

function makeStats(overrides: Partial<CategoryStats> = {}): CategoryStats {
  return {
    category: "send_email",
    total: 20,
    approved: 19,
    rejected: 1,
    expired: 0,
    approvalRate: 0.95,
    rejectionRate: 0.05,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tracker tests
// ---------------------------------------------------------------------------

describe("computeCategoryStats", () => {
  it("computes stats from approval entries", () => {
    const entries: ApprovalEntry[] = [
      makeEntry({ category: "send_email", status: "approved" }),
      makeEntry({ category: "send_email", status: "approved" }),
      makeEntry({ category: "send_email", status: "rejected" }),
      makeEntry({ category: "create_event", status: "approved" }),
      makeEntry({ category: "create_event", status: "approved" }),
    ];

    const stats = computeCategoryStats(entries);
    expect(stats).toHaveLength(2);

    const emailStats = stats.find((s) => s.category === "send_email");
    expect(emailStats).toBeDefined();
    expect(emailStats?.total).toBe(3);
    expect(emailStats?.approved).toBe(2);
    expect(emailStats?.rejected).toBe(1);
    expect(emailStats?.approvalRate).toBeCloseTo(0.667, 2);
    expect(emailStats?.rejectionRate).toBeCloseTo(0.333, 2);

    const eventStats = stats.find((s) => s.category === "create_event");
    expect(eventStats?.total).toBe(2);
    expect(eventStats?.approvalRate).toBe(1.0);
  });

  it("ignores pending entries", () => {
    const entries: ApprovalEntry[] = [
      makeEntry({ category: "send_email", status: "pending" }),
      makeEntry({ category: "send_email", status: "approved" }),
    ];

    const stats = computeCategoryStats(entries);
    expect(stats).toHaveLength(1);
    expect(stats[0].total).toBe(1);
  });

  it("tracks expired entries separately", () => {
    const entries: ApprovalEntry[] = [
      makeEntry({ category: "send_email", status: "approved" }),
      makeEntry({ category: "send_email", status: "expired" }),
    ];

    const stats = computeCategoryStats(entries);
    expect(stats[0].total).toBe(1); // expired not in total
    expect(stats[0].expired).toBe(1);
    expect(stats[0].approvalRate).toBe(1.0);
  });

  it("returns empty array for no entries", () => {
    expect(computeCategoryStats([])).toHaveLength(0);
  });

  it("handles all-rejected category", () => {
    const entries: ApprovalEntry[] = [
      makeEntry({ category: "delete_data", status: "rejected" }),
      makeEntry({ category: "delete_data", status: "rejected" }),
    ];

    const stats = computeCategoryStats(entries);
    expect(stats[0].rejectionRate).toBe(1.0);
    expect(stats[0].approvalRate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Analyzer tests
// ---------------------------------------------------------------------------

describe("isInCooldown", () => {
  it("returns true when cooldown is active", () => {
    const now = new Date();
    const cooldowns: CooldownEntry[] = [
      {
        recommendationId: "rec-1",
        category: "send_email",
        type: "auto_approve",
        rejectedAt: now.toISOString(),
        cooldownExpiresAt: new Date(now.getTime() + 1_000_000).toISOString(),
      },
    ];

    expect(isInCooldown("send_email", "auto_approve", cooldowns, now)).toBe(true);
  });

  it("returns false when cooldown has expired", () => {
    const now = new Date();
    const cooldowns: CooldownEntry[] = [
      {
        recommendationId: "rec-1",
        category: "send_email",
        type: "auto_approve",
        rejectedAt: new Date(now.getTime() - 2_000_000).toISOString(),
        cooldownExpiresAt: new Date(now.getTime() - 1_000_000).toISOString(),
      },
    ];

    expect(isInCooldown("send_email", "auto_approve", cooldowns, now)).toBe(false);
  });

  it("returns false for different category", () => {
    const now = new Date();
    const cooldowns: CooldownEntry[] = [
      {
        recommendationId: "rec-1",
        category: "send_email",
        type: "auto_approve",
        rejectedAt: now.toISOString(),
        cooldownExpiresAt: new Date(now.getTime() + 1_000_000).toISOString(),
      },
    ];

    expect(isInCooldown("create_event", "auto_approve", cooldowns, now)).toBe(false);
  });

  it("returns false for different recommendation type", () => {
    const now = new Date();
    const cooldowns: CooldownEntry[] = [
      {
        recommendationId: "rec-1",
        category: "send_email",
        type: "auto_approve",
        rejectedAt: now.toISOString(),
        cooldownExpiresAt: new Date(now.getTime() + 1_000_000).toISOString(),
      },
    ];

    expect(isInCooldown("send_email", "require_approval", cooldowns, now)).toBe(false);
  });
});

describe("computeConfidence", () => {
  it("returns 0 when below threshold", () => {
    const stats = makeStats({ approvalRate: 0.90 });
    expect(computeConfidence(stats, "auto_approve")).toBe(0);
  });

  it("returns positive value at threshold", () => {
    const stats = makeStats({ approvalRate: 0.95, total: 30 });
    expect(computeConfidence(stats, "auto_approve")).toBeGreaterThan(0);
  });

  it("increases with higher rate", () => {
    const stats95 = makeStats({ approvalRate: 0.95, total: 20 });
    const stats100 = makeStats({ approvalRate: 1.0, total: 20 });
    expect(computeConfidence(stats100, "auto_approve")).toBeGreaterThan(
      computeConfidence(stats95, "auto_approve"),
    );
  });

  it("increases with larger sample size", () => {
    const small = makeStats({ approvalRate: 0.98, total: 10 });
    const large = makeStats({ approvalRate: 0.98, total: 50 });
    expect(computeConfidence(large, "auto_approve")).toBeGreaterThan(
      computeConfidence(small, "auto_approve"),
    );
  });

  it("works for require_approval type", () => {
    const stats = makeStats({ rejectionRate: 0.60, total: 15 });
    expect(computeConfidence(stats, "require_approval")).toBeGreaterThan(0);
  });
});

describe("analyzePatterns", () => {
  const config: AutonomyConfig = {
    ...DEFAULT_AUTONOMY_CONFIG,
    minimumSampleSize: 5,
  };

  it("recommends auto-approve for high approval rate", () => {
    const stats: CategoryStats[] = [
      makeStats({ category: "send_email", approvalRate: 0.97, total: 20 }),
    ];

    const recs = analyzePatterns(stats, [], config);
    expect(recs).toHaveLength(1);
    expect(recs[0].type).toBe("auto_approve");
    expect(recs[0].category).toBe("send_email");
  });

  it("recommends require-approval for high rejection rate", () => {
    const stats: CategoryStats[] = [
      makeStats({
        category: "delete_data",
        approvalRate: 0.40,
        rejectionRate: 0.60,
        total: 10,
      }),
    ];

    const recs = analyzePatterns(stats, [], config);
    expect(recs).toHaveLength(1);
    expect(recs[0].type).toBe("require_approval");
  });

  it("skips categories below minimum sample size", () => {
    const stats: CategoryStats[] = [
      makeStats({ category: "send_email", approvalRate: 1.0, total: 3 }),
    ];

    const recs = analyzePatterns(stats, [], config);
    expect(recs).toHaveLength(0);
  });

  it("skips categories in cooldown", () => {
    const now = new Date();
    const stats: CategoryStats[] = [
      makeStats({ category: "send_email", approvalRate: 0.99, total: 20 }),
    ];
    const cooldowns: CooldownEntry[] = [
      {
        recommendationId: "rec-old",
        category: "send_email",
        type: "auto_approve",
        rejectedAt: now.toISOString(),
        cooldownExpiresAt: new Date(now.getTime() + 1_000_000).toISOString(),
      },
    ];

    const recs = analyzePatterns(stats, cooldowns, config, now);
    expect(recs).toHaveLength(0);
  });

  it("generates no recommendations when rates are moderate", () => {
    const stats: CategoryStats[] = [
      makeStats({ category: "send_email", approvalRate: 0.80, rejectionRate: 0.20, total: 20 }),
    ];

    const recs = analyzePatterns(stats, [], config);
    expect(recs).toHaveLength(0);
  });

  it("sorts recommendations by confidence descending", () => {
    const stats: CategoryStats[] = [
      makeStats({ category: "send_email", approvalRate: 0.96, total: 10 }),
      makeStats({ category: "create_event", approvalRate: 1.0, total: 50 }),
    ];

    const recs = analyzePatterns(stats, [], config);
    expect(recs).toHaveLength(2);
    expect(recs[0].confidence).toBeGreaterThanOrEqual(recs[1].confidence);
  });
});

// ---------------------------------------------------------------------------
// Recommender persistence tests
// ---------------------------------------------------------------------------

describe("recommender persistence", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `autonomy-${Date.now()}`);
    await mkdir(join(tmpDir, "clawhq", "autonomy"), { recursive: true });
    await mkdir(join(tmpDir, "openclaw"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("loads empty store when no file exists", async () => {
    const ctx = makeCtx(tmpDir);
    const store = await loadStore(ctx);
    expect(store.recommendations).toHaveLength(0);
    expect(store.cooldowns).toHaveLength(0);
  });

  it("saves and loads store", async () => {
    const ctx = makeCtx(tmpDir);
    const store: RecommendationStore = {
      recommendations: [
        {
          id: "rec-test",
          createdAt: new Date().toISOString(),
          category: "send_email",
          type: "auto_approve",
          rationale: "test",
          confidence: 0.9,
          stats: makeStats(),
          status: "pending",
        },
      ],
      cooldowns: [],
    };

    await saveStore(ctx, store);
    const loaded = await loadStore(ctx);
    expect(loaded.recommendations).toHaveLength(1);
    expect(loaded.recommendations[0].id).toBe("rec-test");
  });
});

// ---------------------------------------------------------------------------
// Accept / Reject tests
// ---------------------------------------------------------------------------

describe("acceptRecommendation", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `autonomy-accept-${Date.now()}`);
    await mkdir(join(tmpDir, "clawhq", "autonomy"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("accepts a pending recommendation", async () => {
    const ctx = makeCtx(tmpDir);
    const store: RecommendationStore = {
      recommendations: [
        {
          id: "rec-1",
          createdAt: new Date().toISOString(),
          category: "send_email",
          type: "auto_approve",
          rationale: "test",
          confidence: 0.9,
          stats: makeStats(),
          status: "pending",
        },
      ],
      cooldowns: [],
    };
    await saveStore(ctx, store);

    const result = await acceptRecommendation(ctx, "rec-1");
    expect(result.recommendation.status).toBe("accepted");
    expect(result.message).toContain("auto-approve");

    // Verify persisted
    const loaded = await loadStore(ctx);
    expect(loaded.recommendations[0].status).toBe("accepted");

    // Verify audit log
    const audit = await loadAuditLog(ctx);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0].eventType).toBe("recommendation_accepted");
  });

  it("throws for non-existent recommendation", async () => {
    const ctx = makeCtx(tmpDir);
    await saveStore(ctx, { recommendations: [], cooldowns: [] });

    await expect(acceptRecommendation(ctx, "rec-missing")).rejects.toThrow(AutonomyError);
  });

  it("throws for already resolved recommendation", async () => {
    const ctx = makeCtx(tmpDir);
    const store: RecommendationStore = {
      recommendations: [
        {
          id: "rec-1",
          createdAt: new Date().toISOString(),
          category: "send_email",
          type: "auto_approve",
          rationale: "test",
          confidence: 0.9,
          stats: makeStats(),
          status: "accepted",
        },
      ],
      cooldowns: [],
    };
    await saveStore(ctx, store);

    await expect(acceptRecommendation(ctx, "rec-1")).rejects.toThrow("already accepted");
  });
});

describe("rejectRecommendation", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `autonomy-reject-${Date.now()}`);
    await mkdir(join(tmpDir, "clawhq", "autonomy"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("rejects a recommendation and adds cooldown", async () => {
    const ctx = makeCtx(tmpDir);
    const store: RecommendationStore = {
      recommendations: [
        {
          id: "rec-1",
          createdAt: new Date().toISOString(),
          category: "send_email",
          type: "auto_approve",
          rationale: "test",
          confidence: 0.9,
          stats: makeStats(),
          status: "pending",
        },
      ],
      cooldowns: [],
    };
    await saveStore(ctx, store);

    const result = await rejectRecommendation(ctx, "rec-1");
    expect(result.recommendation.status).toBe("rejected");
    expect(result.cooldown.category).toBe("send_email");
    expect(result.cooldown.type).toBe("auto_approve");
    expect(result.message).toContain("7 days");

    // Verify cooldown persisted
    const loaded = await loadStore(ctx);
    expect(loaded.cooldowns).toHaveLength(1);
    expect(loaded.cooldowns[0].category).toBe("send_email");

    // Verify audit log
    const audit = await loadAuditLog(ctx);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0].eventType).toBe("recommendation_rejected");
  });
});

// ---------------------------------------------------------------------------
// Generate recommendations (integration-style)
// ---------------------------------------------------------------------------

describe("generateRecommendations", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `autonomy-gen-${Date.now()}`);
    await mkdir(join(tmpDir, "clawhq", "autonomy"), { recursive: true });
    await mkdir(join(tmpDir, "openclaw"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("generates recommendations from approval history", async () => {
    const ctx = makeCtx(tmpDir);

    // Write approval queue with high approval rate for send_email
    const entries: ApprovalEntry[] = [];
    for (let i = 0; i < 20; i++) {
      entries.push(
        makeEntry({ category: "send_email", status: "approved" }),
      );
    }
    entries.push(makeEntry({ category: "send_email", status: "rejected" }));

    const queuePath = join(tmpDir, "openclaw", "approvals.jsonl");
    const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await writeFile(queuePath, content, "utf-8");

    const config: AutonomyConfig = {
      ...DEFAULT_AUTONOMY_CONFIG,
      minimumSampleSize: 5,
    };

    const result = await generateRecommendations(ctx, config, {
      queuePath,
    });

    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations[0].type).toBe("auto_approve");
    expect(result.recommendations[0].category).toBe("send_email");

    // Verify persisted
    const store = await loadStore(ctx);
    expect(store.recommendations.length).toBeGreaterThan(0);

    // Verify audit log
    const audit = await loadAuditLog(ctx);
    expect(audit.entries.length).toBeGreaterThan(0);
  });

  it("does not duplicate pending recommendations", async () => {
    const ctx = makeCtx(tmpDir);

    // Pre-populate with a pending recommendation
    const store: RecommendationStore = {
      recommendations: [
        {
          id: "rec-existing",
          createdAt: new Date().toISOString(),
          category: "send_email",
          type: "auto_approve",
          rationale: "test",
          confidence: 0.9,
          stats: makeStats(),
          status: "pending",
        },
      ],
      cooldowns: [],
    };
    await saveStore(ctx, store);

    // Write approval queue
    const entries: ApprovalEntry[] = [];
    for (let i = 0; i < 20; i++) {
      entries.push(makeEntry({ category: "send_email", status: "approved" }));
    }
    const queuePath = join(tmpDir, "openclaw", "approvals.jsonl");
    await writeFile(queuePath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");

    const config: AutonomyConfig = { ...DEFAULT_AUTONOMY_CONFIG, minimumSampleSize: 5 };
    const result = await generateRecommendations(ctx, config, { queuePath });

    // No new recommendations since one already exists for this category/type
    expect(result.recommendations).toHaveLength(0);
    expect(result.allPending).toHaveLength(1);
    expect(result.allPending[0].id).toBe("rec-existing");
  });

  it("respects cooldowns from rejected recommendations", async () => {
    const ctx = makeCtx(tmpDir);
    const now = new Date();

    const store: RecommendationStore = {
      recommendations: [],
      cooldowns: [
        {
          recommendationId: "rec-old",
          category: "send_email",
          type: "auto_approve",
          rejectedAt: now.toISOString(),
          cooldownExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
    };
    await saveStore(ctx, store);

    const entries: ApprovalEntry[] = [];
    for (let i = 0; i < 20; i++) {
      entries.push(makeEntry({ category: "send_email", status: "approved" }));
    }
    const queuePath = join(tmpDir, "openclaw", "approvals.jsonl");
    await writeFile(queuePath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");

    const config: AutonomyConfig = { ...DEFAULT_AUTONOMY_CONFIG, minimumSampleSize: 5 };
    const result = await generateRecommendations(ctx, config, { queuePath });

    expect(result.recommendations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Formatting tests
// ---------------------------------------------------------------------------

describe("formatRecommendations", () => {
  it("shows message for empty recommendations", () => {
    expect(formatRecommendations([])).toContain("No autonomy recommendations");
  });

  it("formats recommendations with details", () => {
    const output = formatRecommendations([
      {
        id: "rec-1",
        createdAt: new Date().toISOString(),
        category: "send_email",
        type: "auto_approve",
        rationale: "High approval rate",
        confidence: 0.95,
        stats: makeStats(),
        status: "pending",
      },
    ]);

    expect(output).toContain("rec-1");
    expect(output).toContain("send_email");
    expect(output).toContain("Auto-approve");
    expect(output).toContain("95.0%");
  });
});

describe("formatDryRun", () => {
  it("shows message when no changes", () => {
    expect(formatDryRun([])).toContain("No changes would be made");
  });

  it("shows proposed changes", () => {
    const output = formatDryRun([
      {
        id: "rec-1",
        createdAt: new Date().toISOString(),
        category: "send_email",
        type: "auto_approve",
        rationale: "test",
        confidence: 0.95,
        stats: makeStats(),
        status: "pending",
      },
    ]);

    expect(output).toContain("WOULD AUTO-APPROVE");
    expect(output).toContain("send_email");
    expect(output).toContain("--dry-run");
  });
});
