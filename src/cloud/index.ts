/**
 * Cloud module — trust modes, heartbeat, command queue, provisioning.
 *
 * Optional layer for remote monitoring, managed hosting, and cloud provisioning.
 * Zero-trust by design: agent-initiated only, signed commands,
 * content architecturally blocked.
 */

// Types
export type {
  CloudCommandType,
  CommandDisposition,
  CommandQueueState,
  CommandResult,
  DisconnectResult,
  HeartbeatResult,
  HeartbeatState,
  HealthReport,
  SignedCommand,
  SwitchModeResult,
  TrustModeState,
  VerifyResult,
} from "./types.js";

// Trust modes
export {
  connectCloud,
  disconnectCloud,
  getAllowedCommands,
  getCommandDisposition,
  isArchitecturallyBlocked,
  isCommandSupported,
  readTrustModeState,
  switchTrustMode,
  trustModePath,
} from "./trust-modes/index.js";

// Heartbeat
export {
  collectHealthReport,
  heartbeatPath,
  readHeartbeatState,
  sendHeartbeat,
} from "./heartbeat/index.js";

// Commands
export {
  buildSignatureMessage,
  commandQueuePath,
  enqueueCommand,
  processAllCommands,
  processNextCommand,
  readQueueState,
  verifyCommandSignature,
} from "./commands/index.js";

// Formatters
export type { CloudStatusSnapshot } from "./formatters.js";
export {
  formatCloudStatus,
  formatCloudStatusJson,
  formatDisconnectResult,
  formatSwitchResult,
} from "./formatters.js";

// Fleet management
export type {
  DiscoveredAgent,
  FleetAgent,
  FleetAgentDoctorResult,
  FleetDiscoveryResult,
  FleetDoctorReport,
  FleetHealthStatus,
  FleetRegistry,
} from "./fleet/index.js";
export {
  discoverFleet,
  fleetRegistryPath,
  formatFleetDoctor,
  formatFleetDoctorJson,
  formatFleetHealth,
  formatFleetHealthJson,
  formatFleetList,
  formatFleetListJson,
  getFleetHealth,
  readFleetRegistry,
  registerAgent,
  runFleetDoctor,
  unregisterAgent,
} from "./fleet/index.js";

// Provisioning
export type {
  CloudCredentials,
  CloudProvider,
  DestroyOptions,
  DestroyResult as ProvisionDestroyResult,
  InstanceRegistry,
  InstanceRegistryStatus,
  InstanceStatus,
  InstanceStatusOptions,
  ProviderAdapter,
  ProviderCredential,
  ProvisionedInstance,
  ProvisionOptions,
  ProvisionProgress,
  ProvisionProgressCallback,
  ProvisionResult,
  ProvisionStepName,
} from "./provisioning/index.js";
export {
  cloudCredentialsPath,
  destroyInstance,
  findInstance,
  findInstanceByName,
  generateCloudInit,
  getInstanceStatus,
  getProviderCredential,
  instanceRegistryPath,
  pollInstanceHealth,
  provision,
  readCloudCredentials,
  readInstanceRegistry,
  removeProviderCredential,
  resolveAdapter,
  setProviderCredential,
} from "./provisioning/index.js";
