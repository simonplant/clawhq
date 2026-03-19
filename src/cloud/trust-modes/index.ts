/**
 * Trust modes — paranoid, zero-trust, managed.
 *
 * Controls what the cloud layer can do. Paranoid disables everything.
 * Zero-trust allows agent-initiated outbound + signed commands with user approval.
 * Managed auto-approves operational commands; content is architecturally blocked.
 */

export {
  connectCloud,
  disconnectCloud,
  readTrustModeState,
  switchTrustMode,
  trustModePath,
} from "./switch.js";

export {
  getAllowedCommands,
  getCommandDisposition,
  isArchitecturallyBlocked,
  isCommandSupported,
} from "./policy.js";
