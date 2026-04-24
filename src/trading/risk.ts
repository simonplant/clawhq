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

import type { RiskThresholds, AccountConfig } from "./config.js";
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
    const currentExposure = state.tradierPositions.reduce(
      (sum, p) => sum + Math.abs(p.qty * p.avgPrice),
      0,
    );
    const newPositionNotional = order.entry * order.quantity;
    const projectedExposure = currentExposure + newPositionNotional;
    const maxExposure = tradier.balance * thresholds.maxExposureFraction;
    if (projectedExposure > maxExposure) {
      return {
        block: `projected exposure $${projectedExposure.toFixed(0)} exceeds ${Math.round(thresholds.maxExposureFraction * 100)}% cap ($${maxExposure.toFixed(0)})`,
        scope,
      };
    }

    // 4. PDT counter. Tradier PDT rule: ≥ N day trades in 5 days on a cash
    // account < $25K. We can't know whether this specific trade will close
    // same-day, so we WARN rather than block when at the limit.
    if (state.tradierPdtCountLast5Days >= thresholds.pdtLimit) {
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
