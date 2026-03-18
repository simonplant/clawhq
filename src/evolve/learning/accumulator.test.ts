import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  accumulateByCategory,
  determineDominantType,
  loadSignals,
  recordSignal,
} from "./accumulator.js";
import type { LearningContext, PreferenceSignal, SignalStore } from "./types.js";

function makeCtx(tmpDir: string): LearningContext {
  return {
    openclawHome: join(tmpDir, "openclaw"),
    clawhqDir: join(tmpDir, "clawhq"),
  };
}

function makeSignal(overrides: Partial<PreferenceSignal> = {}): PreferenceSignal {
  return {
    id: `sig-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    actionType: "email_reply",
    originalDecision: "Used formal tone",
    correction: "Use casual tone",
    signalType: "preference",
    appliedToIdentity: "USER.md",
    category: "email-tone",
    ...overrides,
  };
}

describe("accumulator persistence", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `learning-acc-${Date.now()}`);
    await mkdir(join(tmpDir, "clawhq", "learning"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty store when no file exists", async () => {
    const ctx = makeCtx(tmpDir);
    const store = await loadSignals(ctx);
    expect(store.signals).toHaveLength(0);
  });

  it("records and persists signals", async () => {
    const ctx = makeCtx(tmpDir);
    const signal = makeSignal({ id: "sig-test-1" });

    await recordSignal(ctx, signal);

    const store = await loadSignals(ctx);
    expect(store.signals).toHaveLength(1);
    expect(store.signals[0].id).toBe("sig-test-1");
  });

  it("appends multiple signals", async () => {
    const ctx = makeCtx(tmpDir);

    await recordSignal(ctx, makeSignal({ id: "sig-1" }));
    await recordSignal(ctx, makeSignal({ id: "sig-2" }));
    await recordSignal(ctx, makeSignal({ id: "sig-3" }));

    const store = await loadSignals(ctx);
    expect(store.signals).toHaveLength(3);
  });
});

describe("accumulateByCategory", () => {
  it("groups signals by category and identity file", () => {
    const store: SignalStore = {
      signals: [
        makeSignal({ id: "s1", category: "email-tone" }),
        makeSignal({ id: "s2", category: "email-tone" }),
        makeSignal({ id: "s3", category: "scheduling" }),
      ],
    };

    const groups = accumulateByCategory(store);
    expect(groups).toHaveLength(2);

    const emailGroup = groups.find((g) => g.category === "email-tone");
    expect(emailGroup?.signals).toHaveLength(2);

    const schedGroup = groups.find((g) => g.category === "scheduling");
    expect(schedGroup?.signals).toHaveLength(1);
  });

  it("excludes one-time signals from accumulation", () => {
    const store: SignalStore = {
      signals: [
        makeSignal({ id: "s1", category: "email-tone", signalType: "preference" }),
        makeSignal({ id: "s2", category: "email-tone", signalType: "one-time" }),
        makeSignal({ id: "s3", category: "email-tone", signalType: "preference" }),
      ],
    };

    const groups = accumulateByCategory(store);
    expect(groups).toHaveLength(1);
    expect(groups[0].signals).toHaveLength(2);
    expect(groups[0].signals.every((s) => s.signalType !== "one-time")).toBe(true);
  });

  it("separates signals by identity file", () => {
    const store: SignalStore = {
      signals: [
        makeSignal({ id: "s1", category: "tone", appliedToIdentity: "USER.md" }),
        makeSignal({ id: "s2", category: "tone", appliedToIdentity: "AGENTS.md" }),
      ],
    };

    const groups = accumulateByCategory(store);
    expect(groups).toHaveLength(2);
  });

  it("returns empty array for empty store", () => {
    const groups = accumulateByCategory({ signals: [] });
    expect(groups).toHaveLength(0);
  });
});

describe("determineDominantType", () => {
  it("returns boundary when any signal is boundary", () => {
    const signals = [
      makeSignal({ signalType: "preference" }),
      makeSignal({ signalType: "boundary" }),
      makeSignal({ signalType: "preference" }),
    ];
    expect(determineDominantType(signals)).toBe("boundary");
  });

  it("returns preference when no boundary signals exist", () => {
    const signals = [
      makeSignal({ signalType: "preference" }),
      makeSignal({ signalType: "preference" }),
    ];
    expect(determineDominantType(signals)).toBe("preference");
  });

  it("boundary signals are never overridden by preference signals", () => {
    // Even with 10 preferences and 1 boundary, boundary dominates
    const signals = [
      ...Array.from({ length: 10 }, (_, i) => makeSignal({ id: `p-${i}`, signalType: "preference" })),
      makeSignal({ id: "b-1", signalType: "boundary" }),
    ];
    expect(determineDominantType(signals)).toBe("boundary");
  });
});
