import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  approveProposal,
  checkAndPropose,
  getPendingProposals,
  loadProposals,
  rejectProposal,
  synthesizePreferenceText,
} from "./proposer.js";
import type { CategoryAccumulation, LearningContext, PreferenceSignal, SignalStore } from "./types.js";

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
    correction: "Use casual tone instead",
    signalType: "preference",
    appliedToIdentity: "USER.md",
    category: "email-tone",
    ...overrides,
  };
}

describe("checkAndPropose", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `learning-prop-${Date.now()}`);
    await mkdir(join(tmpDir, "clawhq", "learning"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("does not propose when below threshold", async () => {
    const ctx = makeCtx(tmpDir);
    const store: SignalStore = {
      signals: Array.from({ length: 4 }, (_, i) =>
        makeSignal({ id: `sig-${i}` }),
      ),
    };

    const proposals = await checkAndPropose(ctx, store);
    expect(proposals).toHaveLength(0);
  });

  it("proposes when threshold is reached (5 signals)", async () => {
    const ctx = makeCtx(tmpDir);
    const store: SignalStore = {
      signals: Array.from({ length: 5 }, (_, i) =>
        makeSignal({ id: `sig-${i}` }),
      ),
    };

    const proposals = await checkAndPropose(ctx, store);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].category).toBe("email-tone");
    expect(proposals[0].targetFile).toBe("USER.md");
    expect(proposals[0].signalCount).toBe(5);
    expect(proposals[0].status).toBe("pending");
  });

  it("proposes with custom threshold", async () => {
    const ctx = makeCtx(tmpDir);
    const store: SignalStore = {
      signals: Array.from({ length: 3 }, (_, i) =>
        makeSignal({ id: `sig-${i}` }),
      ),
    };

    const proposals = await checkAndPropose(ctx, store, 3);
    expect(proposals).toHaveLength(1);
  });

  it("does not duplicate proposals for same category", async () => {
    const ctx = makeCtx(tmpDir);
    const store: SignalStore = {
      signals: Array.from({ length: 7 }, (_, i) =>
        makeSignal({ id: `sig-${i}` }),
      ),
    };

    const first = await checkAndPropose(ctx, store);
    expect(first).toHaveLength(1);

    const second = await checkAndPropose(ctx, store);
    expect(second).toHaveLength(0);
  });

  it("excludes one-time signals from threshold count", async () => {
    const ctx = makeCtx(tmpDir);
    const store: SignalStore = {
      signals: [
        ...Array.from({ length: 3 }, (_, i) =>
          makeSignal({ id: `pref-${i}`, signalType: "preference" }),
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          makeSignal({ id: `one-${i}`, signalType: "one-time" }),
        ),
      ],
    };

    const proposals = await checkAndPropose(ctx, store);
    expect(proposals).toHaveLength(0);
  });

  it("creates separate proposals for different categories", async () => {
    const ctx = makeCtx(tmpDir);
    const store: SignalStore = {
      signals: [
        ...Array.from({ length: 5 }, (_, i) =>
          makeSignal({ id: `tone-${i}`, category: "email-tone" }),
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          makeSignal({ id: `sched-${i}`, category: "scheduling", appliedToIdentity: "AGENTS.md" }),
        ),
      ],
    };

    const proposals = await checkAndPropose(ctx, store);
    expect(proposals).toHaveLength(2);
  });

  it("persists proposals to disk", async () => {
    const ctx = makeCtx(tmpDir);
    const store: SignalStore = {
      signals: Array.from({ length: 5 }, (_, i) =>
        makeSignal({ id: `sig-${i}` }),
      ),
    };

    await checkAndPropose(ctx, store);

    const loaded = await loadProposals(ctx);
    expect(loaded.proposals).toHaveLength(1);
  });
});

describe("approveProposal / rejectProposal", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `learning-approve-${Date.now()}`);
    await mkdir(join(tmpDir, "clawhq", "learning"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("approves a pending proposal", async () => {
    const ctx = makeCtx(tmpDir);
    const store: SignalStore = {
      signals: Array.from({ length: 5 }, (_, i) =>
        makeSignal({ id: `sig-${i}` }),
      ),
    };
    const [proposal] = await checkAndPropose(ctx, store);

    const approved = await approveProposal(ctx, proposal.id);
    expect(approved).not.toBeNull();
    expect(approved?.status).toBe("approved");
  });

  it("rejects a pending proposal", async () => {
    const ctx = makeCtx(tmpDir);
    const store: SignalStore = {
      signals: Array.from({ length: 5 }, (_, i) =>
        makeSignal({ id: `sig-${i}` }),
      ),
    };
    const [proposal] = await checkAndPropose(ctx, store);

    const rejected = await rejectProposal(ctx, proposal.id);
    expect(rejected).not.toBeNull();
    expect(rejected?.status).toBe("rejected");
  });

  it("returns null for non-existent proposal", async () => {
    const ctx = makeCtx(tmpDir);
    const result = await approveProposal(ctx, "nonexistent");
    expect(result).toBeNull();
  });

  it("returns null when approving already-approved proposal", async () => {
    const ctx = makeCtx(tmpDir);
    const store: SignalStore = {
      signals: Array.from({ length: 5 }, (_, i) =>
        makeSignal({ id: `sig-${i}` }),
      ),
    };
    const [proposal] = await checkAndPropose(ctx, store);

    await approveProposal(ctx, proposal.id);
    const second = await approveProposal(ctx, proposal.id);
    expect(second).toBeNull();
  });
});

describe("getPendingProposals", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `learning-pending-${Date.now()}`);
    await mkdir(join(tmpDir, "clawhq", "learning"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns only pending proposals", async () => {
    const ctx = makeCtx(tmpDir);
    const store: SignalStore = {
      signals: [
        ...Array.from({ length: 5 }, (_, i) =>
          makeSignal({ id: `a-${i}`, category: "cat-a" }),
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          makeSignal({ id: `b-${i}`, category: "cat-b" }),
        ),
      ],
    };

    const proposals = await checkAndPropose(ctx, store);
    expect(proposals).toHaveLength(2);

    await approveProposal(ctx, proposals[0].id);

    const pending = await getPendingProposals(ctx);
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(proposals[1].id);
  });
});

describe("synthesizePreferenceText", () => {
  it("generates boundary text for boundary signals", () => {
    const acc: CategoryAccumulation = {
      category: "data-access",
      appliedToIdentity: "AGENTS.md",
      signals: [makeSignal({ correction: "Never access health data", signalType: "boundary" })],
      dominantType: "boundary",
    };

    const text = synthesizePreferenceText(acc);
    expect(text).toContain("[Boundary");
    expect(text).toContain("data-access");
    expect(text).toContain("Never access health data");
  });

  it("generates preference text for preference signals", () => {
    const acc: CategoryAccumulation = {
      category: "email-tone",
      appliedToIdentity: "USER.md",
      signals: [makeSignal({ correction: "Use casual tone" })],
      dominantType: "preference",
    };

    const text = synthesizePreferenceText(acc);
    expect(text).toContain("[Learned preference");
    expect(text).toContain("email-tone");
    expect(text).toContain("Use casual tone");
  });
});
