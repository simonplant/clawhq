/**
 * Signal command router.
 *
 * Simon texts the running system with verbs like `status`, `plan`,
 * `positions`, `halt`, `resume`. This module parses those into a tagged
 * command and formats the reply. Commands + replies share the same
 * Signal bridge — the caller tries parseReply() first (reply to an alert),
 * then parseCommand() (interactive query).
 *
 * The router is intentionally minimal — no "add-order" / "kill" in Phase A.
 * Intraday plan edits are made by editing today.md (fs watch reloads).
 */

import type { OrderBlock, UserReplyType } from "./types.js";

// ── Parser (pure) ────────────────────────────────────────────────────────────

export type CommandName =
  | "status"
  | "plan"
  | "positions"
  | "halt"
  | "resume"
  | "help";

export interface ParsedCommand {
  command: CommandName;
  /** Any trailing text (e.g. reason for halt). */
  args: string;
}

const COMMAND_VERBS: Record<string, CommandName> = {
  status: "status",
  state: "status",
  plan: "plan",
  orders: "plan",
  positions: "positions",
  pos: "positions",
  halt: "halt",
  pause: "halt",
  stop: "halt",
  resume: "resume",
  start: "resume",
  go: "resume",
  help: "help",
  "?": "help",
};

export interface ParsedReply {
  reply: UserReplyType;
  alertId: string;
}

const REPLY_VERBS: Record<string, UserReplyType> = {
  yes: "approve",
  y: "approve",
  ok: "approve",
  approve: "approve",
  half: "reduce-half",
  "50": "reduce-half",
  third: "reduce-third",
  "33": "reduce-third",
  no: "reject",
  n: "reject",
  reject: "reject",
  skip: "reject",
  later: "defer-5m",
  "5m": "defer-5m",
  open: "defer-to-open",
  atopen: "defer-to-open",
};

/**
 * Parse a reply like "YES-T3ST" or "half a7f3" or "no T3ST". The verb and
 * id may be separated by `-`, `_`, ` `, or `:`. Alert ids are 4-char
 * alphanumeric (uppercase) per telegram.ts:generateAlertId.
 *
 * Returns null for anything not matching; the caller falls through to
 * parseCommand for interactive queries.
 */
export function parseReply(raw: string): ParsedReply | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = /^([A-Za-z0-9]+)[-_: ]([A-Za-z0-9]{4})\s*$/.exec(trimmed);
  if (!m) return null;
  const [, verbRaw, idRaw] = m;
  if (!verbRaw || !idRaw) return null;
  const verb = verbRaw.toLowerCase();
  const id = idRaw.toUpperCase();
  const reply = REPLY_VERBS[verb];
  if (!reply) return null;
  return { reply, alertId: id };
}

export function parseCommand(raw: string): ParsedCommand | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Reject anything that looks like a reply (XXXX-YYYY pattern). Caller
  // should have tried parseReply first; this is belt-and-suspenders.
  if (/\b[A-Z]+[-_ ][A-Z0-9]{4}\b/i.test(trimmed)) return null;

  const [head, ...rest] = trimmed.split(/\s+/);
  const verb = (head ?? "").toLowerCase();
  const command = COMMAND_VERBS[verb];
  if (!command) return null;
  return { command, args: rest.join(" ") };
}

// ── Dispatcher context ───────────────────────────────────────────────────────

export interface CommandContext {
  now(): Date;
  snapshot(): SystemSnapshot;
  /** Emit the MANUAL halt edge (entered). Caller handles the side effect. */
  emitManualHalt(reason: string): void;
  /** Clear the MANUAL halt edge. */
  clearManualHalt(): void;
}

export interface SystemSnapshot {
  planLoaded: boolean;
  planPath: string;
  orders: OrderBlock[];
  lastPollMs: number | null;
  lastAlertMs: number | null;
  alertsToday: number;
  tradierPnl: number;
  tradierPositions: Array<{ symbol: string; qty: number; avgPrice: number }>;
  manualHalt: boolean;
  nextHeartbeatMs: number | null;
  symbolCount: number;
}

// ── Command handlers ─────────────────────────────────────────────────────────

export function dispatchCommand(
  parsed: ParsedCommand,
  ctx: CommandContext,
): string {
  switch (parsed.command) {
    case "status":
      return renderStatus(ctx.snapshot(), ctx.now());
    case "plan":
      return renderPlan(ctx.snapshot());
    case "positions":
      return renderPositions(ctx.snapshot());
    case "halt":
      ctx.emitManualHalt(parsed.args || "via signal command");
      return "⏸️ Halt entered — new alerts suppressed until `resume`.";
    case "resume":
      ctx.clearManualHalt();
      return "▶️ Halt cleared — alerts resumed.";
    case "help":
      return renderHelp();
  }
}

export function renderStatus(s: SystemSnapshot, now: Date): string {
  const lines: string[] = [];
  lines.push("📊 status");
  lines.push(
    `plan: ${s.planLoaded ? `${s.orders.length} orders loaded` : "NOT LOADED"}`,
  );
  if (s.lastPollMs === null) {
    lines.push("poll: never");
  } else {
    const ageSec = Math.floor((now.getTime() - s.lastPollMs) / 1000);
    lines.push(`poll: ${ageSec}s ago · ${s.symbolCount} symbols`);
  }
  lines.push(
    `alerts today: ${s.alertsToday}${
      s.lastAlertMs ? ` · last ${formatAge(now.getTime(), s.lastAlertMs)}` : ""
    }`,
  );
  lines.push(`Tradier P&L: ${fmtUsd(s.tradierPnl)}`);
  if (s.manualHalt) lines.push("⏸️ MANUAL HALT active — send `resume` to clear");
  if (s.nextHeartbeatMs) {
    const inSec = Math.max(0, Math.floor((s.nextHeartbeatMs - now.getTime()) / 1000));
    lines.push(`next heartbeat in ${Math.floor(inSec / 60)}m ${inSec % 60}s`);
  }
  return lines.join("\n");
}

export function renderPlan(s: SystemSnapshot): string {
  if (!s.planLoaded) {
    return "📋 plan: NOT LOADED\nedit `memory/trading-YYYY-MM-DD.md` to publish today's plan.";
  }
  if (s.orders.length === 0) {
    return `📋 plan: no ORDER blocks in ${s.planPath}`;
  }
  const lines: string[] = [`📋 ${s.orders.length} orders`];
  for (const o of s.orders) {
    lines.push(
      `#${o.sequence} ${o.source} ${o.ticker} ${o.direction} ` +
        `@ ${o.entry} · stop ${o.stop} · ${o.conviction}/${o.confirmation} · ${o.status}`,
    );
  }
  return lines.join("\n");
}

export function renderPositions(s: SystemSnapshot): string {
  const lines: string[] = [];
  if (s.tradierPositions.length === 0) {
    lines.push("💼 Tradier: no positions");
  } else {
    lines.push("💼 Tradier positions:");
    for (const p of s.tradierPositions) {
      lines.push(
        `  ${p.symbol}  ${p.qty} @ ${p.avgPrice.toFixed(2)}`,
      );
    }
  }
  lines.push(`Tradier P&L: ${fmtUsd(s.tradierPnl)}`);
  lines.push("(TOS + IRA positions not visible via API — see today.md)");
  return lines.join("\n");
}

export function renderHelp(): string {
  return [
    "commands:",
    "  status    — system state",
    "  plan      — today's ORDER blocks",
    "  positions — Tradier positions (TOS/IRA not visible)",
    "  halt      — suppress new alerts",
    "  resume    — resume alerts",
    "reply to alerts with YES-<id> / HALF-<id> / NO-<id>",
  ].join("\n");
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "+";
  return `${sign}$${abs.toFixed(0)}`;
}

function formatAge(nowMs: number, thenMs: number): string {
  const sec = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}
