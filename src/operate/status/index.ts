/**
 * Status dashboard — public API.
 *
 * Re-exports the status gatherer, formatters, and types.
 */

export { getStatus, watchStatus } from "./status.js";
export { formatStatusJson, formatStatusTable } from "./format.js";
export type {
  ContainerStatus,
  DiskUsage,
  GatewayStatus,
  StatusOptions,
  StatusSnapshot,
  StatusWatchOptions,
} from "./types.js";
