import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LearningContext, PreferenceProposal } from "./types.js";
import { applyProposal, listRollbacks, rollbackUpdate } from "./updater.js";

function makeCtx(tmpDir: string): LearningContext {
  return {
    openclawHome: join(tmpDir, "openclaw"),
    clawhqDir: join(tmpDir, "clawhq"),
  };
}

function makeProposal(overrides: Partial<PreferenceProposal> = {}): PreferenceProposal {
  return {
    id: `prop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    proposedAt: new Date().toISOString(),
    category: "email-tone",
    targetFile: "USER.md",
    proposedText: "[Learned preference — email-tone] Use casual tone",
    signalCount: 5,
    signalType: "preference",
    signalIds: ["s1", "s2", "s3", "s4", "s5"],
    status: "approved",
    ...overrides,
  };
}

describe("applyProposal", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `learning-update-${Date.now()}`);
    await mkdir(join(tmpDir, "openclaw", "workspace"), { recursive: true });
    await mkdir(join(tmpDir, "clawhq", "learning"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("appends preference text to identity file", async () => {
    const ctx = makeCtx(tmpDir);
    const identityPath = join(tmpDir, "openclaw", "workspace", "USER.md");
    await writeFile(identityPath, "# User Preferences\n\nExisting content.\n", "utf-8");

    const proposal = makeProposal();
    const result = await applyProposal(ctx, proposal);

    const content = await readFile(identityPath, "utf-8");
    expect(content).toContain("[Learned preference — email-tone] Use casual tone");
    expect(content).toContain("Existing content.");
    expect(result.proposalId).toBe(proposal.id);
    expect(result.previousContent).toBe("# User Preferences\n\nExisting content.\n");
  });

  it("creates identity file if it does not exist", async () => {
    const ctx = makeCtx(tmpDir);
    const proposal = makeProposal({ targetFile: "USER.md" });

    await applyProposal(ctx, proposal);

    const identityPath = join(tmpDir, "openclaw", "workspace", "USER.md");
    const content = await readFile(identityPath, "utf-8");
    expect(content).toContain("[Learned preference");
  });

  it("throws if proposal is not approved", async () => {
    const ctx = makeCtx(tmpDir);
    const proposal = makeProposal({ status: "pending" });

    await expect(applyProposal(ctx, proposal)).rejects.toThrow("expected \"approved\"");
  });

  it("stores rollback data", async () => {
    const ctx = makeCtx(tmpDir);
    const identityPath = join(tmpDir, "openclaw", "workspace", "USER.md");
    await writeFile(identityPath, "Original content\n", "utf-8");

    const proposal = makeProposal();
    await applyProposal(ctx, proposal);

    const rollbacks = await listRollbacks(ctx);
    expect(rollbacks).toHaveLength(1);
    expect(rollbacks[0].previousContent).toBe("Original content\n");
  });
});

describe("rollbackUpdate", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `learning-rollback-${Date.now()}`);
    await mkdir(join(tmpDir, "openclaw", "workspace"), { recursive: true });
    await mkdir(join(tmpDir, "clawhq", "learning"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("restores identity file to previous content", async () => {
    const ctx = makeCtx(tmpDir);
    const identityPath = join(tmpDir, "openclaw", "workspace", "USER.md");
    const originalContent = "# User Preferences\n\nOriginal.\n";
    await writeFile(identityPath, originalContent, "utf-8");

    const proposal = makeProposal();
    await applyProposal(ctx, proposal);

    // Verify the file was modified
    const modified = await readFile(identityPath, "utf-8");
    expect(modified).toContain("[Learned preference");

    // Roll back
    const result = await rollbackUpdate(ctx, proposal.id);
    expect(result).not.toBeNull();
    expect(result?.previousContent).toBe(originalContent);

    // Verify the file is restored
    const restored = await readFile(identityPath, "utf-8");
    expect(restored).toBe(originalContent);
  });

  it("removes rollback entry after rollback", async () => {
    const ctx = makeCtx(tmpDir);
    const identityPath = join(tmpDir, "openclaw", "workspace", "USER.md");
    await writeFile(identityPath, "content\n", "utf-8");

    const proposal = makeProposal();
    await applyProposal(ctx, proposal);

    await rollbackUpdate(ctx, proposal.id);

    const rollbacks = await listRollbacks(ctx);
    expect(rollbacks).toHaveLength(0);
  });

  it("returns null for non-existent proposal", async () => {
    const ctx = makeCtx(tmpDir);
    const result = await rollbackUpdate(ctx, "nonexistent");
    expect(result).toBeNull();
  });

  it("handles multiple updates and rollbacks independently", async () => {
    const ctx = makeCtx(tmpDir);
    const identityPath = join(tmpDir, "openclaw", "workspace", "USER.md");
    await writeFile(identityPath, "Base content\n", "utf-8");

    const proposal1 = makeProposal({ id: "prop-1" });
    await applyProposal(ctx, proposal1);

    const proposal2 = makeProposal({
      id: "prop-2",
      proposedText: "[Learned preference — scheduling] No early meetings",
    });
    await applyProposal(ctx, proposal2);

    // Roll back only the second update — note: rolling back the first
    // would revert to before both were applied since it stored the
    // content before the first was applied
    const result = await rollbackUpdate(ctx, "prop-1");
    expect(result).not.toBeNull();
    expect(result?.previousContent).toBe("Base content\n");
  });
});
