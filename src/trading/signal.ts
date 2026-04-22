/**
 * Signal integration.
 *
 * Two concerns, kept separate:
 *   1. Pure protocol (alert ID generation, message formatting, reply parsing,
 *      heartbeat + self-ping composition). Deterministic, fully testable.
 *   2. Transport (send/recv via signal-cli). Wraps a thin SignalChannel
 *      abstraction so tests can substitute an in-memory channel.
 *
 * The default channel shells out to the `signal-cli` binary. If unavailable,
 * set SIGNAL_CLI_BINARY or stub a different SignalChannel for local dev.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

import type { SignalConfig } from "./config.js";
import type { Alert, UserReplyType } from "./types.js";

// ── Pure protocol ────────────────────────────────────────────────────────────

/** 4-char alphanumeric upper-case suffix used to thread alerts and replies. */
export function generateAlertId(): string {
  // 36 symbols per char = 1.6M combinations; plenty for concurrent-alert uniqueness.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = randomBytes(4);
  let id = "";
  for (let i = 0; i < 4; i++) {
    id += alphabet[(bytes[i] ?? 0) % alphabet.length];
  }
  return id;
}

/**
 * Format an alert as a Signal message body. Stable layout so Simon learns
 * to skim it. First line is the headline; reply enum is always present.
 */
export function formatAlertMessage(alert: Alert): string {
  const head = alert.catchup ? "🔁 CATCHUP" : headIcon(alert);
  const dir = alert.direction;
  const accounts = alert.accounts.map((a) => a.toUpperCase()).join("/");
  const expires = formatClockTime(alert.expiresAtMs);
  const govLine = formatGovernorLine(alert);
  const context = alert.catchup
    ? `Level: ${alert.levelName} (${dir}) — crossed while system was down`
    : `Level: ${alert.levelName} (${dir}) @ ${fmtPrice(alert.levelPrice)}`;
  const levels =
    `Entry ${fmtPrice(alert.entry)}  Stop ${fmtPrice(alert.stop)}  ` +
    `T1 ${fmtPrice(alert.t1)}  T2 ${fmtPrice(alert.t2)}`;
  const risk = `Risk $${alert.totalRisk.toFixed(0)}`;

  const lines = [
    `${head} ${alert.source.toUpperCase()} ${alert.ticker} — ${alert.conviction} [${accounts}]`,
    context,
    levels,
    risk,
    govLine,
    `Reply: YES-${alert.id} | HALF-${alert.id} | NO-${alert.id}`,
    `(expires ${expires})`,
  ];
  return lines.join("\n");
}

/** Format the heartbeat line. */
export function formatHeartbeat(input: {
  nowMs: number;
  nextAtMs: number;
  symbolCount: number;
  alertsToday: number;
  tradierPnl: number;
}): string {
  return (
    `💓 ${formatClockTime(input.nowMs)} · ${input.symbolCount} symbols · ` +
    `${input.alertsToday} alerts today · Tradier P&L ${fmtUsd(input.tradierPnl)} · ` +
    `next heartbeat ${formatClockTime(input.nextAtMs)}`
  );
}

/** Reply parser — lenient on format, strict on intent. */
export interface ParsedReply {
  /** Recognized reply type, or null if ambiguous / unrecognized. */
  type: UserReplyType | null;
  /** The suffix the user referenced. */
  alertId: string | null;
}

const REPLY_RE =
  /\b(YES|APPROVE|HALF|THIRD|NO|REJECT|STOP|DEFER|5MIN|DEFER-?TO-?OPEN|OPEN)\s*[-_ ]?\s*([A-Z0-9]{4})\b/i;

/**
 * Accepts `YES-A7F3`, `yes a7f3`, `approve A7F3`, etc. Rejects ambiguous
 * text like plain `yes` without an ID, or multiple IDs in one message.
 */
export function parseReply(raw: string): ParsedReply {
  const upper = raw.trim().toUpperCase();
  const matches = [...upper.matchAll(new RegExp(REPLY_RE, "gi"))];
  if (matches.length !== 1) return { type: null, alertId: null };
  const m = matches[0];
  if (!m) return { type: null, alertId: null };
  const word = (m[1] ?? "").toUpperCase();
  const id = (m[2] ?? "").toUpperCase();
  const type = mapReplyWord(word);
  return { type, alertId: id };
}

function mapReplyWord(word: string): UserReplyType | null {
  switch (word) {
    case "YES":
    case "APPROVE":
      return "approve";
    case "HALF":
      return "reduce-half";
    case "THIRD":
      return "reduce-third";
    case "NO":
    case "REJECT":
    case "STOP":
      return "reject";
    case "5MIN":
    case "DEFER":
      return "defer-5m";
    case "DEFER-TO-OPEN":
    case "DEFERTOOPEN":
    case "DEFEROPEN":
    case "OPEN":
      return "defer-to-open";
    default:
      return null;
  }
}

function headIcon(alert: Alert): string {
  if (alert.levelName === "stop") return "🛑";
  if (alert.levelName === "t1" || alert.levelName === "t2") return "🎯";
  return "📈";
}

function formatGovernorLine(alert: Alert): string {
  if (alert.risk.block) {
    return `Governor: BLOCKED — ${alert.risk.block}`;
  }
  if (alert.risk.warn) {
    return `Governor: warn — ${alert.risk.warn} (${alert.risk.scope})`;
  }
  return `Governor: OK (${alert.risk.scope})`;
}

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toFixed(2);
  return n.toFixed(2);
}

function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "+";
  return `${sign}$${abs.toFixed(0)}`;
}

/** HH:MMam / HH:MMpm (local TZ) — intentionally terse. */
export function formatClockTime(ms: number, now: Date = new Date(ms)): string {
  const h24 = now.getHours();
  const m = now.getMinutes();
  const ampm = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

// ── Transport (signal-cli) ───────────────────────────────────────────────────

/** Abstract channel — tests substitute in-memory implementation. */
export interface SignalChannel {
  send(body: string): Promise<void>;
  /**
   * Returns incoming messages since the last poll. Non-blocking. May be
   * empty. Each message is a raw text body (sender + timestamp metadata
   * are discarded — this is a single-user note-to-self pattern).
   */
  receive(): Promise<string[]>;
}

/** In-memory channel for tests. */
export function makeInMemoryChannel(): SignalChannel & {
  outbox: string[];
  inbox: string[];
} {
  const outbox: string[] = [];
  const inbox: string[] = [];
  return {
    outbox,
    inbox,
    async send(body): Promise<void> {
      outbox.push(body);
    },
    async receive(): Promise<string[]> {
      const drained = inbox.splice(0, inbox.length);
      return drained;
    },
  };
}

/**
 * Shell out to signal-cli for real transport. The channel caches the last
 * timestamp so repeated receive() calls don't duplicate messages.
 */
export function makeSignalCliChannel(config: SignalConfig): SignalChannel {
  if (!config.selfNumber || !config.recipientNumber) {
    throw new Error(
      "signal-cli channel requires SIGNAL_SELF_NUMBER and (by default) SIGNAL_RECIPIENT_NUMBER",
    );
  }
  return {
    async send(body): Promise<void> {
      await runSignalCli(config.binary, [
        "-u",
        config.selfNumber,
        "send",
        "-m",
        body,
        config.recipientNumber,
      ]);
    },

    async receive(): Promise<string[]> {
      // `signal-cli receive --json` emits one JSON per line.
      const stdout = await runSignalCli(config.binary, [
        "-u",
        config.selfNumber,
        "receive",
        "--json",
      ]);
      const messages: string[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as SignalCliEnvelope;
          const body = parsed.envelope?.dataMessage?.message;
          if (body) messages.push(body);
        } catch {
          // Ignore non-JSON lines.
        }
      }
      return messages;
    },
  };
}

interface SignalCliEnvelope {
  envelope?: {
    dataMessage?: {
      message?: string;
    };
  };
}

function runSignalCli(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf-8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf-8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`signal-cli ${args[0] ?? ""} exited ${code}: ${stderr.trim()}`));
      }
    });
  });
}
