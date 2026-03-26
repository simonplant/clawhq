/**
 * Command queue — pull, verify, execute or reject.
 *
 * The cloud puts commands in a queue. The agent fetches on its schedule,
 * verifies the signature, and executes or rejects based on trust mode policy.
 * Pull model — the cloud never pushes. No open ports, no SSH, no reverse tunnels.
 *
 * Replay protection: commands are checked for freshness (max age) and duplicate
 * nonces (command IDs). A replayed command within the validity window is detected
 * and rejected via the history log.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { CLOUD_COMMAND_QUEUE_MAX_HISTORY, DIR_MODE_SECRET, FILE_MODE_SECRET } from "../../config/defaults.js";
import type { TrustMode } from "../../config/types.js";
import { getCommandDisposition, isArchitecturallyBlocked } from "../trust-modes/policy.js";
import type {
  CloudCommandType,
  CommandQueueState,
  CommandResult,
  SignedCommand,
} from "../types.js";

import type { VerifyCommandOptions } from "./verify.js";
import { verifyCommandSignature } from "./verify.js";

// ── Constants ────────────────────────────────────────────────────────────────

const QUEUE_FILE = "commands.json";

/** Max history entries to keep. */
const MAX_HISTORY = CLOUD_COMMAND_QUEUE_MAX_HISTORY;

// ── Handler types ───────────────────────────────────────────────────────────

/**
 * Handler for a specific cloud command type.
 *
 * Receives the command and returns a result or throws on failure.
 * Handlers are registered via CommandHandlerRegistry and dispatched by
 * processNextCommand when a command is allowed/auto-approved.
 */
export type CommandHandler = (
  command: SignedCommand,
) => CommandHandlerResult;

/** Result from a command handler. */
export interface CommandHandlerResult {
  readonly success: boolean;
  readonly error?: string;
}

/** Registry mapping command types to their handlers. */
export type CommandHandlerRegistry = Partial<
  Record<CloudCommandType, CommandHandler>
>;

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
  let parsed: Record<string, unknown>;
  try {
    const raw = readFileSync(path, "utf-8");
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { version: 1, pending: [], history: [] };
  }
  if (parsed.version !== 1) {
    throw new Error(
      `Unsupported command queue state version ${String(parsed.version)} (expected 1). ` +
      `The state file at ${path} may have been created by a newer version of ClawHQ.`,
    );
  }
  return parsed as unknown as CommandQueueState;
}

/** Write command queue state atomically. */
function writeQueueState(deployDir: string, state: CommandQueueState): void {
  const path = commandQueuePath(deployDir);
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE_SECRET });
  }
  chmodSync(dir, DIR_MODE_SECRET);

  const content = JSON.stringify(state, null, 2) + "\n";
  const tmpName = `.commands.tmp.${randomBytes(6).toString("hex")}`;
  const tmpPath = join(dir, tmpName);

  try {
    writeFileSync(tmpPath, content, { mode: FILE_MODE_SECRET });
    chmodSync(tmpPath, FILE_MODE_SECRET);
    renameSync(tmpPath, path);
  } catch (err) {
    throw new Error(
      `[cloud] Failed to write command queue state: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

// ── Nonce tracking ──────────────────────────────────────────────────────────

/**
 * Check whether a command ID has already been seen in the queue history.
 * This detects exact replays within the history window.
 */
function isReplayedCommand(
  commandId: string,
  history: readonly CommandResult[],
): boolean {
  return history.some((entry) => entry.commandId === commandId);
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

/** Options for processing commands. */
export interface ProcessCommandOptions {
  /** Verification options (maxAgeMs, now). */
  readonly verify?: VerifyCommandOptions;
  /** Handler registry for dispatching allowed commands. */
  readonly handlers?: CommandHandlerRegistry;
}

/**
 * Process the next pending command.
 *
 * 1. Check architectural blocks (AD-05)
 * 2. Check for replayed commands (nonce tracking)
 * 3. Verify signature + freshness against pinned public key
 * 4. Check trust mode policy
 * 5. Dispatch to handler if registered, or mark as executed
 *
 * Returns the command result, or undefined if the queue is empty.
 */
export function processNextCommand(
  deployDir: string,
  trustMode: TrustMode,
  publicKeyPem: string,
  options?: ProcessCommandOptions,
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

  // Step 2: Check for replayed commands (nonce tracking)
  if (isReplayedCommand(command.id, state.history)) {
    const result: CommandResult = {
      commandId: command.id,
      type: command.type,
      disposition: "blocked",
      executed: false,
      error: "Replayed command rejected: duplicate command ID",
      timestamp: now,
    };
    appendResult(deployDir, remaining, state.history, result);
    return result;
  }

  // Step 3: Verify signature + freshness
  const verification = verifyCommandSignature(
    command,
    publicKeyPem,
    options?.verify,
  );
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

  // Step 4: Check trust mode policy
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

  // Step 5: disposition is "allowed" or "auto" — dispatch to handler
  const handler = options?.handlers?.[command.type];
  if (handler) {
    try {
      const handlerResult = handler(command);
      if (!handlerResult.success) {
        const result: CommandResult = {
          commandId: command.id,
          type: command.type,
          disposition,
          executed: false,
          error: `Handler failed: ${handlerResult.error ?? "unknown error"}`,
          timestamp: now,
        };
        appendResult(deployDir, remaining, state.history, result);
        return result;
      }
    } catch (err) {
      const result: CommandResult = {
        commandId: command.id,
        type: command.type,
        disposition,
        executed: false,
        error: `Handler error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: now,
      };
      appendResult(deployDir, remaining, state.history, result);
      return result;
    }
  }

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
  options?: ProcessCommandOptions,
): readonly CommandResult[] {
  const results: CommandResult[] = [];
  const seen = new Set<string>();

  let result = processNextCommand(deployDir, trustMode, publicKeyPem, options);

  while (result) {
    results.push(result);
    // Stop if we've seen this command before (approval leaves it in pending)
    if (seen.has(result.commandId)) break;
    seen.add(result.commandId);
    // Check if there are more pending commands
    const state = readQueueState(deployDir);
    if (state.pending.length === 0) break;
    result = processNextCommand(deployDir, trustMode, publicKeyPem, options);
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
