/**
 * Status collector orchestrator.
 *
 * Runs all five section collectors in parallel and assembles a StatusReport.
 */

import { collectChannelHealth } from "../connect/format.js";
import { getSourceStatus, resolveSourceConfig } from "../source/index.js";

import { collectAgentStatus } from "./agent.js";
import { collectEgressSummary } from "./egress.js";
import { collectIntegrationHealth } from "./integrations.js";
import type { ChannelHealthEntry, OpenClawSourceStatus, StatusOptions, StatusReport } from "./types.js";
import { collectWorkspaceMetrics } from "./workspace.js";

/**
 * Collect a full status report by running all section collectors.
 */
export async function collectStatus(options: StatusOptions = {}): Promise<StatusReport> {
  const openclawHome = options.openclawHome ?? "~/.openclaw";
  const resolvedHome = openclawHome.replace(/^~/, process.env.HOME ?? "~");

  const [agent, integrations, channelHealthRaw, workspace, egress, openclawSourceRaw] = await Promise.all([
    collectAgentStatus({
      composePath: options.composePath,
      gatewayHost: options.gatewayHost,
      gatewayPort: options.gatewayPort,
    }),
    collectIntegrationHealth({
      envPath: options.envPath,
    }),
    collectChannelHealth({
      openclawHome: resolvedHome,
      envPath: (options.envPath ?? `${resolvedHome}/.env`).replace(/^~/, process.env.HOME ?? "~"),
      configPath: `${resolvedHome}/openclaw.json`,
    }).catch((): ChannelHealthEntry[] => []),
    collectWorkspaceMetrics({
      openclawHome: options.openclawHome,
    }),
    collectEgressSummary({
      openclawHome: options.openclawHome,
      egressLogPath: options.egressLogPath,
    }),
    collectOpenClawSource(),
  ]);

  // Map connect module types to status types
  const channels: ChannelHealthEntry[] = channelHealthRaw.map((ch) => ({
    channel: ch.channel,
    status: ch.status,
    message: ch.message,
    displayName: ch.displayName,
  }));

  return {
    timestamp: new Date().toISOString(),
    agent,
    openclawSource: openclawSourceRaw,
    integrations,
    channels,
    workspace,
    egress,
  };
}

/**
 * Collect OpenClaw source acquisition status.
 */
async function collectOpenClawSource(): Promise<OpenClawSourceStatus> {
  const sourceConfig = resolveSourceConfig();

  if (!sourceConfig.version) {
    return {
      pinnedVersion: null,
      cached: false,
      integrityOk: false,
      sourcePath: null,
    };
  }

  try {
    const status = await getSourceStatus(sourceConfig);
    return {
      pinnedVersion: status.pinnedVersion,
      cached: status.cached,
      integrityOk: status.integrityOk,
      sourcePath: status.sourcePath,
    };
  } catch {
    return {
      pinnedVersion: sourceConfig.version,
      cached: false,
      integrityOk: false,
      sourcePath: null,
    };
  }
}
