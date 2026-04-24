/**
 * Daily activity report from the SQLite events log.
 *
 * The trade-journal tool already writes records at trade-lifecycle events
 * (signal, order, fill). This report answers a different question: "what
 * did the sidecar actually do today?" — alerts fired, governor decisions,
 * catch-up events, poll-failure streaks, halt edges.
 *
 * Output is markdown suitable for the EOD review skill to paste into
 * today.md. Pure function of an EventRow[] — file I/O happens at the
 * caller so tests can feed synthetic rows.
 */

import type { Conviction, EventRow, Source, TradingEvent } from "./types.js";

export interface DailyReport {
  /** Window the report covers. */
  rangeMs: { startMs: number; endMs: number };
  alerts: AlertRollup[];
  blocks: BlockRollup[];
  /** Total count grouped by TradingEvent type (sanity meter). */
  eventCounts: Record<string, number>;
  pollFailures: number;
  haltEdges: Array<{ tsMs: number; direction: "entered" | "cleared"; reason: string }>;
  catchups: number;
  planReloads: number;
}

export interface AlertRollup {
  source: Source;
  conviction: Conviction;
  count: number;
  /** tsMs of the latest alert in this bucket. */
  latestTsMs: number;
}

export interface BlockRollup {
  reason: string;
  count: number;
  /** Affected order ticker (first seen). */
  sampleTicker: string;
}

/** Build a report over the supplied rows. Rows may be in any order. */
export function buildDailyReport(
  rows: EventRow[],
  rangeMs: { startMs: number; endMs: number },
): DailyReport {
  const eventCounts: Record<string, number> = {};
  const alerts: AlertRollup[] = [];
  const alertKey = new Map<string, AlertRollup>();
  const blocks: BlockRollup[] = [];
  const blockKey = new Map<string, BlockRollup>();
  const haltEdges: DailyReport["haltEdges"] = [];
  let pollFailures = 0;
  let catchups = 0;
  let planReloads = 0;

  for (const row of rows) {
    if (row.tsMs < rangeMs.startMs || row.tsMs > rangeMs.endMs) continue;
    eventCounts[row.type] = (eventCounts[row.type] ?? 0) + 1;

    const p = row.payload;
    switch (p.type) {
      case "AlertSent": {
        const a = p.alert;
        const k = `${a.source}|${a.conviction}`;
        const existing = alertKey.get(k);
        if (existing) {
          existing.count++;
          if (row.tsMs > existing.latestTsMs) existing.latestTsMs = row.tsMs;
        } else {
          const entry: AlertRollup = {
            source: a.source,
            conviction: a.conviction,
            count: 1,
            latestTsMs: row.tsMs,
          };
          alerts.push(entry);
          alertKey.set(k, entry);
        }
        if (a.catchup) catchups++;
        break;
      }
      case "RiskDecision": {
        if (!p.decision.block) break;
        const reason = p.decision.block;
        const existing = blockKey.get(reason);
        if (existing) {
          existing.count++;
        } else {
          const entry: BlockRollup = {
            reason,
            count: 1,
            sampleTicker: orderIdToTicker(p.orderId),
          };
          blocks.push(entry);
          blockKey.set(reason, entry);
        }
        break;
      }
      case "PollFailed": {
        pollFailures++;
        break;
      }
      case "HaltEdge": {
        haltEdges.push({
          tsMs: row.tsMs,
          direction: p.direction,
          reason: p.reason ?? p.haltType,
        });
        break;
      }
      case "PlanLoaded": {
        planReloads++;
        break;
      }
      default:
        break;
    }
  }

  return {
    rangeMs,
    alerts: alerts.sort(
      (a, b) => b.count - a.count || a.source.localeCompare(b.source),
    ),
    blocks: blocks.sort((a, b) => b.count - a.count),
    eventCounts,
    pollFailures,
    haltEdges: haltEdges.sort((a, b) => a.tsMs - b.tsMs),
    catchups,
    planReloads,
  };
}

/**
 * Orders carry IDs like `mancini-ES-a1b2c3d4`. Surface the ticker for
 * the block rollup so Simon can tell which setup got blocked without
 * having to cross-reference IDs.
 */
function orderIdToTicker(orderId: string): string {
  const parts = orderId.split("-");
  return parts.length >= 2 ? parts[1]! : orderId;
}

// ── Rendering ───────────────────────────────────────────────────────────────

export function renderDailyReport(report: DailyReport): string {
  const lines: string[] = [];
  lines.push("## Sidecar Activity — Daily Report");
  lines.push("");

  if (report.alerts.length === 0) {
    lines.push("_No alerts fired in window._");
  } else {
    lines.push("### Alerts fired");
    lines.push("");
    lines.push("| source | conviction | count | latest |");
    lines.push("| ------ | ---------- | ----: | ------ |");
    for (const a of report.alerts) {
      lines.push(
        `| ${a.source} | ${a.conviction} | ${a.count} | ${formatTime(a.latestTsMs)} |`,
      );
    }
    lines.push("");
  }

  if (report.blocks.length > 0) {
    lines.push("### Governor blocks");
    lines.push("");
    lines.push("| reason | count | sample ticker |");
    lines.push("| ------ | ----: | ------------- |");
    for (const b of report.blocks) {
      lines.push(`| ${b.reason} | ${b.count} | ${b.sampleTicker} |`);
    }
    lines.push("");
  }

  const status: string[] = [];
  if (report.catchups > 0) status.push(`${report.catchups} catch-up`);
  if (report.planReloads > 0) status.push(`${report.planReloads} plan reloads`);
  if (report.pollFailures > 0) status.push(`${report.pollFailures} poll failures`);
  for (const h of report.haltEdges) {
    status.push(`halt ${h.direction}: ${h.reason} @ ${formatTime(h.tsMs)}`);
  }
  if (status.length > 0) {
    lines.push("### Status edges");
    lines.push("");
    for (const s of status) lines.push(`- ${s}`);
    lines.push("");
  }

  return lines.join("\n");
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const h24 = d.getHours();
  const m = d.getMinutes();
  const ampm = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

// Ensure the TradingEvent import is tree-shake-safe — we branch on payload.type
// inside the reducer but TS otherwise sees this as unused.
export type _TradingEventUsage = TradingEvent;
