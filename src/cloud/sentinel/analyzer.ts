/**
 * Config breakage analyzer — predicts whether upstream changes break a deployment.
 *
 * Given an upstream analysis (commits + config impacts) and a user's config
 * fingerprint, this module predicts which changes would break the user's
 * specific deployment. This is the key value proposition: a cron job can
 * tell you "there's a new release", but only Sentinel can tell you
 * "this release will break YOUR specific config because you use X".
 */

import type {
  BreakagePrediction,
  BreakageReport,
  ConfigFingerprint,
  ConfigImpact,
  SentinelAlert,
  UpstreamAnalysis,
} from "./types.js";

// ── Impact Area to Config Key Mapping ──────────────────────────────────────

/**
 * Maps config impact areas to the fingerprint fields they affect.
 *
 * When an upstream change touches a given area, we check whether the
 * user's config fingerprint indicates they use that area.
 */
const AREA_TO_FINGERPRINT: Record<string, (fp: ConfigFingerprint) => {
  readonly affected: boolean;
  readonly key: string;
}> = {
  "config-schema": (fp) => ({
    affected: fp.configKeysSet.length > 0,
    key: "configKeysSet",
  }),
  "runtime-config": (fp) => ({
    affected: fp.configKeysSet.length > 0,
    key: "configKeysSet",
  }),
  "config": (fp) => ({
    affected: fp.configKeysSet.length > 0,
    key: "configKeysSet",
  }),
  "gateway": (fp) => ({
    affected: fp.hasGatewayConfig,
    key: "hasGatewayConfig",
  }),
  "container": () => ({
    affected: true, // All deployments use containers
    key: "container",
  }),
  "environment": () => ({
    affected: true,
    key: "environment",
  }),
  "authentication": () => ({
    affected: true, // All deployments use auth
    key: "authentication",
  }),
  "security": () => ({
    affected: true,
    key: "security",
  }),
  "permissions": () => ({
    affected: true,
    key: "permissions",
  }),
  "tools": (fp) => ({
    affected: fp.toolsEnabled.length > 0,
    key: "toolsEnabled",
  }),
  "skills": () => ({
    affected: true, // Assume all deployments may have skills
    key: "skills",
  }),
  "cron": (fp) => ({
    affected: fp.cronJobCount > 0,
    key: "cronJobCount",
  }),
  "channels": (fp) => ({
    affected: fp.channelsConfigured.length > 0,
    key: "channelsConfigured",
  }),
  "memory": () => ({
    affected: true,
    key: "memory",
  }),
  "workspace": () => ({
    affected: true,
    key: "workspace",
  }),
  "dependencies": () => ({
    affected: true,
    key: "dependencies",
  }),
};

// ── Recommended Actions ───────────────────────────────────────────────────

function recommendAction(impact: ConfigImpact): string {
  switch (impact.changeType) {
    case "removed":
      return `Remove the deprecated '${impact.configPath}' setting from your config before updating.`;
    case "renamed":
      return `Rename the '${impact.configPath}' setting to match the new name before updating.`;
    case "default-changed":
      return `Review the new default for '${impact.configPath}'. If you rely on the old default, set the value explicitly.`;
    case "type-changed":
      return `Check that your '${impact.configPath}' value matches the new expected type.`;
    case "deprecated":
      return `Plan to migrate away from '${impact.configPath}' — it will be removed in a future release.`;
    case "added":
      return `Review the new '${impact.configPath}' setting. Consider whether you need to configure it.`;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Predict config breakage for a specific user's deployment.
 *
 * Takes an upstream analysis and the user's config fingerprint, and
 * returns predictions about what would break if they update.
 */
export function predictBreakage(
  analysis: UpstreamAnalysis,
  fingerprint: ConfigFingerprint,
): BreakageReport {
  const predictions: BreakagePrediction[] = [];

  // If config failed to load, we can't predict breakage — flag as risk
  if (fingerprint.configLoadFailed) {
    return {
      agentId: fingerprint.agentId,
      commitsAnalyzed: analysis.commits.length,
      predictions: [],
      shouldHoldUpdate: true,
      generatedAt: new Date().toISOString(),
    };
  }

  for (const impact of analysis.impacts) {
    const checker = AREA_TO_FINGERPRINT[impact.configPath];
    if (!checker) continue;

    const { affected, key } = checker(fingerprint);
    if (!affected) continue;

    predictions.push({
      impact,
      affectedConfigKey: key,
      breakageDescription: buildBreakageDescription(impact, fingerprint),
      recommendedAction: recommendAction(impact),
    });
  }

  // Sort by severity: breaking > high > medium > low > none
  const severityOrder: Record<string, number> = {
    breaking: 0, high: 1, medium: 2, low: 3, none: 4,
  };
  predictions.sort(
    (a, b) => (severityOrder[a.impact.level] ?? 4) - (severityOrder[b.impact.level] ?? 4),
  );

  return {
    agentId: fingerprint.agentId,
    commitsAnalyzed: analysis.commits.length,
    predictions,
    shouldHoldUpdate: predictions.some(
      (p) => p.impact.level === "breaking" || p.impact.level === "high",
    ),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Convert a breakage report into Sentinel alerts ready for delivery.
 */
export function breakageToAlerts(report: BreakageReport): readonly SentinelAlert[] {
  if (report.predictions.length === 0) return [];

  const alerts: SentinelAlert[] = [];
  let alertIndex = 0;

  for (const prediction of report.predictions) {
    const severity = prediction.impact.level === "breaking"
      ? "critical" as const
      : prediction.impact.level === "high"
        ? "warning" as const
        : "info" as const;

    alerts.push({
      id: `sentinel-${report.agentId}-${Date.now()}-${alertIndex++}`,
      category: "config-breakage",
      severity,
      title: `Config breakage: ${prediction.impact.configPath} (${prediction.impact.changeType})`,
      upstreamChange: prediction.impact.description,
      configImpact: prediction.breakageDescription,
      recommendedAction: prediction.recommendedAction,
      commitShas: [prediction.impact.commitSha],
      createdAt: new Date().toISOString(),
    });
  }

  return alerts;
}

// ── Internal Helpers ───────────────────────────────────────────────────────

function buildBreakageDescription(
  impact: ConfigImpact,
  fingerprint: ConfigFingerprint,
): string {
  const area = impact.configPath;

  switch (area) {
    case "gateway":
      return "Your deployment uses custom gateway configuration that may be affected by this change.";
    case "tools":
      return `Your deployment uses tools (${fingerprint.toolsEnabled.join(", ")}) that may be affected.`;
    case "channels":
      return `Your deployment uses channels (${fingerprint.channelsConfigured.join(", ")}) that may be affected.`;
    case "cron":
      return `Your deployment has ${fingerprint.cronJobCount} cron job(s) that may be affected.`;
    case "config-schema":
    case "runtime-config":
    case "config":
      return `Your config uses keys (${fingerprint.configKeysSet.slice(0, 5).join(", ")}) that may need updating.`;
    default:
      return `Your deployment's ${area} configuration may be affected by this upstream change.`;
  }
}
