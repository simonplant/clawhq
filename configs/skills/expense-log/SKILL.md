# expense-log

Conversational expense capture and categorization. User reports expenses in natural language;
agent parses, categorizes, logs, and surfaces anomalies. Weekly summary on Sundays.

## Behavior

1. Capture — User says "coffee $4.50" or "paid $185 storage unit" in any format.
2. Parse — Extract amount, vendor/description, date (default: today), category.
3. Categorize — Map to configured categories. Prompt if ambiguous.
4. Log — Append to `memory/expense-log.json` and human-readable `memory/expenses-YYYY-MM.md`.
5. Anomaly — If a single expense is >3x category average, flag it.
6. Weekly — Sunday 20:00: compile week's spend by category vs. budget targets.

## Boundaries

- No bank API access. User inputs manually — agent logs and analyzes.
- Never share expense data externally.
- No advice on whether to make purchases — log only, flag anomalies.

## Schedule

On-demand for capture. Weekly summary: Sunday 20:00.

## Prompts

- prompts/capture.md — Expense capture and parse confirmation
- prompts/weekly.md — Weekly expense summary

## Model Requirements

Local Ollama only. Minimum: llama3:8b. No cloud escalation.
