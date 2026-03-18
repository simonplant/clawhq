import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAuditEntries, loadAuditLog, logEvent } from "./audit.js";
import type { LearningContext } from "./types.js";

function makeCtx(tmpDir: string): LearningContext {
  return {
    openclawHome: join(tmpDir, "openclaw"),
    clawhqDir: join(tmpDir, "clawhq"),
  };
}

describe("audit trail", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `learning-audit-${Date.now()}`);
    await mkdir(join(tmpDir, "clawhq", "learning"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty log when no file exists", async () => {
    const ctx = makeCtx(tmpDir);
    const log = await loadAuditLog(ctx);
    expect(log.entries).toHaveLength(0);
  });

  it("logs and persists an event", async () => {
    const ctx = makeCtx(tmpDir);

    const entry = await logEvent(
      ctx,
      "signal_recorded",
      "Recorded preference signal for email-tone",
      "sig-123",
    );

    expect(entry.eventType).toBe("signal_recorded");
    expect(entry.relatedId).toBe("sig-123");
    expect(entry.timestamp).toBeTruthy();

    const log = await loadAuditLog(ctx);
    expect(log.entries).toHaveLength(1);
  });

  it("appends multiple events", async () => {
    const ctx = makeCtx(tmpDir);

    await logEvent(ctx, "signal_recorded", "Signal 1", "sig-1");
    await logEvent(ctx, "proposal_created", "Proposal created", "prop-1");
    await logEvent(ctx, "proposal_approved", "Proposal approved", "prop-1");
    await logEvent(ctx, "preference_applied", "Preference applied", "prop-1");

    const log = await loadAuditLog(ctx);
    expect(log.entries).toHaveLength(4);
  });

  it("filters by event type", async () => {
    const ctx = makeCtx(tmpDir);

    await logEvent(ctx, "signal_recorded", "Signal 1", "sig-1");
    await logEvent(ctx, "signal_recorded", "Signal 2", "sig-2");
    await logEvent(ctx, "proposal_created", "Proposal", "prop-1");

    const signals = await getAuditEntries(ctx, "signal_recorded");
    expect(signals).toHaveLength(2);

    const proposals = await getAuditEntries(ctx, "proposal_created");
    expect(proposals).toHaveLength(1);
  });

  it("returns all entries when no filter", async () => {
    const ctx = makeCtx(tmpDir);

    await logEvent(ctx, "signal_recorded", "Signal", "sig-1");
    await logEvent(ctx, "preference_applied", "Applied", "prop-1");

    const all = await getAuditEntries(ctx);
    expect(all).toHaveLength(2);
  });

  it("logs rollback events", async () => {
    const ctx = makeCtx(tmpDir);

    await logEvent(
      ctx,
      "preference_rolled_back",
      "Rolled back preference for email-tone on USER.md",
      "prop-1",
    );

    const rollbacks = await getAuditEntries(ctx, "preference_rolled_back");
    expect(rollbacks).toHaveLength(1);
    expect(rollbacks[0].description).toContain("Rolled back");
  });
});
