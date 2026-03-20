/**
 * Command queue — pull, verify, execute or reject.
 *
 * The cloud puts commands in a queue. The agent fetches on its schedule,
 * verifies the signature, and executes or rejects based on trust mode policy.
 * Pull model — the cloud never pushes. No open ports, no SSH, no reverse tunnels.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { CLOUD_COMMAND_QUEUE_MAX_HISTORY } from "../../config/defaults.js";
import type { TrustMode } from "../../config/types.js";
import { getCommandDisposition, isArchitecturallyBlocked } from "../trust-modes/policy.js";
import type {
  CommandQueueState,
  CommandResult,
  SignedCommand,
} from "../types.js";

import { verifyCommandSignature } from "./verify.js";

// ── Constants ────────────────────────────────────────────────────────────────

const QUEUE_FILE = "commands.json";

/** Max history entries to keep. */
const MAX_HISTORY = CLOUD_COMMAND_QUEUE_MAX_HISTORY;

// ── Path helpers ─────────────────────────────────────────────────────────────

/** Resolve commands.json path for a deployment directory. */
export function commandQueuePath(deployDir: string): string {
  return join(deployDir, "cloud", QUEUE_FILE);
}

// ── State management ─────────────────────────────────────────────────────────

/** Read command queue state from disk. */
export function readQueueState(deployDir: string): CommandQueueState {
  const path = commandQueuePath(deployDir);
  if (!existsSync(path)) {
    return { version: 1, pending: [], history: [] };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as CommandQueueState;
  } catch (err) {
    console.warn("[cloud] Failed to read command queue state:", err);
    return { version: 1, pending: [], history: [] };
  }
}

/** Write command queue state atomically. */
function writeQueueState(deployDir: string, state: CommandQueueState): void {
  const path = commandQueuePath(deployDir);
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(state, null, 2) + "\n";
  const tmpName = `.commands.tmp.${randomBytes(6).toString("hex")}`;
  const tmpPath = join(dir, tmpName);

  try {
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, path);
  } catch (err) {
    throw new Error(
      `[cloud] Failed to write command queue state: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

// ── Queue operations ─────────────────────────────────────────────────────────

/**
 * Enqueue a command (simulates pulling from cloud).
 *
 * In production, this would fetch from the cloud endpoint.
 * Commands are added to the pending queue for processing.
 */
export function enqueueCommand(
  deployDir: string,
  command: SignedCommand,
): void {
  const state = readQueueState(deployDir);
  const updated: CommandQueueState = {
    ...state,
    pending: [...state.pending, command],
  };
  writeQueueState(deployDir, updated);
}

/**
 * Process the next pending command.
 *
 * 1. Verify signature against pinned public key
 * 2. Check trust mode policy
 * 3. Execute if allowed, reject if blocked or tampered
 *
 * Returns the command result, or undefined if the queue is empty.
 */
export function processNextCommand(
  deployDir: string,
  trustMode: TrustMode,
  publicKeyPem: string,
): CommandResult | undefined {
  const state = readQueueState(deployDir);

  if (state.pending.length === 0) {
    return undefined;
  }

  const command = state.pending[0];
  const remaining = state.pending.slice(1);
  const now = new Date().toISOString();

  // Step 1: Check if architecturally blocked (AD-05)
  if (isArchitecturallyBlocked(command.type)) {
    const result: CommandResult = {
      commandId: command.id,
      type: command.type,
      disposition: "blocked",
      executed: false,
      error: "Architecturally blocked — no handler exists (AD-05)",
      timestamp: now,
    };
    appendResult(deployDir, remaining, state.history, result);
    return result;
  }

  // Step 2: Verify signature
  const verification = verifyCommandSignature(command, publicKeyPem);
  if (!verification.valid) {
    const result: CommandResult = {
      commandId: command.id,
      type: command.type,
      disposition: "blocked",
      executed: false,
      error: `Signature rejected: ${verification.reason}`,
      timestamp: now,
    };
    appendResult(deployDir, remaining, state.history, result);
    return result;
  }

  // Step 3: Check trust mode policy
  const disposition = getCommandDisposition(command.type, trustMode);

  if (disposition === "blocked") {
    const result: CommandResult = {
      commandId: command.id,
      type: command.type,
      disposition: "blocked",
      executed: false,
      error: `Blocked by ${trustMode} trust mode policy`,
      timestamp: now,
    };
    appendResult(deployDir, remaining, state.history, result);
    return result;
  }

  if (disposition === "approval") {
    // Requires user approval — leave in pending for approval queue
    const result: CommandResult = {
      commandId: command.id,
      type: command.type,
      disposition: "approval",
      executed: false,
      timestamp: now,
    };
    // Don't remove from pending — it needs approval first
    appendResult(deployDir, state.pending, state.history, result);
    return result;
  }

  // disposition is "allowed" or "auto" — execute
  const result: CommandResult = {
    commandId: command.id,
    type: command.type,
    disposition,
    executed: true,
    timestamp: now,
  };
  appendResult(deployDir, remaining, state.history, result);
  return result;
}

/**
 * Process all pending commands.
 *
 * Returns results for each command processed. Stops if a command requires
 * approval (it stays in pending and would loop forever otherwise).
 */
export function processAllCommands(
  deployDir: string,
  trustMode: TrustMode,
  publicKeyPem: string,
): readonly CommandResult[] {
  const results: CommandResult[] = [];
  const seen = new Set<string>();

  let result = processNextCommand(deployDir, trustMode, publicKeyPem);

  while (result) {
    results.push(result);
    // Stop if we've seen this command before (approval leaves it in pending)
    if (seen.has(result.commandId)) break;
    seen.add(result.commandId);
    // Check if there are more pending commands
    const state = readQueueState(deployDir);
    if (state.pending.length === 0) break;
    result = processNextCommand(deployDir, trustMode, publicKeyPem);
  }

  return results;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Append a result to history and write state. */
function appendResult(
  deployDir: string,
  pending: readonly SignedCommand[],
  history: readonly CommandResult[],
  result: CommandResult,
): void {
  const trimmedHistory = [...history, result].slice(-MAX_HISTORY);
  writeQueueState(deployDir, {
    version: 1,
    pending,
    history: trimmedHistory,
  });
}
