/**
 * Market Engine — single-process entrypoint.
 *
 * Wires SQLite event log + Tradier REST client + plan loader + level
 * detector + risk check + Telegram outbound + catch-up reconciler + Hono
 * HTTP endpoints. One Node process, one loop, graceful shutdown.
 *
 * Messaging model (post-Signal refactor):
 *   - Outbound: direct Telegram Bot API sendMessage (shared bot with
 *     OpenClaw, Simon's existing chat thread).
 *   - Inbound: Clawdius talks to this sidecar via HTTP on the bridge
 *     network (POST /halt, /resume; GET /status, /plan, /positions).
 *     OpenClaw keeps owning Telegram long-polling — we never call
 *     getUpdates, so no bot-token conflict.
 */

import { watch } from "node:fs";
import { basename } from "node:path";

import { serve } from "@hono/node-server";
import { Hono } from "hono";

import {
  dispatchCommand,
  type CommandContext,
  type SystemSnapshot,
} from "./commands.js";
import {
  CLOCK_CHECK_MS,
  HEARTBEAT_MS,
  POLL_FAILURE_ALERT_THRESHOLD,
  POLL_MS,
  QUOTE_STALE_MS,
  briefPathFor,
  defaultRiskThresholds,
  resolveAccounts,
  resolvePaths,
  resolveTelegram,
  resolveTradier,
  resolveWatchlist,
} from "./config.js";
import { openTradingDB, startOfTodayMs, type TradingDB } from "./db.js";
import { makeLevelDetector } from "./detector.js";
import {
  buildAlert,
  scopeForAccounts as scopeFor,
} from "./pipeline.js";
import {
  computeConfluence,
  toSnapshot,
  type ConfluenceMap,
} from "./confluence.js";
import { loadPlan, type LoadedPlan } from "./plan.js";
import { findCatchupCandidates } from "./reconciler.js";
import { checkRisk } from "./risk.js";
import {
  formatAlertMessage,
  formatHeartbeat,
  generateAlertId,
  makeInMemoryChannel,
  makeTelegramChannel,
  type MessageChannel,
} from "./telegram.js";
import { makeTradierClient, type TradierClient } from "./tradier.js";
import type {
  Alert,
  LevelHit,
  MarketClock,
  PriceQuote,
  RiskState,
  TradingEvent,
} from "./types.js";

// ── Lifecycle ────────────────────────────────────────────────────────────────

interface RuntimeState {
  db: TradingDB;
  tradier: TradierClient;
  channel: MessageChannel;
  /**
   * Which channel backend is wired. `in-memory` means TELEGRAM_BOT_TOKEN
   * and/or TELEGRAM_CHAT_ID are unset — alerts are being sent into the
   * void. Surfaced on /health so `clawhq doctor` can raise a loud warning
   * instead of letting Simon trade blind.
   */
  channelKind: "telegram" | "in-memory" | "injected";
  plan: LoadedPlan | null;
  /** Cross-source confluence for the current plan — recomputed on each load. */
  confluence: ConfluenceMap;
  planPath: string;
  watchlist: string[];
  marketClock: MarketClock | null;
  riskState: RiskState;
  /** Pending alerts by ID — retained for TTL expiry + future reply routing. */
  pendingAlerts: Map<string, Alert>;
  /** Consecutive poll failures (for the >30 alert). */
  pollFailures: number;
  /** Last successful poll wall-clock ms. */
  lastPollMs: number | null;
  /** Last AlertSent wall-clock ms. */
  lastAlertMs: number | null;
  /** Next scheduled heartbeat wall-clock ms. */
  nextHeartbeatMs: number | null;
  /** Symbols currently counted against our polling load. */
  symbolCount: number;
  /** MANUAL halt edge state. */
  manualHalt: boolean;
  /** Shutting down? Skip new work. */
  shuttingDown: boolean;
}

export interface StartOptions {
  /** Substitute the outbound message channel (for tests). */
  channel?: MessageChannel;
  /** Override watchlist at startup. */
  watchlist?: string[];
  /** Override poll cadence (tests). */
  pollMs?: number;
}

export async function start(opts: StartOptions = {}): Promise<() => Promise<void>> {
  const paths = resolvePaths();
  const tradierConfig = resolveTradier();
  const telegramConfig = resolveTelegram();
  const accounts = resolveAccounts();
  const thresholds = defaultRiskThresholds();

  const db = openTradingDB(paths.dbPath);
  const tradier = makeTradierClient({
    baseUrl: tradierConfig.baseUrl,
    accountId: tradierConfig.accountId,
  });

  const hasTelegramConfig =
    telegramConfig.botToken.length > 0 && telegramConfig.chatId.length > 0;
  const channel: MessageChannel = opts.channel ??
    (hasTelegramConfig ? makeTelegramChannel(telegramConfig) : makeInMemoryChannel());
  const channelKind: "telegram" | "in-memory" | "injected" =
    opts.channel !== undefined ? "injected" : hasTelegramConfig ? "telegram" : "in-memory";

  const planPath = briefPathFor(paths);
  const watchlistBase = opts.watchlist ?? resolveWatchlist();

  const state: RuntimeState = {
    db,
    tradier,
    channel,
    channelKind,
    plan: null,
    confluence: new Map(),
    planPath,
    watchlist: watchlistBase,
    marketClock: null,
    riskState: {
      tradierBalance: accounts.tradier.balance,
      tradierPositions: [],
      tradierDailyPnl: 0,
      tradierPdtCountLast5Days: 0,
      advisoryHoldings: [],
    },
    pendingAlerts: new Map(),
    pollFailures: 0,
    lastPollMs: null,
    lastAlertMs: null,
    nextHeartbeatMs: null,
    symbolCount: 0,
    manualHalt: false,
    shuttingDown: false,
  };

  // Stale-quote gate is on in production — Tradier timestamps older than
  // QUOTE_STALE_MS stop emitting alerts until fresh data resumes.
  const detector = makeLevelDetector({ staleMs: QUOTE_STALE_MS });

  loadAndCommitPlan(state);

  // Fs-watch the brief file for intraday edits. Exact basename match
  // avoids false positives on siblings whose names end with today's date.
  const planBasename = basename(planPath);
  const watcher = watch(paths.memoryDir, (_evt, filename) => {
    if (filename === planBasename) loadAndCommitPlan(state);
  });

  const server = startHttpServer(state);

  await runBootReconciler(state);
  await refreshRiskState(state); // seed Tradier balance/positions before first poll

  const pollTimer = scheduleInterval(opts.pollMs ?? POLL_MS, () => pollOnce(state, detector, thresholds, accounts));
  const clockTimer = scheduleInterval(CLOCK_CHECK_MS, () => refreshMarketClock(state));
  const heartbeatTimer = scheduleInterval(HEARTBEAT_MS, () => sendHeartbeat(state));
  const riskRefreshTimer = scheduleInterval(60_000, () => refreshRiskState(state));
  const ttlTimer = scheduleInterval(30_000, () => expireAlerts(state));

  state.db.append({ type: "ServiceReady", tsMs: Date.now() });

  async function shutdown(): Promise<void> {
    if (state.shuttingDown) return;
    state.shuttingDown = true;
    clearInterval(pollTimer);
    clearInterval(clockTimer);
    clearInterval(heartbeatTimer);
    clearInterval(riskRefreshTimer);
    clearInterval(ttlTimer);
    watcher.close();
    state.db.append({
      type: "ServiceShuttingDown",
      tsMs: Date.now(),
      reason: "normal",
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    state.db.close();
  }

  return shutdown;
}

// ── HTTP surface ─────────────────────────────────────────────────────────────

/**
 * All inbound control comes through Hono endpoints. Clawdius calls these
 * over the bridge network when Simon asks it to halt / check status / etc.
 *
 * Bound to 0.0.0.0 inside the container; external exposure is restricted
 * at the Docker layer via `127.0.0.1:8080:8080` in compose — no LAN reach.
 */
function startHttpServer(state: RuntimeState): ReturnType<typeof serve> {
  const app = new Hono();

  app.get("/health", (c) => c.json(healthSnapshot(state)));
  app.get("/status", (c) => c.text(
    dispatchCommand({ command: "status", args: "" }, makeCommandContext(state)),
  ));
  app.get("/plan", (c) => c.text(
    dispatchCommand({ command: "plan", args: "" }, makeCommandContext(state)),
  ));
  app.get("/positions", (c) => c.text(
    dispatchCommand({ command: "positions", args: "" }, makeCommandContext(state)),
  ));
  app.post("/halt", async (c) => {
    const reason = (c.req.query("reason") ?? "via http").slice(0, 200);
    const out = dispatchCommand({ command: "halt", args: reason }, makeCommandContext(state));
    return c.json({ ok: true, message: out });
  });
  app.post("/resume", (c) => {
    const out = dispatchCommand({ command: "resume", args: "" }, makeCommandContext(state));
    return c.json({ ok: true, message: out });
  });

  return serve({ fetch: app.fetch, port: 8080, hostname: "0.0.0.0" });
}

// ── Poll loop ────────────────────────────────────────────────────────────────

type Detector = ReturnType<typeof makeLevelDetector>;

async function pollOnce(
  state: RuntimeState,
  detector: Detector,
  thresholds: ReturnType<typeof defaultRiskThresholds>,
  accounts: ReturnType<typeof resolveAccounts>,
): Promise<void> {
  if (state.shuttingDown) return;
  if (!isMarketActive(state.marketClock)) return;

  const symbols = allWatchedSymbols(state);
  state.symbolCount = symbols.length;
  if (symbols.length === 0) return;

  let quotes: Array<PriceQuote & { dayHigh: number; dayLow: number; prevClose: number }>;
  const pollMs = Date.now();
  try {
    quotes = await state.tradier.quotes(symbols);
    state.pollFailures = 0;
    state.lastPollMs = pollMs;
  } catch (err) {
    state.pollFailures += 1;
    appendEvent(state.db, {
      type: "PollFailed",
      tsMs: Date.now(),
      error: err instanceof Error ? err.message : String(err),
      consecutiveFailures: state.pollFailures,
    });
    if (state.pollFailures === POLL_FAILURE_ALERT_THRESHOLD) {
      await safeSend(
        state,
        `⚠️ Tradier REST: ${state.pollFailures} consecutive failures. Check cred-proxy / connectivity.`,
      );
    }
    return;
  }

  appendEvent(state.db, { type: "Poll", tsMs: pollMs, quotes });

  if (!state.plan || state.plan.orders.length === 0) return;

  const hits = detector.ingest(quotes, state.plan.orders, pollMs);
  for (const hit of hits) {
    appendEvent(state.db, { type: "LevelHit", tsMs: Date.now(), hit });
    if (state.manualHalt) continue;
    await handleLevelHit(state, hit, thresholds, accounts);
  }
}

async function handleLevelHit(
  state: RuntimeState,
  hit: LevelHit,
  thresholds: ReturnType<typeof defaultRiskThresholds>,
  accounts: ReturnType<typeof resolveAccounts>,
): Promise<void> {
  const order = state.plan?.orders.find((o) => o.id === hit.orderId);
  if (!order) return;

  const decision = checkRisk({
    order,
    state: state.riskState,
    thresholds,
    accounts,
  });
  appendEvent(state.db, {
    type: "RiskDecision",
    tsMs: Date.now(),
    orderId: order.id,
    decision,
  });
  if (decision.block) return;

  const finding = state.confluence.get(order.id);
  const alert = buildAlert({
    hit,
    order,
    decision,
    nowMs: Date.now(),
    alertId: generateAlertId(),
    ...(finding ? { confluence: toSnapshot(finding) } : {}),
  });

  state.pendingAlerts.set(alert.id, alert);
  state.lastAlertMs = Date.now();
  appendEvent(state.db, { type: "AlertSent", tsMs: Date.now(), alert });
  await safeSend(state, formatAlertMessage(alert), {
    quiet: alert.notify === "quiet",
  });
}

// ── Risk state refresh ───────────────────────────────────────────────────────

/**
 * Pull Tradier balance + positions periodically so the governor evaluates
 * against live state instead of defaults. Silent on failure — the last
 * good snapshot is still in state.riskState.
 */
async function refreshRiskState(state: RuntimeState): Promise<void> {
  if (state.shuttingDown) return;
  try {
    const [balances, positions] = await Promise.all([
      state.tradier.balances(),
      state.tradier.positions(),
    ]);
    state.riskState = {
      ...state.riskState,
      tradierBalance: balances.totalEquity || state.riskState.tradierBalance,
      tradierDailyPnl: balances.dayChange,
      tradierPdtCountLast5Days:
        balances.pdtCount ?? state.riskState.tradierPdtCountLast5Days,
      tradierPositions: positions.map((p) => ({
        symbol: p.symbol,
        qty: p.qty,
        avgPrice: p.avgPrice,
      })),
    };
  } catch {
    // Non-fatal — governor keeps operating against the last good snapshot.
  }
}

// ── Market clock ─────────────────────────────────────────────────────────────

async function refreshMarketClock(state: RuntimeState): Promise<void> {
  if (state.shuttingDown) return;
  try {
    const clock = await state.tradier.clock();
    state.marketClock = clock;
    appendEvent(state.db, {
      type: "MarketClockChecked",
      tsMs: Date.now(),
      state: clock.state,
      nextChangeMs: clock.nextChangeMs,
    });
  } catch {
    // Non-fatal — next tick retries.
  }
}

function isMarketActive(clock: MarketClock | null): boolean {
  if (!clock) return true; // default allow until we know otherwise
  return clock.state !== "closed";
}

// ── Heartbeat ────────────────────────────────────────────────────────────────

async function sendHeartbeat(state: RuntimeState): Promise<void> {
  if (state.shuttingDown) return;
  // Fires during regular hours OR when we don't know (clock unresolved).
  // The goal is "silent phone = broken system"; we'd rather send an extra
  // heartbeat off-hours than miss one because the clock call is failing.
  const clockState = state.marketClock?.state;
  if (clockState !== undefined && clockState !== "open") return;

  const now = Date.now();
  state.nextHeartbeatMs = now + HEARTBEAT_MS;
  const body = formatHeartbeat({
    nowMs: now,
    nextAtMs: state.nextHeartbeatMs,
    symbolCount: state.symbolCount,
    alertsToday: countAlertsToday(state),
    tradierPnl: state.riskState.tradierDailyPnl,
  });
  appendEvent(state.db, {
    type: "Heartbeat",
    tsMs: now,
    symbolCount: state.symbolCount,
    alertsToday: countAlertsToday(state),
    pnlTradier: state.riskState.tradierDailyPnl,
    nextAtMs: state.nextHeartbeatMs,
  });
  await safeSend(state, body);
}

// ── Alert TTL ────────────────────────────────────────────────────────────────

function expireAlerts(state: RuntimeState): void {
  const now = Date.now();
  for (const [id, alert] of state.pendingAlerts) {
    if (alert.expiresAtMs < now) {
      state.pendingAlerts.delete(id);
      appendEvent(state.db, {
        type: "AlertExpired",
        tsMs: now,
        alertId: id,
        reason: "TTL",
      });
    }
  }
}

// ── Plan loading ─────────────────────────────────────────────────────────────

function loadAndCommitPlan(state: RuntimeState): void {
  const result = loadPlan(state.planPath);
  if (!result.ok) {
    if (result.reason === "missing") {
      appendEvent(state.db, {
        type: "PlanMissing",
        tsMs: Date.now(),
        path: state.planPath,
      });
    } else {
      appendEvent(state.db, {
        type: "PlanParseFailed",
        tsMs: Date.now(),
        path: state.planPath,
        error: result.error ?? "",
      });
    }
    return;
  }
  state.plan = result.plan;
  state.confluence = computeConfluence(result.plan.orders);
  appendEvent(state.db, {
    type: "PlanLoaded",
    tsMs: Date.now(),
    orderCount: result.plan.orders.length,
    path: state.planPath,
  });
}

// ── Boot reconciler ──────────────────────────────────────────────────────────

async function runBootReconciler(state: RuntimeState): Promise<void> {
  if (!state.plan || state.plan.orders.length === 0) return;
  const symbols = [...new Set(state.plan.orders.map((o) => o.ticker.toUpperCase()))];
  let quotes: Array<PriceQuote & { dayHigh: number; dayLow: number; prevClose: number }>;
  try {
    quotes = await state.tradier.quotes(symbols);
  } catch {
    return;
  }

  const todaysAlerts = state.db.query({
    type: "AlertSent",
    sinceMs: startOfTodayMs(),
  });

  const candidates = findCatchupCandidates({
    orders: state.plan.orders,
    quotes,
    todaysAlerts,
  });

  for (const cand of candidates) {
    const syntheticHit: LevelHit = {
      orderId: cand.order.id,
      sequence: cand.order.sequence,
      ticker: cand.order.ticker,
      source: cand.order.source,
      levelName: cand.levelName,
      levelPrice: cand.levelPrice,
      crossingDirection: "UP",
      proximity: "AT",
      conviction: cand.order.conviction,
      confirmation: cand.order.confirmation,
      prevPrice: cand.dayLow,
      currentPrice: cand.currentPrice,
      hitMs: Date.now(),
      catchup: true,
    };
    const finding = state.confluence.get(cand.order.id);
    const alert = buildAlert({
      hit: syntheticHit,
      order: cand.order,
      decision: { scope: scopeFor(cand.order.accounts) },
      nowMs: Date.now(),
      alertId: generateAlertId(),
      catchup: true,
      ...(finding ? { confluence: toSnapshot(finding) } : {}),
    });
    state.pendingAlerts.set(alert.id, alert);
    state.lastAlertMs = Date.now();
    appendEvent(state.db, { type: "AlertSent", tsMs: Date.now(), alert });
    await safeSend(state, formatAlertMessage(alert), {
      quiet: alert.notify === "quiet",
    });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function appendEvent(db: TradingDB, event: TradingEvent): void {
  db.append(event);
}

async function safeSend(
  state: RuntimeState,
  body: string,
  opts: { quiet?: boolean } = {},
): Promise<void> {
  try {
    await state.channel.send(body, opts);
  } catch {
    // Silent — Telegram failures are observable via `clawhq doctor` health.
  }
}

function allWatchedSymbols(state: RuntimeState): string[] {
  const base = new Set(state.watchlist.map((s) => s.toUpperCase()));
  if (state.plan) {
    for (const o of state.plan.orders) {
      base.add(o.ticker.toUpperCase());
    }
  }
  return [...base];
}

function countAlertsToday(state: RuntimeState): number {
  return state.db.query({ type: "AlertSent", sinceMs: startOfTodayMs() }).length;
}

function makeCommandContext(state: RuntimeState): CommandContext {
  return {
    now: () => new Date(),
    snapshot: () => buildSnapshot(state),
    emitManualHalt: (reason) => {
      state.manualHalt = true;
      appendEvent(state.db, {
        type: "HaltEdge",
        tsMs: Date.now(),
        haltType: "MANUAL",
        direction: "entered",
        reason,
      });
    },
    clearManualHalt: () => {
      state.manualHalt = false;
      appendEvent(state.db, {
        type: "HaltEdge",
        tsMs: Date.now(),
        haltType: "MANUAL",
        direction: "cleared",
      });
    },
  };
}

function buildSnapshot(state: RuntimeState): SystemSnapshot {
  return {
    planLoaded: state.plan !== null,
    planPath: state.planPath,
    orders: state.plan?.orders ?? [],
    lastPollMs: state.lastPollMs,
    lastAlertMs: state.lastAlertMs,
    alertsToday: countAlertsToday(state),
    tradierPnl: state.riskState.tradierDailyPnl,
    tradierPositions: state.riskState.tradierPositions,
    manualHalt: state.manualHalt,
    nextHeartbeatMs: state.nextHeartbeatMs,
    symbolCount: state.symbolCount,
  };
}

function healthSnapshot(state: RuntimeState): Record<string, unknown> {
  return {
    status: state.shuttingDown ? "shutting_down" : "ready",
    channel: state.channelKind,
    planLoaded: state.plan !== null,
    planPath: state.planPath,
    orderCount: state.plan?.orders.length ?? 0,
    lastPollMs: state.lastPollMs,
    lastAlertMs: state.lastAlertMs,
    alertsToday: countAlertsToday(state),
    pollFailures: state.pollFailures,
    marketState: state.marketClock?.state ?? "unknown",
    manualHalt: state.manualHalt,
    pendingAlertCount: state.pendingAlerts.size,
    symbolCount: state.symbolCount,
    tradierBalance: state.riskState.tradierBalance,
    tradierPnl: state.riskState.tradierDailyPnl,
    tradierPositionCount: state.riskState.tradierPositions.length,
  };
}

function scheduleInterval(ms: number, fn: () => void | Promise<void>): NodeJS.Timeout {
  return setInterval(() => {
    void fn();
  }, ms);
}

// ── CLI bootstrap ────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  start()
    .then((shutdown) => {
      const stop = async (): Promise<void> => {
        await shutdown();
        process.exit(0);
      };
      process.on("SIGINT", () => void stop());
      process.on("SIGTERM", () => void stop());
    })
    .catch((err) => {
       
      console.error("market-engine failed to start:", err);
      process.exit(1);
    });
}
