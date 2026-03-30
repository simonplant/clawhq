# Your AI Agent Should Never Touch Your Bank Account

> How to get financial awareness from a sovereign AI agent without giving it the keys to your money.

**Published:** 2026-03-29 · **Source:** FEAT-126 Personal Finance Assistant blueprint

---

## The Problem

Every personal finance app — Mint, YNAB, Copilot, Monarch — requires read-write access to your bank accounts through aggregation APIs. Most users don't realize that "connect your bank" means granting token scopes that can initiate transfers, modify account settings, or access full account numbers. When these services get breached (Mint's parent Intuit: 2023, Plaid settlement: 2022), the exposure isn't just transaction history — it's write access to your financial life.

Now add AI agents to the mix. An agent with write access to your bank account is one prompt injection away from initiating a transfer. One hallucination away from paying the wrong bill. One credential leak away from draining your account. The failure mode isn't "bad summary" — it's financial loss.

## Context

The core tension: you want your AI agent to understand your finances (categorize spending, track budgets, alert on anomalies), but every existing integration model grants more access than the task requires. Plaid's API supports read-only scopes (`transactions`, `balance`) separately from write scopes (`transfer`, `payment_initiation`), but most apps request everything because it's easier to implement.

For self-hosted agents, the risk is amplified. There's no corporate security team monitoring API usage. No fraud detection layer between your agent and your bank. If the agent's credentials are compromised — through a malicious skill, a config leak, or a supply chain attack on a dependency — the blast radius is your bank account.

## The Fix

The Personal Finance Assistant blueprint enforces read-only financial access architecturally, not by policy:

1. **API scope restriction** — Only `transactions` and `balance` Plaid scopes are requested. Transfer and payment scopes are never included in the credential configuration. The agent literally cannot initiate financial actions because the token doesn't permit it.

2. **PII masking in memory** — Account numbers are stored as last-4 only in agent memory. Full numbers exist only in the encrypted credential store (`credentials.json`, mode 0600), never in conversation history or memory tiers.

3. **Aggressive memory summarization** — Financial data in hot memory is limited to 80KB with 14-day retention. Category aggregates survive to warm storage; individual transactions don't. A memory dump reveals spending patterns, not transaction details.

4. **Paranoid egress posture** — The agent can only reach `api.plaid.com`. No other outbound connections are permitted. Financial data cannot be exfiltrated to any other service, even if a malicious skill attempts it.

## What We Learned

The principle is **minimum viable access**: request only the API scopes the use case actually requires, enforce it at the credential level (not the application level), and treat financial data as toxic — summarize it quickly, mask PII aggressively, and never let it leave the machine. Most financial apps fail this test because convenience (requesting all scopes) beats security (requesting minimum scopes) when there's no architectural enforcement.

## How ClawHQ Handles This

`clawhq blueprint preview personal-finance-assistant` shows exactly which API scopes, egress domains, and memory policies will be applied. The blueprint compiles to a configuration where write-access credentials are structurally absent — not disabled by a flag, but never generated.

The `clawhq scan` command audits for any financial PII that leaked into memory or logs. `clawhq doctor` verifies that egress rules haven't drifted and that credential scopes match the blueprint specification.

**Related:**
- [Personal Finance Assistant blueprint](../../configs/blueprints/personal-finance-assistant.yaml)
- [14 Ways Your OpenClaw Agent Silently Breaks](./14-ways-your-openclaw-agent-silently-breaks.md)

---

*This article was generated from ClawHQ development work. Every bug fix, blueprint, and breaking change produces discoverable content. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the process.*
