/**
 * Fleet management — multi-agent dashboard.
 *
 * Provides agent discovery, aggregated status collection,
 * fleet-wide doctor diagnostics, and dashboard formatting.
 */

export { collectFleetStatus } from "./collector.js";
export { discoverAgents } from "./discovery.js";
export { runFleetDoctor } from "./doctor.js";
export {
  formatFleetDashboard,
  formatFleetDoctorJson,
  formatFleetDoctorTable,
  formatFleetJson,
} from "./format.js";
export type {
  FleetAgent,
  FleetAgentStatus,
  FleetCostSummary,
  FleetDoctorEntry,
  FleetDoctorReport,
  FleetHealthSummary,
  FleetReport,
  FleetSecuritySummary,
} from "./types.js";
