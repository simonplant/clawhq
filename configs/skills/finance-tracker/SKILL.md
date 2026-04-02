# finance-tracker

Personal finance monitoring skill. Tracks account balances, flags unusual transactions, and delivers a weekly spending summary. Read-only — never moves money or makes financial decisions.

## Behavior

1. Fetch balances — Read current account balances from connected finance tools.
2. Scan transactions — Review recent transactions for: duplicates, unusual amounts, subscription charges.
3. Categorize — Group spending by category for the weekly summary.
4. Flag — Surface anything anomalous: charge >2x usual for a merchant, new subscription, duplicate transaction.
5. Deliver — Weekly summary on Sunday evening. Immediate alert for anomalies.

## Boundaries

- Read-only. Never initiates transfers, payments, or account changes.
- No credential storage — reads via tool integrations only.
- Anomaly alerts are informational — user decides on action.

## Schedule

Weekly summary: Sunday 7:00 PM. Anomaly scan: daily at 8:00 AM.

## Execution

Declarative skill. Trigger: "Run skill: finance-tracker". Load this SKILL.md, execute prompts.

### Prompts

- prompts/scan.md — Transaction scanning and anomaly detection
- prompts/summary.md — Weekly spending summary composition

## Model Requirements

- Provider: Local Ollama only
- Minimum model: llama3:8b
- No cloud escalation — financial data stays local
