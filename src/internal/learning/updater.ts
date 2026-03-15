/**
 * Identity file updater — applies approved preference updates to identity
 * files with full rollback capability.
 *
 * Stores the previous file content before each update so that any
 * preference change can be reversed.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  LearningContext,
  PreferenceProposal,
  UpdateResult,
} from "./types.js";

const ROLLBACKS_FILE = "preference-rollbacks.json";

interface RollbackStore {
  updates: UpdateResult[];
}

function rollbacksPath(ctx: LearningContext): string {
  return join(ctx.clawhqDir, "learning", ROLLBACKS_FILE);
}

function identityFilePath(ctx: LearningContext, filename: string): string {
  return join(
    ctx.openclawHome.replace(/^~/, process.env.HOME ?? "~"),
    "workspace",
    filename,
  );
}

async function ensureDir(ctx: LearningContext): Promise<void> {
  await mkdir(join(ctx.clawhqDir, "learning"), { recursive: true });
}

/** Load the rollback store. */
export async function loadRollbacks(ctx: LearningContext): Promise<RollbackStore> {
  try {
    const content = await readFile(rollbacksPath(ctx), "utf-8");
    return JSON.parse(content) as RollbackStore;
  } catch {
    return { updates: [] };
  }
}

/** Save the rollback store. */
async function saveRollbacks(
  ctx: LearningContext,
  store: RollbackStore,
): Promise<void> {
  await ensureDir(ctx);
  await writeFile(
    rollbacksPath(ctx),
    JSON.stringify(store, null, 2) + "\n",
    "utf-8",
  );
}

/**
 * Apply an approved proposal to the target identity file.
 *
 * Appends the proposed text to the identity file and stores the
 * previous content for rollback.
 *
 * Throws if the proposal is not in "approved" status.
 */
export async function applyProposal(
  ctx: LearningContext,
  proposal: PreferenceProposal,
): Promise<UpdateResult> {
  if (proposal.status !== "approved") {
    throw new Error(
      `Cannot apply proposal "${proposal.id}" — status is "${proposal.status}", expected "approved".`,
    );
  }

  const filePath = identityFilePath(ctx, proposal.targetFile);

  // Read current content (or empty if file doesn't exist yet)
  let previousContent = "";
  try {
    previousContent = await readFile(filePath, "utf-8");
  } catch {
    // File doesn't exist — will create it
  }

  // Append the learned preference with a clear marker
  const separator = previousContent.endsWith("\n") || previousContent === "" ? "" : "\n";
  const newContent = previousContent + separator + "\n" + proposal.proposedText + "\n";

  // Ensure workspace directory exists
  const workspaceDir = join(
    ctx.openclawHome.replace(/^~/, process.env.HOME ?? "~"),
    "workspace",
  );
  await mkdir(workspaceDir, { recursive: true });

  await writeFile(filePath, newContent, "utf-8");

  const result: UpdateResult = {
    proposalId: proposal.id,
    targetFile: proposal.targetFile,
    addedText: proposal.proposedText,
    appliedAt: new Date().toISOString(),
    previousContent,
  };

  // Store rollback data
  const store = await loadRollbacks(ctx);
  store.updates.push(result);
  await saveRollbacks(ctx, store);

  return result;
}

/**
 * Roll back a previously applied preference update.
 *
 * Restores the identity file to its content before the update was applied.
 * Returns the update that was rolled back, or null if not found.
 */
export async function rollbackUpdate(
  ctx: LearningContext,
  proposalId: string,
): Promise<UpdateResult | null> {
  const store = await loadRollbacks(ctx);
  const idx = store.updates.findIndex((u) => u.proposalId === proposalId);
  if (idx === -1) return null;

  const update = store.updates[idx];
  const filePath = identityFilePath(ctx, update.targetFile);

  // Restore the previous content
  await writeFile(filePath, update.previousContent, "utf-8");

  // Remove from rollback store
  store.updates.splice(idx, 1);
  await saveRollbacks(ctx, store);

  return update;
}

/** List all applied updates that can be rolled back. */
export async function listRollbacks(ctx: LearningContext): Promise<UpdateResult[]> {
  const store = await loadRollbacks(ctx);
  return store.updates;
}
