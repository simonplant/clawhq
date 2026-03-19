/**
 * Backing service management — postgres, redis, qdrant.
 *
 * `clawhq service add <name>` configures a backing service container
 * alongside the OpenClaw agent. Services are connected via the
 * clawhq_net Docker network with healthchecks and secure defaults.
 */

export { addService } from "./add.js";
export { getServiceConfig, SUPPORTED_SERVICES } from "./definitions.js";
export { listServices } from "./list.js";

export type {
  ServiceAddOptions,
  ServiceAddResult,
  ServiceConfig,
  ServiceEntry,
  ServiceListOptions,
  ServiceListResult,
  ServiceName,
} from "./types.js";
