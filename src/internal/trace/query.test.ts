import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { queryTrace } from "./query.js";
import type { DecisionStore, TraceContext } from "./types.js";
import { TraceError } from "./types.js";

describe("queryTrace", () => {
  let tmpDir: string;
  let ctx: TraceContext;

  const sampleStore: DecisionStore = {
    entries: [
      {
        id: "dec-001",
        timestamp: "2026-03-14T08:00:00.000Z",
        actionType: "email_triage",
        summary: "Read inbox",
        factors: [],
        outcome: "40 emails triaged",
      },
      {
        id: "dec-002",
        timestamp: "2026-03-14T08:01:00.000Z",
        actionType: "email_triage",
        summary: "Flagged email from John as urgent",
        factors: [
          {
            kind: "rule",
            source: "AGENTS.md",
            content: "VIP contacts get urgent flags",
            weight: 0.9,
          },
        ],
        outcome: "Email flagged",
        parentId: "dec-001",
      },
      {
        id: "dec-003",
        timestamp: "2026-03-14T09:00:00.000Z",
        actionType: "calendar_update",
        summary: "Rescheduled standup",
        factors: [
          {
            kind: "preference",
            source: "USER.md",
            content: "No meetings during focus blocks",
            weight: 0.8,
          },
        ],
        outcome: "Meeting moved to 2pm",
      },
      {
        id: "dec-004",
        timestamp: "2026-03-14T08:01:30.000Z",
        actionType: "email_reply",
        summary: "Drafted urgent reply to John",
        factors: [
          {
            kind: "context",
            source: "email",
            content: "John asked about project deadline",
            weight: 0.7,
          },
        ],
        outcome: "Reply drafted",
        parentId: "dec-002",
      },
    ],
  };

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `trace-query-${Date.now()}`);
    await mkdir(join(tmpDir, "trace"), { recursive: true });
    await writeFile(
      join(tmpDir, "trace", "decision-trace.json"),
      JSON.stringify(sampleStore),
      "utf-8",
    );
    ctx = { clawhqDir: tmpDir };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("query by ID", () => {
    it("returns the matching entry", async () => {
      const result = await queryTrace(ctx, { id: "dec-002" });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].id).toBe("dec-002");
    });

    it("builds the full parent chain", async () => {
      const result = await queryTrace(ctx, { id: "dec-004" });
      expect(result.chain).toHaveLength(3);
      expect(result.chain[0].id).toBe("dec-001");
      expect(result.chain[1].id).toBe("dec-002");
      expect(result.chain[2].id).toBe("dec-004");
    });

    it("returns single-entry chain for root decisions", async () => {
      const result = await queryTrace(ctx, { id: "dec-001" });
      expect(result.chain).toHaveLength(1);
      expect(result.chain[0].id).toBe("dec-001");
    });

    it("throws TraceError for unknown ID", async () => {
      await expect(
        queryTrace(ctx, { id: "dec-999" }),
      ).rejects.toThrow(TraceError);
    });
  });

  describe("query by action type", () => {
    it("filters entries by action type", async () => {
      const result = await queryTrace(ctx, { actionType: "email_triage" });
      expect(result.entries).toHaveLength(2);
      expect(result.entries.every((e) => e.actionType === "email_triage")).toBe(true);
    });

    it("returns empty for non-matching action type", async () => {
      const result = await queryTrace(ctx, { actionType: "nonexistent" });
      expect(result.entries).toHaveLength(0);
    });
  });

  describe("query by time range", () => {
    it("filters entries after 'since'", async () => {
      const result = await queryTrace(ctx, { since: "2026-03-14T08:30:00.000Z" });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].id).toBe("dec-003");
    });

    it("filters entries before 'before'", async () => {
      const result = await queryTrace(ctx, { before: "2026-03-14T08:01:00.000Z" });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].id).toBe("dec-001");
    });

    it("combines since and before", async () => {
      const result = await queryTrace(ctx, {
        since: "2026-03-14T08:00:30.000Z",
        before: "2026-03-14T08:30:00.000Z",
      });
      expect(result.entries).toHaveLength(2);
    });
  });

  describe("query with limit", () => {
    it("returns last N entries", async () => {
      const result = await queryTrace(ctx, { limit: 2 });
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].id).toBe("dec-003");
      expect(result.entries[1].id).toBe("dec-004");
    });
  });

  describe("combined filters", () => {
    it("applies action type and limit together", async () => {
      const result = await queryTrace(ctx, {
        actionType: "email_triage",
        limit: 1,
      });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].id).toBe("dec-002");
    });
  });

  describe("empty store", () => {
    it("returns empty results", async () => {
      await writeFile(
        join(tmpDir, "trace", "decision-trace.json"),
        JSON.stringify({ entries: [] }),
        "utf-8",
      );

      const result = await queryTrace(ctx, {});
      expect(result.entries).toHaveLength(0);
      expect(result.chain).toHaveLength(0);
    });
  });
});
