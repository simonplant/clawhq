/**
 * Telegram messaging — outbound only.
 *
 * Why outbound-only: OpenClaw (running as a sibling container) is already
 * long-polling the same bot via grammY. Two pollers on one bot token fight
 * over getUpdates — one wins, the other sees empty. So the trading sidecar
 * never calls `getUpdates` or sets a webhook; it uses `sendMessage` directly
 * against the shared `TELEGRAM_BOT_TOKEN`, which always succeeds regardless
 * of who owns polling.
 *
 * Inbound (Simon's replies, halt commands) flows through OpenClaw. Clawdius
 * can reach the sidecar's /halt, /resume, /status HTTP endpoints over the
 * bridge network when Simon asks it to.
 *
 * Alert formatting, reply-id generation, and heartbeat composition are the
 * same pure functions across channels — kept channel-agnostic on purpose so
 * a future Signal / Discord backend is a 50-line addition.
 */

import { randomBytes } from "node:crypto";

import type { TelegramConfig } from "./config.js";
import type { Alert } from "./types.js";

// ── Pure protocol (channel-agnostic) ────────────────────────────────────────

/** 4-char uppercase alphanumeric suffix used to thread alerts and replies. */
export function generateAlertId(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = randomBytes(4);
  let id = "";
  for (let i = 0; i < 4; i++) {
    id += alphabet[(bytes[i] ?? 0) % alphabet.length];
  }
  return id;
}

/**
 * Format an alert as a plain-text body. Telegram accepts plain text without
 * parse_mode — keeps formatting predictable and immune to markdown/html
 * entity escaping bugs (which are Simon-interrupting bugs).
 */
export function formatAlertMessage(alert: Alert): string {
  const head = alert.catchup ? "🔁 CATCHUP" : headIcon(alert);
  const accounts = alert.accounts.map((a) => a.toUpperCase()).join("/");
  const expires = formatClockTime(alert.expiresAtMs);
  const govLine = formatGovernorLine(alert);
  const context = alert.catchup
    ? `Level: ${alert.levelName} (${alert.direction}) — crossed while system was down`
    : `Level: ${alert.levelName} (${alert.direction}) @ ${fmt(alert.levelPrice)}`;
  const levels =
    `Entry ${fmt(alert.entry)}  Stop ${fmt(alert.stop)}  ` +
    `T1 ${fmt(alert.t1)}  T2 ${fmt(alert.t2)}`;
  const risk = `Risk $${alert.totalRisk.toFixed(0)}`;
  const confluenceLine = formatConfluenceLine(alert);

  const lines = [
    `${head} ${alert.source.toUpperCase()} ${alert.ticker} — ${alert.conviction} [${accounts}]`,
    context,
    levels,
    risk,
  ];
  if (confluenceLine) lines.push(confluenceLine);
  lines.push(govLine);
  lines.push(`Reply: YES-${alert.id} | HALF-${alert.id} | NO-${alert.id}`);
  lines.push(`(expires ${expires})`);
  return lines.join("\n");
}

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

// ── Channel transport (outbound only) ───────────────────────────────────────

export interface SendOptions {
  /** Render as a silent notification if supported by the channel. */
  quiet?: boolean;
}

export interface MessageChannel {
  send(body: string, opts?: SendOptions): Promise<void>;
}

/**
 * In-memory channel for tests. Exposes `outbox` (messages as plain strings,
 * for backward-compatible assertions) and `sent` (full {body, opts} records
 * for quiet-vs-loud assertions).
 */
export function makeInMemoryChannel(): MessageChannel & {
  outbox: string[];
  sent: Array<{ body: string; opts: SendOptions }>;
} {
  const outbox: string[] = [];
  const sent: Array<{ body: string; opts: SendOptions }> = [];
  return {
    outbox,
    sent,
    async send(body, opts = {}): Promise<void> {
      outbox.push(body);
      sent.push({ body, opts });
    },
  };
}

/**
 * Telegram Bot API channel. Uses `sendMessage` via fetch — no polling, no
 * webhook. OpenClaw retains ownership of inbound message routing.
 */
export function makeTelegramChannel(config: TelegramConfig): MessageChannel {
  if (!config.botToken || !config.chatId) {
    throw new Error(
      "Telegram channel requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID",
    );
  }
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const timeoutMs = config.timeoutMs ?? 5000;

  return {
    async send(body, opts = {}): Promise<void> {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: config.chatId,
            text: body,
            disable_web_page_preview: true,
            ...(opts.quiet ? { disable_notification: true } : {}),
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(`Telegram sendMessage ${res.status}: ${detail.slice(0, 200)}`);
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function headIcon(alert: Alert): string {
  if (alert.levelName === "stop") return "🛑";
  if (alert.levelName === "t1" || alert.levelName === "t2") return "🎯";
  return "📈";
}

function formatGovernorLine(alert: Alert): string {
  if (alert.risk.block) return `Governor: BLOCKED — ${alert.risk.block}`;
  if (alert.risk.warn) return `Governor: warn — ${alert.risk.warn} (${alert.risk.scope})`;
  return `Governor: OK (${alert.risk.scope})`;
}

function formatConfluenceLine(alert: Alert): string | null {
  const c = alert.confluence;
  if (!c || c.tier === "none") return null;
  const badge =
    c.tier === "divergent"
      ? "⚠ DIVERGENT"
      : c.tier === "strong-aligned"
        ? "✦ STRONG-ALIGNED"
        : "✓ ALIGNED";
  return `${badge} — ${c.label}`;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

function fmtUsd(n: number): string {
  const sign = n < 0 ? "-" : "+";
  return `${sign}$${Math.abs(n).toFixed(0)}`;
}

/** HH:MMam / HH:MMpm in the process's local TZ. Terse by design. */
export function formatClockTime(ms: number, now: Date = new Date(ms)): string {
  const h24 = now.getHours();
  const m = now.getMinutes();
  const ampm = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}
