/**
 * Threshold proposer — when enough signals accumulate in a category,
 * generates a preference update proposal for user approval.
 *
 * Proposals are persisted as JSON in the ClawHQ data directory.
 * No proposal is applied without explicit user approval.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { accumulateByCategory } from "./accumulator.js";
import type {
  CategoryAccumulation,
  LearningContext,
  PreferenceProposal,
  ProposalStore,
  SignalStore,
} from "./types.js";
import { DEFAULT_PROPOSAL_THRESHOLD } from "./types.js";

const PROPOSALS_FILE = "preference-proposals.json";

function proposalsPath(ctx: LearningContext): string {
  return join(ctx.clawhqDir, "learning", PROPOSALS_FILE);
}

async function ensureDir(ctx: LearningContext): Promise<void> {
  await mkdir(join(ctx.clawhqDir, "learning"), { recursive: true });
}

/** Load proposals from disk. */
export async function loadProposals(ctx: LearningContext): Promise<ProposalStore> {
  try {
    const content = await readFile(proposalsPath(ctx), "utf-8");
    return JSON.parse(content) as ProposalStore;
  } catch {
    return { proposals: [] };
  }
}

/** Save proposals to disk. */
export async function saveProposals(
  ctx: LearningContext,
  store: ProposalStore,
): Promise<void> {
  await ensureDir(ctx);
  await writeFile(
    proposalsPath(ctx),
    JSON.stringify(store, null, 2) + "\n",
    "utf-8",
  );
}

/**
 * Synthesize a preference description from accumulated signals.
 * Summarizes the corrections into a directive for the identity file.
 */
export function synthesizePreferenceText(accumulation: CategoryAccumulation): string {
  const { category, signals, dominantType } = accumulation;

  // Extract the most recent corrections as representative examples
  const sorted = [...signals].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  const recent = sorted.slice(0, 3);

  if (dominantType === "boundary") {
    // Boundaries are strong directives
    const corrections = recent.map((s) => s.correction);
    return `[Boundary — ${category}] ${corrections[0]}`;
  }

  // Preferences are softer directives
  const corrections = recent.map((s) => s.correction);
  return `[Learned preference — ${category}] ${corrections[0]}`;
}

/**
 * Check accumulated signals and generate proposals for categories
 * that have reached the threshold.
 *
 * Only creates new proposals for categories that don't already have
 * a pending or approved proposal.
 */
export async function checkAndPropose(
  ctx: LearningContext,
  signalStore: SignalStore,
  threshold: number = DEFAULT_PROPOSAL_THRESHOLD,
): Promise<PreferenceProposal[]> {
  const accumulations = accumulateByCategory(signalStore);
  const proposalStore = await loadProposals(ctx);
  const newProposals: PreferenceProposal[] = [];

  for (const acc of accumulations) {
    if (acc.signals.length < threshold) continue;

    // Skip if there's already a pending/approved proposal for this category + file
    const existing = proposalStore.proposals.find(
      (p) =>
        p.category === acc.category &&
        p.targetFile === acc.appliedToIdentity &&
        (p.status === "pending" || p.status === "approved"),
    );
    if (existing) continue;

    const now = new Date();
    const proposal: PreferenceProposal = {
      id: `prop-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
      proposedAt: now.toISOString(),
      category: acc.category,
      targetFile: acc.appliedToIdentity,
      proposedText: synthesizePreferenceText(acc),
      signalCount: acc.signals.length,
      signalType: acc.dominantType,
      signalIds: acc.signals.map((s) => s.id),
      status: "pending",
    };

    newProposals.push(proposal);
    proposalStore.proposals.push(proposal);
  }

  if (newProposals.length > 0) {
    await saveProposals(ctx, proposalStore);
  }

  return newProposals;
}

/** Approve a proposal by ID. Returns the updated proposal or null if not found. */
export async function approveProposal(
  ctx: LearningContext,
  proposalId: string,
): Promise<PreferenceProposal | null> {
  const store = await loadProposals(ctx);
  const proposal = store.proposals.find((p) => p.id === proposalId);
  if (!proposal || proposal.status !== "pending") return null;

  proposal.status = "approved";
  await saveProposals(ctx, store);
  return proposal;
}

/** Reject a proposal by ID. Returns the updated proposal or null if not found. */
export async function rejectProposal(
  ctx: LearningContext,
  proposalId: string,
): Promise<PreferenceProposal | null> {
  const store = await loadProposals(ctx);
  const proposal = store.proposals.find((p) => p.id === proposalId);
  if (!proposal || proposal.status !== "pending") return null;

  proposal.status = "rejected";
  await saveProposals(ctx, store);
  return proposal;
}

/** Get all pending proposals. */
export async function getPendingProposals(
  ctx: LearningContext,
): Promise<PreferenceProposal[]> {
  const store = await loadProposals(ctx);
  return store.proposals.filter((p) => p.status === "pending");
}
