/**
 * Fleet management — multi-agent discovery, health aggregation,
 * and fleet-wide doctor.
 *
 * For the Fleet Operator persona: single pane of glass across all agents.
 */

// Types
export type {
  DiscoveredAgent,
  FleetAgent,
  FleetAgentDoctorResult,
  FleetDiscoveryResult,
  FleetDoctorReport,
  FleetHealthStatus,
  FleetRegistry,
} from "./types.js";

// Discovery + registry
export {
  discoverFleet,
  fleetRegistryPath,
  readFleetRegistry,
  registerAgent,
  unregisterAgent,
} from "./discovery.js";

// Health aggregation
export { getFleetHealth } from "./health.js";

// Fleet-wide doctor
export { runFleetDoctor } from "./doctor.js";

// Formatters
export {
  formatFleetDoctor,
  formatFleetDoctorJson,
  formatFleetHealth,
  formatFleetHealthJson,
  formatFleetList,
  formatFleetListJson,
} from "./format.js";
