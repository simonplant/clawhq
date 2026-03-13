/**
 * Status collector orchestrator.
 *
 * Runs all four section collectors in parallel and assembles a StatusReport.
 */

import { collectAgentStatus } from "./agent.js";
import { collectEgressSummary } from "./egress.js";
import { collectIntegrationHealth } from "./integrations.js";
import type { StatusOptions, StatusReport } from "./types.js";
import { collectWorkspaceMetrics } from "./workspace.js";

/**
 * Collect a full status report by running all section collectors.
 */
export async function collectStatus(options: StatusOptions = {}): Promise<StatusReport> {
  const [agent, integrations, workspace, egress] = await Promise.all([
    collectAgentStatus({
      composePath: options.composePath,
      gatewayHost: options.gatewayHost,
      gatewayPort: options.gatewayPort,
    }),
    collectIntegrationHealth({
      envPath: options.envPath,
    }),
    collectWorkspaceMetrics({
      openclawHome: options.openclawHome,
    }),
    collectEgressSummary({
      openclawHome: options.openclawHome,
      egressLogPath: options.egressLogPath,
    }),
  ]);

  return {
    timestamp: new Date().toISOString(),
    agent,
    integrations,
    workspace,
    egress,
  };
}
