/**
 * Egress audit collector.
 *
 * Parses two data sources:
 * 1. Egress log (JSON Lines) — records of allowed outbound API calls
 * 2. Firewall drop log (dmesg) — packets blocked by the CLAWHQ_FWD chain
 *
 * Combines both into a unified audit view for `clawhq audit --egress`.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

/** A single allowed egress event from the JSON Lines egress log. */
export interface EgressEntry {
  timestamp: string;
  provider: string;
  model?: string;
  tokenCountIn?: number;
  tokenCountOut?: number;
  dataCategory?: string;
  cost?: number;
  bytesOut: number;
}

/** A single dropped packet parsed from kernel/dmesg logs. */
export interface DropEntry {
  timestamp: string;
  srcIp?: string;
  dstIp?: string;
  dstPort?: number;
  protocol?: string;
}

/** Full egress audit report. */
export interface EgressAuditReport {
  /** Period start (ISO 8601). Null means all time. */
  since: string | null;
  /** Period end (ISO 8601). */
  until: string;
  /** Allowed outbound API calls from egress log. */
  entries: EgressEntry[];
  /** Blocked packets from firewall drop log. */
  drops: DropEntry[];
  /** Summary statistics. */
  summary: EgressAuditSummary;
}

export interface EgressAuditSummary {
  totalCalls: number;
  totalBytesOut: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
  totalDrops: number;
  byProvider: Record<string, ProviderSummary>;
  zeroEgress: boolean;
}

export interface ProviderSummary {
  calls: number;
  bytesOut: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
}

export interface EgressAuditOptions {
  /** Path to the egress log file (JSON Lines). Default: ~/.openclaw/egress.log */
  egressLogPath?: string;
  /** OpenClaw home directory. Default: ~/.openclaw */
  openclawHome?: string;
  /** Only include entries since this date (ISO 8601). Null = all time. */
  since?: string | null;
  /** Only include entries until this date (ISO 8601). Null = now. */
  until?: string | null;
  /** Include firewall drop log from dmesg. Default: true. */
  includeDrops?: boolean;
}

/**
 * Parse the egress log file (JSON Lines format).
 *
 * Each line is a JSON object with at minimum: timestamp, provider, bytesOut.
 * Additional fields (model, tokenCountIn, tokenCountOut, dataCategory, cost)
 * are optional.
 */
export async function parseEgressLog(logPath: string): Promise<EgressEntry[]> {
  let content: string;
  try {
    content = await readFile(logPath, "utf-8");
  } catch {
    return [];
  }

  const entries: EgressEntry[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const raw = JSON.parse(trimmed) as Record<string, unknown>;
      entries.push({
        timestamp: String(raw.timestamp ?? ""),
        provider: String(raw.provider ?? "unknown"),
        model: raw.model != null ? String(raw.model) : undefined,
        tokenCountIn: raw.tokenCountIn != null || raw.token_count_in != null
          ? Number(raw.tokenCountIn ?? raw.token_count_in)
          : undefined,
        tokenCountOut: raw.tokenCountOut != null || raw.token_count_out != null
          ? Number(raw.tokenCountOut ?? raw.token_count_out)
          : undefined,
        dataCategory: raw.dataCategory != null || raw.data_category != null
          ? String(raw.dataCategory ?? raw.data_category)
          : undefined,
        cost: raw.cost != null ? Number(raw.cost) : undefined,
        bytesOut: Number(raw.bytesOut ?? raw.bytes_out ?? 0),
      });
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

/**
 * Parse firewall drop entries from dmesg output.
 *
 * The CLAWHQ_FWD chain logs dropped packets with prefix "CLAWHQ_DROP: ".
 * Kernel log lines look like:
 *   [12345.678] CLAWHQ_DROP: IN=docker0 OUT=eth0 SRC=172.17.0.2 DST=1.2.3.4 ... DPT=443 ...
 */
export function parseDropLog(dmesgOutput: string): DropEntry[] {
  const entries: DropEntry[] = [];
  const dropRegex = /CLAWHQ_DROP:\s+/;

  for (const line of dmesgOutput.split("\n")) {
    if (!dropRegex.test(line)) continue;

    // Extract timestamp from dmesg format: [seconds.microseconds] or ISO timestamp
    let timestamp = "";
    const tsMatch = line.match(/^\[?\s*([\d.]+)\]?\s/);
    if (tsMatch) {
      // Convert kernel seconds to approximate timestamp
      timestamp = `kernel+${tsMatch[1]}s`;
    }
    // Some dmesg versions output ISO timestamps with --time-format iso
    const isoMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.+\-Z]+)\s/);
    if (isoMatch) {
      timestamp = isoMatch[1];
    }

    const srcMatch = line.match(/SRC=([\d.]+)/);
    const dstMatch = line.match(/DST=([\d.]+)/);
    const dptMatch = line.match(/DPT=(\d+)/);
    const protoMatch = line.match(/PROTO=(\w+)/);

    entries.push({
      timestamp,
      srcIp: srcMatch?.[1],
      dstIp: dstMatch?.[1],
      dstPort: dptMatch ? Number(dptMatch[1]) : undefined,
      protocol: protoMatch?.[1],
    });
  }

  return entries;
}

/** Read dmesg output, filtering for CLAWHQ_DROP entries. */
export async function readDmesg(): Promise<string> {
  return new Promise((resolve) => {
    execFile("dmesg", ["--time-format", "iso", "-l", "warn,info"], (err, stdout) => {
      if (err) {
        // Try without --time-format (older dmesg versions)
        execFile("dmesg", [], (err2, stdout2) => {
          resolve(err2 ? "" : stdout2);
        });
        return;
      }
      resolve(stdout);
    });
  });
}

function filterByTimeRange(
  entries: EgressEntry[],
  since: string | null,
  until: string,
): EgressEntry[] {
  const sinceMs = since ? new Date(since).getTime() : 0;
  const untilMs = new Date(until).getTime();

  return entries.filter((e) => {
    const ts = new Date(e.timestamp).getTime();
    return ts >= sinceMs && ts <= untilMs;
  });
}

function buildSummary(entries: EgressEntry[], drops: DropEntry[]): EgressAuditSummary {
  const byProvider: Record<string, ProviderSummary> = {};
  let totalBytesOut = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalCost = 0;

  for (const entry of entries) {
    totalBytesOut += entry.bytesOut;
    totalTokensIn += entry.tokenCountIn ?? 0;
    totalTokensOut += entry.tokenCountOut ?? 0;
    totalCost += entry.cost ?? 0;

    const provider = entry.provider;
    if (!byProvider[provider]) {
      byProvider[provider] = { calls: 0, bytesOut: 0, tokensIn: 0, tokensOut: 0, cost: 0 };
    }
    byProvider[provider].calls++;
    byProvider[provider].bytesOut += entry.bytesOut;
    byProvider[provider].tokensIn += entry.tokenCountIn ?? 0;
    byProvider[provider].tokensOut += entry.tokenCountOut ?? 0;
    byProvider[provider].cost += entry.cost ?? 0;
  }

  return {
    totalCalls: entries.length,
    totalBytesOut,
    totalTokensIn,
    totalTokensOut,
    totalCost,
    totalDrops: drops.length,
    byProvider,
    zeroEgress: entries.length === 0,
  };
}

/**
 * Collect a full egress audit report.
 */
export async function collectEgressAudit(
  options: EgressAuditOptions = {},
): Promise<EgressAuditReport> {
  const home = (options.openclawHome ?? "~/.openclaw").replace(
    /^~/,
    process.env.HOME ?? "~",
  );
  const logPath = options.egressLogPath ?? `${home}/egress.log`;
  const until = options.until ?? new Date().toISOString();
  const since = options.since ?? null;
  const includeDrops = options.includeDrops !== false;

  // Parse egress log
  const allEntries = await parseEgressLog(logPath);
  const entries = filterByTimeRange(allEntries, since, until);

  // Parse firewall drop log
  let drops: DropEntry[] = [];
  if (includeDrops) {
    try {
      const dmesgOutput = await readDmesg();
      drops = parseDropLog(dmesgOutput);
    } catch {
      // dmesg may not be available (non-Linux, permissions)
    }
  }

  const summary = buildSummary(entries, drops);

  return { since, until, entries, drops, summary };
}
