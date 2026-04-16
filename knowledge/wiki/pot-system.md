---
tags: [system, accounts, risk, portfolio]
date: 2026-04-15
source-count: 3
confidence: established
last-verified: 2026-04-15
---

# Account System

Three accounts, each optimized for maximum profit and growth. All accounts are capable of investment, swing, day, and scalp trades. Clawdius maintains a digital portfolio representation for each account. Simon manages trade execution on TOS and Fidelity. Tradier is Clawdius's own account.

## Accounts

| Account | Balance | Broker | Execution | Capability |
|---------|---------|--------|-----------|------------|
| **tos** | $100K | ThinkOrSwim | Simon | Stocks, options, futures, shorting, margin |
| **ira** | $100K | Fidelity | Simon | Stocks, options, shorting (limited margin, no futures) |
| **tradier** | $3K | Tradier | Clawdius | Stocks (small size, learning account) |

## Trade Types — All Accounts

Every account can take any trade type. Sizing differs by account balance.

| Trade Type | TOS ($100K) | IRA ($100K) | Tradier ($3K) |
|------------|------------|-------------|---------------|
| **Investment** (weeks-months) | Up to $10K per position | Up to $10K per position | Up to $450 per position |
| **Swing** (days-weeks) | Up to $5K, 1% risk | Up to $5K, 1% risk | Up to $150, 1% risk |
| **Day trade** (intraday) | Full access, no PDT issues | PDT-aware (>$25K OK) | PDT-limited ($3K < $25K) |
| **Scalp** (minutes) | Full access | Full access | PDT-limited |

## Two Key Deliverables

Clawdius produces two things Simon needs every day:

### 1. Current Portfolio (per account)

At any point, Simon can ask "show me my portfolio" and get:

```
=== Portfolio — YYYY-MM-DD HH:MM ===

TOS ($100K ThinkOrSwim)
  NVDA   100 sh @ $118.50   now $121.30   +$280 (+2.4%)   [swing, DP]
  SPY    50 sh @ $695.00    now $699.94   +$247 (+0.7%)   [day, Mancini FB]
  Cash: $82,150  Exposure: 17.8%  Daily P&L: +$527

IRA ($100K Fidelity)
  META   30 sh @ $655.00    now $671.58   +$497 (+2.5%)   [investment, RS leader]
  AAPL   40 sh @ $258.00    now $266.43   +$337 (+3.3%)   [swing, 21d pullback]
  Cash: $73,550  Exposure: 26.4%  Daily P&L: +$834

TRADIER ($3K Clawdius)
  SPY    3 sh @ $697.00     now $699.94   +$8.82 (+0.4%)  [day, scanner]
  Cash: $1,909  Exposure: 36.4%  Daily P&L: +$8.82
```

This is the digital shadow portfolio. Simon syncs actual positions periodically.

### 2. Today's Trade List (per account)

Every morning (premarket brief) and throughout the day (VTF alerts, scanner hits), Clawdius produces a running list of trades to execute:

```
=== Trades for Today — YYYY-MM-DD ===

EXECUTE NOW:
  #1 [TOS] BUY 50 SPY @ $695.00 LMT — Mancini FB, HIGH conviction
     Stop: $690  T1: $705  T2: $710  Risk: $250 (0.25%)
  #2 [TOS+IRA] BUY NVDA @ $118.50 LMT — DP "my favorite name", HIGH conviction
     TOS: 85 shares ($10K)  IRA: 85 shares ($10K)  Stop: $116

WATCH (not yet at level):
  #3 [ALL] META @ $660 — DP "buyable at 660", MEDIUM conviction
     Currently $671.58, 1.8% away. Alert when approaching.

EXECUTED TODAY:
  #4 [TOS] SOLD 100 AAPL @ $266.00 — T1 hit, scaled 75%. Runner: 25 sh trailing.

IRA SKIPS: none today (all ideas are long-eligible)
TRADIER: #1 sized down to 3 shares SPY ($2,085 position, 69% of account)
```

## Signal Sources → All Accounts

All three signal sources (Mancini, DP, Clawdius/market data) generate ideas for every account. Account constraints filter sizing, not eligibility.

| Source | What it provides | Account sizing |
|--------|-----------------|----------------|
| **Mancini** | ES/SPY levels, Failed Breakdowns | TOS: full. IRA: full. Tradier: tiny. |
| **DP** | Stock ideas, MAs, conviction, VTF alerts | TOS: full. IRA: full (long-only if short). Tradier: tiny. |
| **Clawdius/TA** | Scanner setups, RS plays, own analysis | TOS: full. IRA: full. Tradier: own discretion. |

## Account-Specific Rules

### TOS — Full Capability
- All trade types, all instruments
- Margin available for larger positions
- Futures (ES) directly
- Options strategies
- No PDT concern ($100K)

### IRA — Growth-Focused
- All trade types including day/scalp (balance > $25K so PDT OK)
- Options available for hedging and income
- Shorting via inverse ETFs or limited short selling
- No margin (IRA restriction) — cash-secured only
- No futures (IRA restriction on most brokers)
- Optimized for tax-advantaged growth

### Tradier — Clawdius's Learning Account
- Small positions ($3K total)
- PDT-limited (< $25K, max 3 day trades per 5 rolling days)
- No margin, no shorting (cash account)
- Clawdius has full discretion — this is his account to learn with
- Currently alert-only (Phase 6 enables autonomous execution)

## Digital Portfolio Representation

Clawdius maintains a shadow portfolio for each account:
- **Positions:** symbol, qty, entry price, current price, unrealized P&L, trade type, signal source
- **Cash balance** and exposure percentage
- **Open orders** and ORDER block status
- **Daily P&L** (realized + unrealized)

Simon syncs actual positions periodically. The shadow portfolio drives:
- Position sizing in ORDER blocks (sized per account)
- Risk governor checks (per-account constraints)
- EOD review and performance comparison
- The premarket brief's ACCOUNT STATUS section

## Related

- [[dp-methodology]] — Trade ideas for all accounts
- [[dp-conviction-scoring]] — How DP language maps to sizing
- [[mancini-methodology]] — ES setups for all accounts
- [[standard-order-format]] — ORDER blocks list eligible accounts
