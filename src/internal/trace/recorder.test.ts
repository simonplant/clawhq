import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadDecisions, recordDecision, saveDecisions } from "./recorder.js";
import type { TraceContext } from "./types.js";

describe("recorder", () => {
  let tmpDir: string;
  let ctx: TraceContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `trace-rec-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    ctx = { clawhqDir: tmpDir };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("loadDecisions", () => {
    it("returns empty store when file does not exist", async () => {
      const store = await loadDecisions(ctx);
      expect(store.entries).toHaveLength(0);
    });

    it("loads existing entries from disk", async () => {
      await mkdir(join(tmpDir, "trace"), { recursive: true });
      const data = {
        entries: [
          {
            id: "dec-123-abcd",
            timestamp: "2026-03-14T10:00:00.000Z",
            actionType: "email_triage",
            summary: "Marked email as urgent",
            factors: [],
            outcome: "Email flagged",
          },
        ],
      };
      await import("node:fs/promises").then((fs) =>
        fs.writeFile(
          join(tmpDir, "trace", "decision-trace.json"),
          JSON.stringify(data),
          "utf-8",
        ),
      );

      const store = await loadDecisions(ctx);
      expect(store.entries).toHaveLength(1);
      expect(store.entries[0].id).toBe("dec-123-abcd");
    });
  });

  describe("saveDecisions", () => {
    it("creates trace directory and writes store", async () => {
      const store = {
        entries: [
          {
            id: "dec-456-efgh",
            timestamp: "2026-03-14T11:00:00.000Z",
            actionType: "calendar_update",
            summary: "Rescheduled meeting",
            factors: [],
            outcome: "Meeting moved",
          },
        ],
      };

      await saveDecisions(ctx, store);

      const content = await readFile(
        join(tmpDir, "trace", "decision-trace.json"),
        "utf-8",
      );
      const parsed = JSON.parse(content);
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.entries[0].id).toBe("dec-456-efgh");
    });
  });

  describe("recordDecision", () => {
    it("creates an entry with generated ID and timestamp", async () => {
      const entry = await recordDecision(ctx, {
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
      });

      expect(entry.id).toMatch(/^dec-/);
      expect(entry.timestamp).toBeTruthy();
      expect(entry.actionType).toBe("email_triage");
      expect(entry.factors).toHaveLength(2);
      expect(entry.outcome).toBe("Email flagged as urgent");
    });

    it("persists entry to disk", async () => {
      await recordDecision(ctx, {
        actionType: "task_completion",
        summary: "Completed task",
        factors: [],
        outcome: "Task done",
      });

      const store = await loadDecisions(ctx);
      expect(store.entries).toHaveLength(1);
    });

    it("appends to existing entries", async () => {
      await recordDecision(ctx, {
        actionType: "first",
        summary: "First action",
        factors: [],
        outcome: "Done",
      });

      await recordDecision(ctx, {
        actionType: "second",
        summary: "Second action",
        factors: [],
        outcome: "Done",
      });

      const store = await loadDecisions(ctx);
      expect(store.entries).toHaveLength(2);
    });

    it("records parent ID for chained decisions", async () => {
      const parent = await recordDecision(ctx, {
        actionType: "email_read",
        summary: "Read email from John",
        factors: [],
        outcome: "Email read",
      });

      const child = await recordDecision(ctx, {
        actionType: "email_reply",
        summary: "Drafted reply",
        factors: [],
        outcome: "Draft created",
        parentId: parent.id,
      });

      expect(child.parentId).toBe(parent.id);
    });
  });
});
