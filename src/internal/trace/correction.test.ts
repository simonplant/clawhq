import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LearningContext } from "../learning/index.js";

import { processCorrection } from "./correction.js";
import type { DecisionEntry, TraceCorrection } from "./types.js";

describe("processCorrection", () => {
  let tmpDir: string;
  let learningCtx: LearningContext;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `trace-corr-${Date.now()}`);
    await mkdir(join(tmpDir, "clawhq", "learning"), { recursive: true });
    learningCtx = {
      openclawHome: join(tmpDir, "openclaw"),
      clawhqDir: join(tmpDir, "clawhq"),
    };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const sampleEntry: DecisionEntry = {
    id: "dec-001",
    timestamp: "2026-03-14T08:00:00.000Z",
    actionType: "email_triage",
    summary: "Marked email as urgent",
    factors: [
      {
        kind: "preference",
        source: "USER.md",
        content: "John is a VIP contact",
        weight: 0.8,
      },
    ],
    outcome: "Email flagged",
  };

  it("creates a preference signal from correction", async () => {
    const correction: TraceCorrection = {
      decisionId: "dec-001",
      correctionText: "That email wasn't urgent, use a lower priority",
      timestamp: new Date().toISOString(),
    };

    const signal = await processCorrection(correction, sampleEntry, learningCtx);

    expect(signal.id).toMatch(/^sig-/);
    expect(signal.signalType).toBe("preference");
    expect(signal.actionType).toBe("email_triage");
    expect(signal.originalDecision).toBe("Marked email as urgent");
    expect(signal.correction).toBe("That email wasn't urgent, use a lower priority");
  });

  it("classifies boundary corrections", async () => {
    const correction: TraceCorrection = {
      decisionId: "dec-001",
      correctionText: "Never mark personal emails as urgent",
      timestamp: new Date().toISOString(),
    };

    const signal = await processCorrection(correction, sampleEntry, learningCtx);

    expect(signal.signalType).toBe("boundary");
  });

  it("targets USER.md when decision has preference factors", async () => {
    const correction: TraceCorrection = {
      decisionId: "dec-001",
      correctionText: "Use a softer tone",
      timestamp: new Date().toISOString(),
    };

    const signal = await processCorrection(correction, sampleEntry, learningCtx);

    expect(signal.appliedToIdentity).toBe("USER.md");
  });

  it("targets AGENTS.md when decision has rule factors only", async () => {
    const ruleEntry: DecisionEntry = {
      ...sampleEntry,
      factors: [
        {
          kind: "rule",
          source: "AGENTS.md",
          content: "Always flag VIP emails",
          weight: 0.9,
        },
      ],
    };

    const correction: TraceCorrection = {
      decisionId: "dec-001",
      correctionText: "Don't auto-flag, let me decide",
      timestamp: new Date().toISOString(),
    };

    const signal = await processCorrection(correction, ruleEntry, learningCtx);

    expect(signal.appliedToIdentity).toBe("AGENTS.md");
  });

  it("derives category from action type", async () => {
    const entry: DecisionEntry = {
      ...sampleEntry,
      actionType: "calendar_update",
    };

    const correction: TraceCorrection = {
      decisionId: "dec-001",
      correctionText: "Don't reschedule without asking",
      timestamp: new Date().toISOString(),
    };

    const signal = await processCorrection(correction, entry, learningCtx);

    expect(signal.category).toBe("calendar-update");
  });

  it("persists signal to learning store", async () => {
    const correction: TraceCorrection = {
      decisionId: "dec-001",
      correctionText: "Prefer shorter summaries",
      timestamp: new Date().toISOString(),
    };

    await processCorrection(correction, sampleEntry, learningCtx);

    const storePath = join(tmpDir, "clawhq", "learning", "preference-signals.json");
    const content = await readFile(storePath, "utf-8");
    const store = JSON.parse(content);
    expect(store.signals).toHaveLength(1);
    expect(store.signals[0].correction).toBe("Prefer shorter summaries");
  });
});
