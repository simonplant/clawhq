/**
 * Risk check — honestly scoped.
 *
 * LIMITATION (by design, not a bug): TOS and Fidelity (IRA) don't expose
 * programmatic position access. This check evaluates only the Tradier
 * account against the strict thresholds; TOS / IRA exposure is treated as
 * advisory-only, derived from annotations in today.md. See the §Risk check
 * section of the plan for the rationale.
 *
 * Phase A posture: the governor annotates every alert with its scope and a
 * warn message if anything crosses an advisory boundary. Tradier-strict
 * blocks the alert entirely; TOS / IRA never trigger a block.
 */

import { contractMultiplier, type RiskThresholds, type AccountConfig } from "./config.js";
import type {
  Account,
  OrderBlock,
  RiskDecision,
  RiskState,
} from "./types.js";

export interface RiskCheckInputs {
  order: OrderBlock;
  state: RiskState;
  thresholds: RiskThresholds;
  accounts: Record<Account, AccountConfig>;
}

/**
 * Pure function. Deterministic given its inputs. No I/O, no time.
 * Caller is responsible for providing a current `state` snapshot.
 */
export function checkRisk(inputs: RiskCheckInputs): RiskDecision {
  const { order, state, thresholds, accounts } = inputs;
  const scope = classifyScope(order.accounts);

  // ── Structural account rules (block regardless of scope) ───────────────
  // Long-only accounts (IRAs) cannot short. This isn't the governor
  // overstepping its authority — it's a broker/regulatory impossibility.
  if (order.direction === "SHORT") {
    const longOnlyHits = order.accounts.filter((a) => accounts[a]?.longOnly);
    if (longOnlyHits.length > 0) {
      return {
        block: `${longOnlyHits.join(", ")} is long-only — cannot route SHORT orders to retirement accounts`,
        scope,
      };
    }
  }

  // ── Event blackouts ────────────────────────────────────────────────────
  // An active FOMC / CPI / earnings window blocks Tradier (volatility risk
  // on a $3K account is amplified) and warns on advisory (Simon can still
  // decide to hold through in a $100K portfolio).
  const matchingBlackouts = (state.activeBlackouts ?? []).filter((b) =>
    blackoutMatchesOrder(b, order),
  );
  if (matchingBlackouts.length > 0) {
    const label = matchingBlackouts
      .map((b) => `${b.name} (${b.reason})`)
      .join("; ");
    if (scope === "tradier-strict" || scope === "mixed") {
      // For mixed scope we still hard-block — even the Tradier leg of the
      // order is at risk during the event window.
      return { block: `event blackout: ${label}`, scope };
    }
    // Advisory-only orders never block; surface a loud warning so Simon
    // sees it in the alert body.
    return { warn: `event blackout: ${label}`, scope };
  }

  // ── Advisory (TOS / IRA) — never blocks, may warn ──────────────────────
  const warnings: string[] = [];
  if (scope !== "tradier-strict") {
    const advisoryWarn = advisoryCrossAccountConcentration(order, state);
    if (advisoryWarn) warnings.push(advisoryWarn);
  }

  // ── Tradier strict — only when the order actually targets Tradier ──────
  if (order.accounts.includes("tradier")) {
    const tradier = accounts.tradier;

    // 0. Daily loss halt takes precedence — blocks every new proposal.
    if (state.tradierDailyPnl <= thresholds.dailyLossLimitUsd) {
      return {
        block: `daily loss limit reached (${formatUsd(state.tradierDailyPnl)} ≤ ${formatUsd(thresholds.dailyLossLimitUsd)})`,
        scope,
      };
    }

    // 1. Per-trade risk cap.
    const maxTradeRisk = tradier.balance * thresholds.maxRiskPerTradeFraction;
    if (order.totalRisk > maxTradeRisk) {
      return {
        block: `per-trade risk $${order.totalRisk.toFixed(0)} exceeds ${Math.round(thresholds.maxRiskPerTradeFraction * 100)}% cap ($${maxTradeRisk.toFixed(0)})`,
        scope,
        suggestedQuantity: suggestedQtyForRiskCap(order, maxTradeRisk),
      };
    }

    // 2. Concurrent position cap — would this open the (N+1)-th position?
    if (state.tradierPositions.length >= thresholds.maxConcurrentPositions) {
      return {
        block: `already at concurrent-position cap (${state.tradierPositions.length}/${thresholds.maxConcurrentPositions})`,
        scope,
      };
    }

    // 3. Gross exposure cap — sum of position notional vs balance.
    //    Multiplier accounts for futures ($5/pt for /MES, $50 for /ES, etc.)
    //    and options ($100/contract); equities default to 1.
    const mult = contractMultiplier(order.execAs);
    const currentExposure = state.tradierPositions.reduce(
      (sum, p) => sum + Math.abs(p.qty * p.avgPrice * contractMultiplier(p.symbol)),
      0,
    );
    const newPositionNotional = order.entry * order.quantity * mult;
    const projectedExposure = currentExposure + newPositionNotional;
    const maxExposure = tradier.balance * thresholds.maxExposureFraction;
    if (projectedExposure > maxExposure) {
      return {
        block: `projected exposure $${projectedExposure.toFixed(0)} exceeds ${Math.round(thresholds.maxExposureFraction * 100)}% cap ($${maxExposure.toFixed(0)})`,
        scope,
        suggestedQuantity: suggestedQtyForExposureCap(
          order,
          mult,
          currentExposure,
          maxExposure,
        ),
      };
    }

    // 4. PDT counter. Tradier PDT rule: a 4th day trade in 5 rolling days on
    // a cash account < $25K triggers a 90-day restriction. We can't know
    // for certain that *this* order will close same-day, but we can use the
    // order's horizon as a good proxy:
    //
    //   - session horizon (mancini, intraday): almost always closes same day;
    //     treat as a day trade → BLOCK when at the limit
    //   - swing/portfolio horizon: may hold overnight; WARN only
    //
    // Being willing to block a genuine intraday order at the limit is the
    // right posture — a 90-day freeze costs more than one missed trade.
    if (state.tradierPdtCountLast5Days >= thresholds.pdtLimit) {
      const likelyDayTrade = order.source === "mancini";
      if (likelyDayTrade) {
        return {
          block: `Tradier PDT at ${state.tradierPdtCountLast5Days}/${thresholds.pdtLimit} — intraday order would trigger 90-day PDT freeze`,
          scope,
        };
      }
      warnings.push(
        `Tradier PDT at ${state.tradierPdtCountLast5Days}/${thresholds.pdtLimit} — next same-day close is the 4th trade`,
      );
    }
  }

  return {
    warn: warnings.length > 0 ? warnings.join("; ") : undefined,
    scope,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Largest integer quantity whose total risk fits under `maxTradeRisk`.
 * Derived from the per-share risk Simon already encoded — respects his
 * stop choice rather than suggesting a tighter one behind his back.
 */
function suggestedQtyForRiskCap(
  order: OrderBlock,
  maxTradeRisk: number,
): number {
  if (order.riskPerShare <= 0) return 0;
  return Math.max(0, Math.floor(maxTradeRisk / order.riskPerShare));
}

/**
 * Largest integer quantity whose notional fits under the remaining
 * exposure budget. Uses the contract multiplier so /MES suggestions
 * are correct.
 */
function suggestedQtyForExposureCap(
  order: OrderBlock,
  multiplier: number,
  currentExposure: number,
  maxExposure: number,
): number {
  const budget = maxExposure - currentExposure;
  const perContract = order.entry * multiplier;
  if (perContract <= 0 || budget <= 0) return 0;
  return Math.max(0, Math.floor(budget / perContract));
}

function blackoutMatchesOrder(
  blackout: NonNullable<RiskState["activeBlackouts"]>[number],
  order: OrderBlock,
): boolean {
  if (blackout.scope === "all") return true;
  return blackout.scope.ticker.toUpperCase() === order.ticker.toUpperCase();
}

function classifyScope(accounts: Account[]): RiskDecision["scope"] {
  const hasTradier = accounts.includes("tradier");
  const hasAdvisory = accounts.includes("tos") || accounts.includes("ira");
  if (hasTradier && hasAdvisory) return "mixed";
  if (hasTradier) return "tradier-strict";
  return "advisory-only";
}

function advisoryCrossAccountConcentration(
  order: OrderBlock,
  state: RiskState,
): string | null {
  const held = state.advisoryHoldings.find(
    (h) => h.ticker.toUpperCase() === order.ticker.toUpperCase(),
  );
  if (!held) return null;
  const inAccounts = held.accounts.filter((a) => order.accounts.includes(a));
  if (inAccounts.length === 0) {
    // Held elsewhere but not in the accounts this order is routing to.
    return `cross-account note: ${order.ticker} already held on ${held.accounts.join(", ")} (not in this order's accounts)`;
  }
  return `cross-account concentration: ${order.ticker} already held on ${inAccounts.join(", ")}`;
}

function formatUsd(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(0)}`;
}
