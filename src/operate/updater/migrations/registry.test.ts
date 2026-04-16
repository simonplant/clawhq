import { describe, expect, it } from "vitest";

import {
  buildMigrationPlan,
  buildMigrationPlanFrom,
  executeMigrationPlan,
  isConfigOnlyPlan,
  rollbackMigrations,
} from "./registry.js";
import type { Migration, MigrationContext, MigrationStepResult } from "./types.js";

// ── Test Migrations ───────────────────────────────────────────────────────

function makeMigration(overrides: Partial<Migration> & { id: string; fromVersion: string; toVersion: string }): Migration {
  return {
    description: `Test migration ${overrides.id}`,
    changes: [],
    async up() {
      return { success: true, migrationId: overrides.id };
    },
    async down() {
      return { success: true, migrationId: overrides.id };
    },
    ...overrides,
  };
}

const m1 = makeMigration({
  id: "2026.4.10-rename-exec",
  fromVersion: "v2026.4.9",
  toVersion: "v2026.4.10",
  changes: [{ type: "config-key-renamed", path: "tools.exec.host", description: "'sandbox' → 'container'" }],
});

const m2 = makeMigration({
  id: "2026.4.11-add-memory",
  fromVersion: "v2026.4.10",
  toVersion: "v2026.4.11",
  changes: [{ type: "config-key-added", path: "memory.provider", description: "New memory provider field" }],
});

const m3 = makeMigration({
  id: "2026.4.12-compose-update",
  fromVersion: "v2026.4.11",
  toVersion: "v2026.4.12",
  changes: [{ type: "compose-changed", path: "services.openclaw", description: "Updated compose structure" }],
});

const ALL = [m1, m2, m3] as const;

// ── Mock Context ──────────────────────────────────────────────────────────

function mockContext(overrides?: Partial<MigrationContext>): MigrationContext {
  return {
    deployDir: "/tmp/test-deploy",
    config: {},
    compose: "",
    env: "",
    async writeConfig() {},
    async writeCompose() {},
    async writeEnv() {},
    async readEngineFile() { return null; },
    async writeEngineFile() {},
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("buildMigrationPlanFrom", () => {
  it("selects migrations within the version range", () => {
    const plan = buildMigrationPlanFrom("v2026.4.9", "v2026.4.12", ALL);
    expect(plan.migrations).toHaveLength(3);
    expect(plan.migrations.map((m) => m.id)).toEqual([
      "2026.4.10-rename-exec",
      "2026.4.11-add-memory",
      "2026.4.12-compose-update",
    ]);
  });

  it("selects partial range", () => {
    const plan = buildMigrationPlanFrom("v2026.4.10", "v2026.4.12", ALL);
    expect(plan.migrations).toHaveLength(2);
    expect(plan.migrations.map((m) => m.id)).toEqual([
      "2026.4.11-add-memory",
      "2026.4.12-compose-update",
    ]);
  });

  it("selects single migration", () => {
    const plan = buildMigrationPlanFrom("v2026.4.9", "v2026.4.10", ALL);
    expect(plan.migrations).toHaveLength(1);
    expect(plan.migrations[0].id).toBe("2026.4.10-rename-exec");
  });

  it("returns empty plan when no migrations match", () => {
    const plan = buildMigrationPlanFrom("v2026.4.12", "v2026.5.0", ALL);
    expect(plan.migrations).toHaveLength(0);
  });

  it("excludes from version (exclusive lower bound)", () => {
    const plan = buildMigrationPlanFrom("v2026.4.10", "v2026.4.11", ALL);
    expect(plan.migrations).toHaveLength(1);
    expect(plan.migrations[0].id).toBe("2026.4.11-add-memory");
  });

  it("includes to version (inclusive upper bound)", () => {
    const plan = buildMigrationPlanFrom("v2026.4.11", "v2026.4.12", ALL);
    expect(plan.migrations).toHaveLength(1);
    expect(plan.migrations[0].id).toBe("2026.4.12-compose-update");
  });

  it("aggregates changes across migrations", () => {
    const plan = buildMigrationPlanFrom("v2026.4.9", "v2026.4.12", ALL);
    expect(plan.changes).toHaveLength(3);
  });

  it("detects breaking changes from compose-changed", () => {
    const plan = buildMigrationPlanFrom("v2026.4.9", "v2026.4.12", ALL);
    expect(plan.hasBreakingChanges).toBe(true);
  });

  it("no breaking changes when only config renames", () => {
    const plan = buildMigrationPlanFrom("v2026.4.9", "v2026.4.11", ALL);
    expect(plan.hasBreakingChanges).toBe(false);
  });

  it("orders migrations by target version", () => {
    // Pass migrations in reverse order
    const reversed = [...ALL].reverse();
    const plan = buildMigrationPlanFrom("v2026.4.9", "v2026.4.12", reversed);
    expect(plan.migrations.map((m) => m.id)).toEqual([
      "2026.4.10-rename-exec",
      "2026.4.11-add-memory",
      "2026.4.12-compose-update",
    ]);
  });
});

describe("buildMigrationPlan (global registry)", () => {
  it("returns empty plan for global registry (no migrations registered yet)", () => {
    const plan = buildMigrationPlan("v2026.4.9", "v2026.4.12");
    expect(plan.migrations).toHaveLength(0);
  });
});

describe("executeMigrationPlan", () => {
  it("executes all migrations in order", async () => {
    const executed: string[] = [];
    const migrations = ALL.map((m) => ({
      ...m,
      async up() {
        executed.push(m.id);
        return { success: true, migrationId: m.id } as MigrationStepResult;
      },
    }));

    const plan = buildMigrationPlanFrom("v2026.4.9", "v2026.4.12", migrations);
    const result = await executeMigrationPlan(plan, mockContext());

    expect(result.success).toBe(true);
    expect(result.applied).toHaveLength(3);
    expect(executed).toEqual([
      "2026.4.10-rename-exec",
      "2026.4.11-add-memory",
      "2026.4.12-compose-update",
    ]);
  });

  it("stops on first failure", async () => {
    const executed: string[] = [];
    const migrations = ALL.map((m) => ({
      ...m,
      async up(): Promise<MigrationStepResult> {
        executed.push(m.id);
        if (m.id === "2026.4.11-add-memory") {
          return { success: false, migrationId: m.id, error: "Test failure" };
        }
        return { success: true, migrationId: m.id };
      },
    }));

    const plan = buildMigrationPlanFrom("v2026.4.9", "v2026.4.12", migrations);
    const result = await executeMigrationPlan(plan, mockContext());

    expect(result.success).toBe(false);
    expect(result.applied).toHaveLength(2);
    expect(executed).toEqual(["2026.4.10-rename-exec", "2026.4.11-add-memory"]);
    expect(result.error).toContain("2026.4.11-add-memory");
  });

  it("catches thrown errors", async () => {
    const migrations = ALL.map((m) => ({
      ...m,
      async up(): Promise<MigrationStepResult> {
        if (m.id === "2026.4.10-rename-exec") {
          throw new Error("Unexpected crash");
        }
        return { success: true, migrationId: m.id };
      },
    }));

    const plan = buildMigrationPlanFrom("v2026.4.9", "v2026.4.12", migrations);
    const result = await executeMigrationPlan(plan, mockContext());

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unexpected crash");
  });

  it("handles empty plan", async () => {
    const plan = buildMigrationPlanFrom("v2026.4.12", "v2026.5.0", ALL);
    const result = await executeMigrationPlan(plan, mockContext());

    expect(result.success).toBe(true);
    expect(result.applied).toHaveLength(0);
  });

  it("respects abort signal", async () => {
    const ac = new AbortController();
    ac.abort();

    const plan = buildMigrationPlanFrom("v2026.4.9", "v2026.4.12", ALL);
    const result = await executeMigrationPlan(plan, mockContext({ signal: ac.signal }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("aborted");
  });
});

describe("rollbackMigrations", () => {
  it("rolls back in reverse order", async () => {
    const rolledBack: string[] = [];
    const migrations = ALL.map((m) => ({
      ...m,
      async down(): Promise<MigrationStepResult> {
        rolledBack.push(m.id);
        return { success: true, migrationId: m.id };
      },
    }));

    const applied: MigrationStepResult[] = migrations.map((m) => ({
      success: true,
      migrationId: m.id,
    }));

    const plan = buildMigrationPlanFrom("v2026.4.9", "v2026.4.12", migrations);
    const result = await rollbackMigrations(applied, plan, mockContext());

    expect(result.success).toBe(true);
    expect(rolledBack).toEqual([
      "2026.4.12-compose-update",
      "2026.4.11-add-memory",
      "2026.4.10-rename-exec",
    ]);
  });

  it("only rolls back successfully applied migrations", async () => {
    const rolledBack: string[] = [];
    const migrations = ALL.map((m) => ({
      ...m,
      async down(): Promise<MigrationStepResult> {
        rolledBack.push(m.id);
        return { success: true, migrationId: m.id };
      },
    }));

    // Only first migration was successfully applied
    const applied: MigrationStepResult[] = [
      { success: true, migrationId: "2026.4.10-rename-exec" },
      { success: false, migrationId: "2026.4.11-add-memory", error: "failed" },
    ];

    const plan = buildMigrationPlanFrom("v2026.4.9", "v2026.4.12", migrations);
    const result = await rollbackMigrations(applied, plan, mockContext());

    expect(result.success).toBe(true);
    expect(rolledBack).toEqual(["2026.4.10-rename-exec"]);
  });

  it("continues on rollback failure (best effort)", async () => {
    const migrations = ALL.map((m) => ({
      ...m,
      async down(): Promise<MigrationStepResult> {
        if (m.id === "2026.4.11-add-memory") {
          return { success: false, migrationId: m.id, error: "Rollback failed" };
        }
        return { success: true, migrationId: m.id };
      },
    }));

    const applied: MigrationStepResult[] = migrations.map((m) => ({
      success: true,
      migrationId: m.id,
    }));

    const plan = buildMigrationPlanFrom("v2026.4.9", "v2026.4.12", migrations);
    const result = await rollbackMigrations(applied, plan, mockContext());

    expect(result.success).toBe(false);
    expect(result.applied).toHaveLength(3); // All three attempted
  });
});

describe("isConfigOnlyPlan", () => {
  it("returns true for config-only changes", () => {
    const plan = buildMigrationPlanFrom("v2026.4.9", "v2026.4.11", ALL);
    expect(isConfigOnlyPlan(plan)).toBe(true);
  });

  it("returns false when compose changes are present", () => {
    const plan = buildMigrationPlanFrom("v2026.4.9", "v2026.4.12", ALL);
    expect(isConfigOnlyPlan(plan)).toBe(false);
  });

  it("returns true for empty plan", () => {
    const plan = buildMigrationPlanFrom("v2026.4.12", "v2026.5.0", ALL);
    expect(isConfigOnlyPlan(plan)).toBe(true);
  });
});
