# investor-update

Weekly investor update drafting skill for the Founder's Ops agent. Gathers key metrics, milestones, and blockers, then drafts a structured investor update email following the user's established format — queued for review and approval before sending.

## Behavior

1. Gather metrics — Read recent task completions, email threads with investors, and relevant data from the tasks tool.
2. Scan context — Use web-search to pull relevant industry news or market context that investors would find valuable.
3. Draft update — Compose a structured investor update following the standard format: highlights, metrics, challenges, asks, and next week's priorities.
4. Queue for approval — The draft is delivered via the messaging channel for user review. Nothing is sent without explicit approval.
5. Log — Record the drafted update in tasks for tracking (date, status, key metrics snapshot).

## Boundaries

- No auto-send. The investor update is always a draft. It is never sent without explicit user approval.
- No data leaves the machine during drafting. All composition uses the local Ollama model (cloud escalation configurable for higher quality writing).
- No financial data fabrication. The skill only includes metrics it can source from tools. Missing data is flagged, never invented.
- No investor contact management. The skill does not add, remove, or modify investor contact lists.
- Approval required. The complete draft must be approved before any email is sent.

## Schedule

Runs once weekly on Friday morning via cron, as configured in the Founder's Ops blueprint.

## Execution

This is a declarative skill. The cron scheduler triggers the agent with "Run skill: investor-update". The agent reads this SKILL.md for behavior definitions and loads the prompt templates from prompts/ to guide each step.

### Prompts

- prompts/gather-metrics.md — Metrics and context gathering prompt template
- prompts/draft-update.md — Investor update composition prompt template

## Approval Integration

The draft update is enqueued with:
- Category: send_email
- Source: investor-update
- Metadata: week ending date, recipient list, key metrics summary

The user reviews the draft via their messaging channel and approves, edits, or rejects it.

## Model Requirements

- Provider: Local Ollama preferred
- Minimum model: any tool-capable local model (runtime uses the deployment default)
- Cloud escalation: configurable — Founder's Ops blueprint may allow cloud for investor_updates category
