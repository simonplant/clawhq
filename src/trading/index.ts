/**
 * Clawdius Trading Assistant — single-process entrypoint.
 *
 * Wires together: SQLite event log, Tradier REST client, plan loader,
 * level detector, risk check, Signal bridge, catch-up reconciler, health
 * endpoint. One Node process, one loop, graceful shutdown.
 */

import { watch } from "node:fs";
import { basename } from "node:path";

import { serve } from "@hono/node-server";
import { Hono } from "hono";

import {
  dispatchCommand,
  parseCommand,
  type CommandContext,
  type SystemSnapshot,
} from "./commands.js";
import {
  CLOCK_CHECK_MS,
  HEARTBEAT_MS,
  POLL_FAILURE_ALERT_THRESHOLD,
  POLL_MS,
  SELF_PING_MS,
  briefPathFor,
  defaultRiskThresholds,
  resolveAccounts,
  resolvePaths,
  resolveSignal,
  resolveTradier,
  resolveWatchlist,
} from "./config.js";
import { openTradingDB, startOfTodayMs, type TradingDB } from "./db.js";
import { makeLevelDetector } from "./detector.js";
import {
  buildAlert,
  scopeForAccounts as scopeFor,
} from "./pipeline.js";
import { loadPlan, type LoadedPlan } from "./plan.js";
import { findCatchupCandidates } from "./reconciler.js";
import { checkRisk } from "./risk.js";
import {
  formatAlertMessage,
  formatHeartbeat,
  generateAlertId,
  makeInMemoryChannel,
  makeSignalCliChannel,
  parseReply,
  type SignalChannel,
} from "./signal.js";
import { makeTradierClient, type TradierClient } from "./tradier.js";
import type {
  Alert,
  LevelHit,
  MarketClock,
  PriceQuote,
  RiskState,
  TradingEvent,
  UserReplyType,
} from "./types.js";

// ── Lifecycle ────────────────────────────────────────────────────────────────

interface RuntimeState {
  db: TradingDB;
  tradier: TradierClient;
  signal: SignalChannel;
  plan: LoadedPlan | null;
  planPath: string;
  watchlist: string[];
  marketClock: MarketClock | null;
  riskState: RiskState;
  /** Pending alerts by ID — used for reply threading and TTL expiry. */
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
  /** Substitute the Signal channel (for local dev without signal-cli). */
  signal?: SignalChannel;
  /** Override watchlist at startup. */
  watchlist?: string[];
  /** Override poll cadence (tests). */
  pollMs?: number;
}

export async function start(opts: StartOptions = {}): Promise<() => Promise<void>> {
  const paths = resolvePaths();
  const tradierConfig = resolveTradier();
  const signalConfig = resolveSignal();
  const accounts = resolveAccounts();
  const thresholds = defaultRiskThresholds();

  const db = openTradingDB(paths.dbPath);
  const tradier = makeTradierClient({
    baseUrl: tradierConfig.baseUrl,
    accountId: tradierConfig.accountId,
  });

  const signal: SignalChannel = opts.signal ??
    (signalConfig.selfNumber
      ? makeSignalCliChannel(signalConfig)
      : makeInMemoryChannel());

  const planPath = briefPathFor(paths);
  const watchlistBase = opts.watchlist ?? resolveWatchlist();

  const state: RuntimeState = {
    db,
    tradier,
    signal,
    plan: null,
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

  const detector = makeLevelDetector();

  // 1. Load plan (non-fatal if missing).
  loadAndCommitPlan(state);

  // 2. Fs-watch the brief file for intraday edits.
  // Exact basename match avoids false positives on siblings that happen
  // to end with today's date (e.g. a `news-trading-YYYY-MM-DD.md` sibling).
  const planBasename = basename(planPath);
  const watcher = watch(paths.memoryDir, (_evt, filename) => {
    if (filename === planBasename) loadAndCommitPlan(state);
  });

  // 3. Start Hono /health server.
  const app = new Hono();
  app.get("/health", (c) => c.json(healthSnapshot(state)));
  // Bind to 0.0.0.0 inside the container so Docker port-forwarding works.
  // External exposure is restricted at the Docker layer via `127.0.0.1:8080:8080`
  // in the compose file — no inbound reachable from the LAN.
  const server = serve({ fetch: app.fetch, port: 8080, hostname: "0.0.0.0" });

  // 4. Boot reconciliation — catch-up alerts for levels crossed during downtime.
  await runBootReconciler(state);

  // 5. Kick off loops.
  const pollTimer = scheduleInterval(opts.pollMs ?? POLL_MS, () => pollOnce(state, detector, thresholds, accounts));
  const clockTimer = scheduleInterval(CLOCK_CHECK_MS, () => refreshMarketClock(state));
  const heartbeatTimer = scheduleInterval(HEARTBEAT_MS, () => sendHeartbeat(state));
  const selfPingTimer = scheduleInterval(SELF_PING_MS, () => runSelfPing(state));
  const ttlTimer = scheduleInterval(30_000, () => expireAlerts(state));
  const replyTimer = scheduleInterval(signalConfig.receivePollMs, () => drainSignalInbox(state));

  state.db.append({ type: "ServiceReady", tsMs: Date.now() });

  async function shutdown(): Promise<void> {
    if (state.shuttingDown) return;
    state.shuttingDown = true;
    clearInterval(pollTimer);
    clearInterval(clockTimer);
    clearInterval(heartbeatTimer);
    clearInterval(selfPingTimer);
    clearInterval(ttlTimer);
    clearInterval(replyTimer);
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
  if (decision.block) return; // suppressed

  const alert = buildAlert({
    hit,
    order,
    decision,
    nowMs: Date.now(),
    alertId: generateAlertId(),
  });

  state.pendingAlerts.set(alert.id, alert);
  state.lastAlertMs = Date.now();
  appendEvent(state.db, { type: "AlertSent", tsMs: Date.now(), alert });
  await safeSend(state, formatAlertMessage(alert));
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

// ── Heartbeat + self-ping ────────────────────────────────────────────────────

async function sendHeartbeat(state: RuntimeState): Promise<void> {
  if (state.shuttingDown) return;
  if (state.marketClock && state.marketClock.state !== "open") return;
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

async function runSelfPing(state: RuntimeState): Promise<void> {
  if (state.shuttingDown) return;
  const pingId = generateAlertId();
  const marker = `__selfping_${pingId}__`;
  appendEvent(state.db, { type: "SignalSelfPingSent", tsMs: Date.now(), pingId });
  await safeSend(state, marker);
  // Listener picks it up; if never received, a later health query surfaces it.
}

// ── Reply / command inbox ────────────────────────────────────────────────────

async function drainSignalInbox(state: RuntimeState): Promise<void> {
  if (state.shuttingDown) return;
  let messages: string[];
  try {
    messages = await state.signal.receive();
  } catch {
    return;
  }

  for (const raw of messages) {
    await processIncoming(state, raw);
  }
}

async function processIncoming(state: RuntimeState, raw: string): Promise<void> {
  // Self-ping round trip first (cheapest check).
  const selfMatch = /__selfping_([A-Z0-9]{4})__/.exec(raw);
  if (selfMatch) {
    appendEvent(state.db, {
      type: "SignalSelfPingReceived",
      tsMs: Date.now(),
      pingId: selfMatch[1] ?? "",
      latencyMs: 0,
    });
    return;
  }

  // Alert reply.
  const reply = parseReply(raw);
  if (reply.type && reply.alertId) {
    await handleReply(state, reply.type, reply.alertId, raw);
    return;
  }

  // Slash/verb command.
  const cmd = parseCommand(raw);
  if (cmd) {
    appendEvent(state.db, {
      type: "CommandReceived",
      tsMs: Date.now(),
      command: cmd.command,
      rawArgs: cmd.args,
    });
    const out = dispatchCommand(cmd, makeCommandContext(state));
    await safeSend(state, out);
    return;
  }

  // Unrecognized — don't reply, just log.
  appendEvent(state.db, {
    type: "UserReplyIgnored",
    tsMs: Date.now(),
    alertId: "",
    reason: "unknown-id",
    raw,
  });
}

async function handleReply(
  state: RuntimeState,
  type: UserReplyType,
  alertId: string,
  raw: string,
): Promise<void> {
  const pending = state.pendingAlerts.get(alertId);
  if (!pending) {
    appendEvent(state.db, {
      type: "UserReplyIgnored",
      tsMs: Date.now(),
      alertId,
      reason: "unknown-id",
      raw,
    });
    await safeSend(
      state,
      `(no pending alert for ${alertId} — may have expired)`,
    );
    return;
  }
  if (pending.expiresAtMs < Date.now()) {
    appendEvent(state.db, {
      type: "UserReplyIgnored",
      tsMs: Date.now(),
      alertId,
      reason: "expired",
      raw,
    });
    await safeSend(state, `(alert ${alertId} expired; resubmit if still actionable)`);
    return;
  }

  state.pendingAlerts.delete(alertId);
  appendEvent(state.db, {
    type: "UserReply",
    tsMs: Date.now(),
    alertId,
    reply: type,
    raw,
  });
  await safeSend(state, `ack ${alertId}: ${type}`);
}

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
    const alert = buildAlert({
      hit: syntheticHit,
      order: cand.order,
      decision: { scope: scopeFor(cand.order.accounts) },
      nowMs: Date.now(),
      alertId: generateAlertId(),
      catchup: true,
    });
    state.pendingAlerts.set(alert.id, alert);
    state.lastAlertMs = Date.now();
    appendEvent(state.db, { type: "AlertSent", tsMs: Date.now(), alert });
    await safeSend(state, formatAlertMessage(alert));
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function appendEvent(db: TradingDB, event: TradingEvent): void {
  db.append(event);
}

async function safeSend(state: RuntimeState, body: string): Promise<void> {
  try {
    await state.signal.send(body);
  } catch {
    // Silent — Signal failures are observable via self-ping and healthcheck.
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
       
      console.error("clawdius-trading failed to start:", err);
      process.exit(1);
    });
}
