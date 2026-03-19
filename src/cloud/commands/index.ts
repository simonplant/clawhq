/**
 * Command queue — pull, verify signature, execute or reject.
 *
 * Pull model: agent fetches commands on its schedule.
 * Every command is signed with Ed25519 and verified before execution.
 * Content-access commands are architecturally blocked (AD-05).
 */

export {
  commandQueuePath,
  enqueueCommand,
  processAllCommands,
  processNextCommand,
  readQueueState,
} from "./queue.js";

export {
  buildSignatureMessage,
  verifyCommandSignature,
} from "./verify.js";
