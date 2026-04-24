/**
 * Shadow-mode replay harness.
 *
 * Drives the same pipeline the live server uses — plan → detector → risk →
 * pipeline — against a scripted quote stream with no network or DB. The
 * output is a deterministic trace of every alert and block the orchestrator
 * would have emitted. Tests assert that trace against an expected shape.
 *
 * Why this exists: the rule is alert-only until risk governor + shadow mode
 * prove out. Shadow mode is the proof — it lets us replay historical briefs
 * against historical ticks and validate that the governor never lets a bad
 * alert through and never drops a good one. Anything autonomy-adjacent
 * (auto-submit, sizing, Kelly, etc.) ships behind a passing shadow run.
 *
 * Purity: one function, one result. No I/O apart from the caller supplying
 * scenario data. The detector's monotonic clock is driven by the scenario's
 * tick timestamps so dedup behavior is reproducible.
 */

import { defaultRiskThresholds, resolveAccounts } from "./config.js";
import { makeLevelDetector } from "./detector.js";
import { buildAlert } from "./pipeline.js";
import { parseOrderBlocks } from "./plan.js";
import { findCatchupCandidates } from "./reconciler.js";
import { checkRisk } from "./risk.js";
import type {
  Alert,
  LevelHit,
  OrderBlock,
  PriceQuote,
  RiskDecision,
  RiskState,
} from "./types.js";

/** Minimal quote tick — scenarios don't bother with bid/ask. */
export interface ShadowTick {
  symbol: string;
  last: number;
  /** Wall-clock ms. Drives both event stamps and monotonic-clock advance. */
  tsMs: number;
}

export interface ShadowScenario {
  name: string;
  /** Inline brief text (parsed with parseOrderBlocks) OR explicit orders. */
  brief?: string;
  orders?: OrderBlock[];
  /** Chronological quote ticks. */
  ticks: ShadowTick[];
  /** RiskState overrides; defaults to flat Tradier with no positions. */
  state?: Partial<RiskState>;
  /** Seed prior prices so the first tick can already be a crossing. */
  seedPrices?: Record<string, number>;
  /** Starting monotonic ms (default: 0). Only affects dedup behavior. */
  startMonoMs?: number;
  /** Override detector dedup TTL. */
  dedupTtlMs?: number;
  /**
   * Optional boot-reconciler phase. Runs before ticks. Simulates a crash
   * where the sidecar restarts mid-session and has to catch up on levels
   * that moved through while it was down.
   *
   *   bootQuotes   — quotes with today's H/L/last; derives catch-up candidates
   *   todaysAlerts — alert ids already logged today (suppresses duplicates)
   */
  boot?: {
    bootQuotes: Array<{
      symbol: string;
      last: number;
      tsMs: number;
      dayHigh: number;
      dayLow: number;
    }>;
    /** Order ids × levelName tuples already alerted today (dedup bootstrap). */
    priorAlerts?: Array<{ orderId: string; levelName: "entry" | "stop" | "t1" | "t2" }>;
    /** Wall-clock ms assigned to the catch-up events. Default: startMonoMs. */
    nowMs?: number;
  };
}

export interface ShadowEvent {
  kind: "alert" | "blocked";
  tsMs: number;
  orderId: string;
  sequence: number;
  levelName: "entry" | "stop" | "t1" | "t2";
  crossingDirection: "UP" | "DOWN";
  decision: RiskDecision;
  /** Present when kind=alert. */
  alert?: Alert;
  /** Present when kind=blocked. */
  blockReason?: string;
  /** True when the alert would have been sent silently. */
  quiet?: boolean;
}

export interface ShadowResult {
  name: string;
  orderCount: number;
  parseWarnings: string[];
  events: ShadowEvent[];
}

export interface ShadowOptions {
  /** Alert-id generator; default is a deterministic counter. */
  alertId?: () => string;
  /** Inject risk-state mutations between ticks (e.g. simulate PnL changes). */
  advanceState?: (state: RiskState, tick: ShadowTick) => void;
}

/**
 * Replay a scenario through the pipeline. Pure: no filesystem, no Tradier,
 * no Telegram. Every event that the live orchestrator would emit — alert or
 * governor block — appears in `events` in the order it would have fired.
 */
export function replayScenario(
  scenario: ShadowScenario,
  opts: ShadowOptions = {},
): ShadowResult {
  const { orders, parseWarnings } = resolveOrders(scenario);

  const thresholds = defaultRiskThresholds();
  const accounts = resolveAccounts();
  const state: RiskState = {
    tradierBalance: accounts.tradier.balance,
    tradierPositions: [],
    tradierDailyPnl: 0,
    tradierPdtCountLast5Days: 0,
    advisoryHoldings: [],
    ...scenario.state,
  };

  let monoNow = scenario.startMonoMs ?? 0;
  const detector = makeLevelDetector({
    dedupTtlMs: scenario.dedupTtlMs,
    monotonicNowMs: () => monoNow,
  });

  if (scenario.seedPrices) {
    for (const [sym, price] of Object.entries(scenario.seedPrices)) {
      detector.seedPrice(sym, price);
    }
  }

  let idCounter = 0;
  const nextAlertId =
    opts.alertId ?? (() => `S${String(++idCounter).padStart(3, "0")}`);

  const ordersById = new Map(orders.map((o) => [o.id, o]));
  const events: ShadowEvent[] = [];
  let prevTs = scenario.startMonoMs ?? 0;

  // ── Optional boot-reconciler phase ───────────────────────────────────────
  if (scenario.boot) {
    const bootNowMs = scenario.boot.nowMs ?? scenario.startMonoMs ?? 0;
    // Synthesize the AlertSent event log from priorAlerts so the reconciler
    // can suppress duplicates the same way it would against a real SQLite
    // events table.
    const syntheticLog = (scenario.boot.priorAlerts ?? []).map(
      (entry, idx) => ({
        id: idx + 1,
        tsMs: bootNowMs - 60_000,
        type: "AlertSent" as const,
        payload: {
          type: "AlertSent" as const,
          tsMs: bootNowMs - 60_000,
          alert: {
            id: `PRI${idx}`,
            orderId: entry.orderId,
            sequence: 0,
            source: "mancini" as const,
            horizon: "session" as const,
            ticker: "",
            execAs: "",
            accounts: [] as never[],
            direction: "LONG" as const,
            conviction: "HIGH" as const,
            confirmation: "CONFIRMED" as const,
            entry: 0,
            stop: 0,
            t1: 0,
            t2: 0,
            totalRisk: 0,
            levelName: entry.levelName,
            levelPrice: 0,
            risk: { scope: "advisory-only" as const },
            expiresAtMs: bootNowMs,
          },
        },
      }),
    );
    const candidates = findCatchupCandidates({
      orders,
      quotes: scenario.boot.bootQuotes.map((q) => ({
        ...q,
        bid: q.last,
        ask: q.last,
        receivedMs: q.tsMs,
      })),
      todaysAlerts: syntheticLog,
    });

    // Seed detector prices from boot quotes so the first live tick crosses
    // cleanly from the most recent price — mirrors runBootReconciler behavior.
    for (const q of scenario.boot.bootQuotes) {
      detector.seedPrice(q.symbol, q.last);
    }

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
        hitMs: bootNowMs,
        catchup: true,
      };
      const decision = checkRisk({ order: cand.order, state, thresholds, accounts });
      if (decision.block) {
        events.push({
          kind: "blocked",
          tsMs: bootNowMs,
          orderId: cand.order.id,
          sequence: cand.order.sequence,
          levelName: cand.levelName,
          crossingDirection: "UP",
          decision,
          blockReason: decision.block,
        });
        continue;
      }
      const alert = buildAlert({
        hit: syntheticHit,
        order: cand.order,
        decision,
        nowMs: bootNowMs,
        alertId: nextAlertId(),
        catchup: true,
      });
      events.push({
        kind: "alert",
        tsMs: bootNowMs,
        orderId: cand.order.id,
        sequence: cand.order.sequence,
        levelName: cand.levelName,
        crossingDirection: "UP",
        decision,
        alert,
        quiet: alert.notify === "quiet",
      });
    }
  }

  for (const tick of scenario.ticks) {
    // Monotonic clock tracks wall-clock deltas so dedup TTL is deterministic.
    monoNow += Math.max(0, tick.tsMs - prevTs);
    prevTs = tick.tsMs;

    opts.advanceState?.(state, tick);

    const q: PriceQuote = {
      symbol: tick.symbol,
      last: tick.last,
      bid: tick.last,
      ask: tick.last,
      tsMs: tick.tsMs,
      receivedMs: tick.tsMs,
    };
    const hits = detector.ingest([q], orders, tick.tsMs);

    for (const hit of hits) {
      const order = ordersById.get(hit.orderId);
      if (!order) continue;

      const decision = checkRisk({ order, state, thresholds, accounts });

      if (decision.block) {
        events.push({
          kind: "blocked",
          tsMs: tick.tsMs,
          orderId: order.id,
          sequence: order.sequence,
          levelName: hit.levelName,
          crossingDirection: hit.crossingDirection,
          decision,
          blockReason: decision.block,
        });
        continue;
      }

      const alert = buildAlert({
        hit,
        order,
        decision,
        nowMs: tick.tsMs,
        alertId: nextAlertId(),
      });
      events.push({
        kind: "alert",
        tsMs: tick.tsMs,
        orderId: order.id,
        sequence: order.sequence,
        levelName: hit.levelName,
        crossingDirection: hit.crossingDirection,
        decision,
        alert,
        quiet: alert.notify === "quiet",
      });
    }
  }

  return {
    name: scenario.name,
    orderCount: orders.length,
    parseWarnings,
    events,
  };
}

function resolveOrders(scenario: ShadowScenario): {
  orders: OrderBlock[];
  parseWarnings: string[];
} {
  if (scenario.orders) {
    return { orders: scenario.orders, parseWarnings: [] };
  }
  if (scenario.brief !== undefined) {
    const { orders, warnings } = parseOrderBlocks(scenario.brief);
    return { orders, parseWarnings: warnings };
  }
  throw new Error(`shadow scenario "${scenario.name}": must supply brief or orders`);
}

// ── Assertions ──────────────────────────────────────────────────────────────

export interface ExpectedEvent {
  kind: "alert" | "blocked";
  sequence?: number;
  orderIdPrefix?: string;
  levelName?: "entry" | "stop" | "t1" | "t2";
  crossingDirection?: "UP" | "DOWN";
  blockMatches?: RegExp;
  /** If set, demand `decision.warn` matches. */
  warnMatches?: RegExp;
  /** Expected notification tier. */
  quiet?: boolean;
}

export interface TraceDiff {
  ok: boolean;
  /** Human-readable descriptions of each mismatch. */
  problems: string[];
}

/**
 * Compare an actual replay trace to an expected sequence.
 * Matches position-by-position; each expectation must hold exactly.
 */
export function diffTrace(
  result: ShadowResult,
  expected: ExpectedEvent[],
): TraceDiff {
  const problems: string[] = [];
  if (result.events.length !== expected.length) {
    problems.push(
      `event count: expected ${expected.length}, got ${result.events.length}`,
    );
  }

  const len = Math.min(result.events.length, expected.length);
  for (let i = 0; i < len; i++) {
    const got = result.events[i]!;
    const want = expected[i]!;
    if (got.kind !== want.kind) {
      problems.push(`#${i}: kind — expected ${want.kind}, got ${got.kind}`);
      continue;
    }
    if (want.sequence !== undefined && got.sequence !== want.sequence) {
      problems.push(`#${i}: sequence — expected ${want.sequence}, got ${got.sequence}`);
    }
    if (want.orderIdPrefix && !got.orderId.startsWith(want.orderIdPrefix)) {
      problems.push(
        `#${i}: orderId — expected prefix ${want.orderIdPrefix}, got ${got.orderId}`,
      );
    }
    if (want.levelName && got.levelName !== want.levelName) {
      problems.push(
        `#${i}: levelName — expected ${want.levelName}, got ${got.levelName}`,
      );
    }
    if (want.crossingDirection && got.crossingDirection !== want.crossingDirection) {
      problems.push(
        `#${i}: direction — expected ${want.crossingDirection}, got ${got.crossingDirection}`,
      );
    }
    if (want.blockMatches) {
      if (got.kind !== "blocked" || !want.blockMatches.test(got.blockReason ?? "")) {
        problems.push(
          `#${i}: block reason "${got.blockReason ?? ""}" doesn't match ${want.blockMatches}`,
        );
      }
    }
    if (want.warnMatches) {
      if (!want.warnMatches.test(got.decision.warn ?? "")) {
        problems.push(
          `#${i}: warn "${got.decision.warn ?? ""}" doesn't match ${want.warnMatches}`,
        );
      }
    }
    if (want.quiet !== undefined && got.kind === "alert") {
      const actualQuiet = got.quiet === true;
      if (actualQuiet !== want.quiet) {
        problems.push(
          `#${i}: quiet — expected ${want.quiet}, got ${actualQuiet}`,
        );
      }
    }
  }
  for (let i = len; i < result.events.length; i++) {
    const e = result.events[i]!;
    problems.push(`extra #${i}: ${e.kind} seq=${e.sequence} ${e.levelName}`);
  }
  for (let i = len; i < expected.length; i++) {
    const e = expected[i]!;
    problems.push(`missing #${i}: ${e.kind}${e.sequence ? ` seq=${e.sequence}` : ""}`);
  }
  return { ok: problems.length === 0, problems };
}

// ── JSON scenario file loader ──────────────────────────────────────────────

/**
 * On-disk scenario format. Extends ShadowScenario with an `expected` array
 * and a `doc` string so the files are self-describing regression fixtures.
 */
export interface ScenarioFile {
  name: string;
  doc?: string;
  brief?: string;
  ticks: ShadowTick[];
  state?: Partial<import("./types.js").RiskState>;
  seedPrices?: Record<string, number>;
  startMonoMs?: number;
  dedupTtlMs?: number;
  boot?: ShadowScenario["boot"];
  expected: ExpectedEventFile[];
}

/** On-disk expected-event shape; `blockMatches` travels as a string. */
export interface ExpectedEventFile
  extends Omit<ExpectedEvent, "blockMatches" | "warnMatches"> {
  blockMatches?: string;
  warnMatches?: string;
}

/**
 * Lower a ScenarioFile into runtime shapes: a ShadowScenario (no `expected`)
 * plus an ExpectedEvent[] with real RegExp instances.
 */
export function materializeScenario(file: ScenarioFile): {
  scenario: ShadowScenario;
  expected: ExpectedEvent[];
} {
  const { expected: expectedFile, doc: _doc, ...rest } = file;
  const expected: ExpectedEvent[] = expectedFile.map((e) => ({
    ...e,
    blockMatches: e.blockMatches ? new RegExp(e.blockMatches, "i") : undefined,
    warnMatches: e.warnMatches ? new RegExp(e.warnMatches, "i") : undefined,
  }));
  return { scenario: rest, expected };
}

/** One-liner summary of a trace — useful for debug dumps. */
export function summarizeTrace(result: ShadowResult): string {
  const lines: string[] = [];
  lines.push(
    `shadow/${result.name}: ${result.orderCount} orders, ${result.events.length} events` +
      (result.parseWarnings.length ? ` (${result.parseWarnings.length} parse warnings)` : ""),
  );
  for (const [i, e] of result.events.entries()) {
    if (e.kind === "alert") {
      lines.push(
        `  #${i} ALERT   seq=${e.sequence} ${e.levelName} ${e.crossingDirection} ` +
          `@${e.alert?.levelPrice} id=${e.alert?.id}`,
      );
    } else {
      lines.push(
        `  #${i} BLOCKED seq=${e.sequence} ${e.levelName} ${e.crossingDirection} — ${e.blockReason}`,
      );
    }
  }
  return lines.join("\n");
}
