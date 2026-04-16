---
tags: [system, accounts, risk, portfolio]
date: 2026-04-16
source-count: 3
confidence: established
last-verified: 2026-04-16
---

# Account System

Three accounts, each capable of all trade types. Clawdius maintains a digital portfolio for each. Simon manages execution on TOS and Fidelity. Tradier is Clawdius's own account. See [[trading-system]] for the overall signal pipeline and evolution phases.

## Accounts

| Account | Balance | Broker | Execution | Capability |
|---------|---------|--------|-----------|------------|
| **tos** | $100K | ThinkOrSwim | Simon | Stocks, options, futures (/MES, /ES), shorting, margin |
| **ira** | $100K | Fidelity | Simon | Stocks, options, shorting via inverse ETFs (no futures, no margin) |
| **tradier** | $3K | Tradier | Clawdius | Stocks only (small size, PDT-limited, learning account) |

## Signal Sources — All Accounts

All three signal sources generate ideas for every account. Account constraints filter sizing, not eligibility.

| Source | What it provides | Account sizing |
|--------|-----------------|----------------|
| **Mancini** | ES levels, Failed Breakdowns. exec_as: /MES | TOS: 2-4 /MES. IRA: skip (no futures). Tradier: skip (no futures). |
| **DP** | Stock ideas, MAs, conviction, VTF alerts | TOS: full. IRA: full (long-only). Tradier: tiny. |
| **Focus 25** | RS leaders, actionable cards, confluence | TOS: full. IRA: full. Tradier: tiny. |
| **Scanner** | Algorithmic setups, RS plays | TOS: full. IRA: full. Tradier: own discretion. |

## Risk Rules (per account)

- **Max risk per trade:** 1% of account balance
- **Max concurrent positions:** 3-4
- **Max exposure:** 60% of account
- **Halt drawdown:** 10% from high-water mark -> review before resuming

### TOS — Full Capability
- All trade types, all instruments including /MES futures
- Margin available
- No PDT concern ($100K)
- Mancini setups execute as /MES ($5/pt per contract)

### IRA — Growth-Focused
- Stocks and options only (no futures)
- Long-only (short via inverse ETFs)
- No margin (cash-secured)
- PDT OK (balance > $25K)
- Tax-advantaged growth

### Tradier — Clawdius's Account
- $3K balance, small positions
- PDT-limited (< $25K, max 3 day trades per 5 rolling days)
- No margin, no shorting, no futures
- Currently alert-only (autonomous execution gated behind risk governor spec)

## Two Key Deliverables

### 1. Current Portfolio (per account)

```
=== Portfolio — YYYY-MM-DD HH:MM ===

TOS ($100K ThinkOrSwim)
  NVDA   100 sh @ $118.50   now $121.30   +$280 (+2.4%)   [swing, DP]
  Cash: $88,150  Exposure: 11.8%  Daily P&L: +$280

IRA ($100K Fidelity)
  META   30 sh @ $655.00    now $671.58   +$497 (+2.5%)   [investment, RS]
  Cash: $80,350  Exposure: 19.6%  Daily P&L: +$497

TRADIER ($3K Clawdius)
  [no positions]  Cash: $3,000  Exposure: 0%
```

### 2. Today's Trade List (per account)

```
=== Trades for Today — YYYY-MM-DD ===

EXECUTE NOW:
  #1 [TOS] BUY 2 /MES @ 7021 LMT — Mancini FB, MEDIUM conviction
     Stop: 6998  T1: 7036  T2: 7048  Risk: $230 (0.23%)

WATCH (not yet at level):
  #2 [TOS+IRA] AMZN @ $241 — DP "buyer below 241", HIGH conviction

EXECUTED TODAY:
  (none)
```

## Related

- [[dp-methodology]] — Trade ideas for all accounts
- [[dp-extraction-rules]] — Extraction rules including conviction scoring
- [[mancini-methodology]] — ES setups (TOS only via /MES)
- [[standard-order-format]] — ORDER blocks list eligible accounts
