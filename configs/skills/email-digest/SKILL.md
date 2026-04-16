# email-digest

Periodic inbox triage skill for the Email Manager agent. Checks the inbox on a 15-minute cron schedule, categorizes new emails, summarizes important messages, and proposes response drafts — all queued for user approval before any action is taken.

## Behavior

1. Inbox check — Read all unread emails using the email tool.
2. Categorize — Classify each email into a category: urgent, action-required, informational, promotional, or spam.
3. Summarize — Generate a concise summary for urgent and action-required emails.
4. Propose responses — For emails that need a reply, draft a response in the user's voice.
5. Queue for approval — Every proposed response is added to the approval queue. Nothing is sent without explicit user consent.
6. Report — Deliver a digest summary via the messaging channel: counts by category, flagged items, and pending approvals.

## Boundaries

- No auto-send. Proposed responses always queue for approval. The agent never sends an email on its own.
- No data leaves the machine. All categorization, summarization, and drafting uses the local Ollama model. No cloud API calls.
- No account changes. This skill reads and drafts only. It does not modify mailbox state (no auto-archive, no auto-delete, no folder moves).
- No external requests. The skill does not call APIs or communicate with any external service beyond the local email server via the email tool.
- Approval required. Every proposed action that would send data externally (replies, forwards) must pass through the approval queue.

## Schedule

Runs every 15 minutes during waking hours via the work-session cron job defined in the Email Manager blueprint.

## Execution

This is a declarative skill. The cron scheduler triggers the agent with "Run skill: email-digest". The agent reads this SKILL.md for behavior definitions and loads the prompt templates from prompts/ to guide each step.

### Prompts

- prompts/categorize.md — Inbox categorization prompt template
- prompts/summarize.md — Email summarization prompt template
- prompts/propose-response.md — Response drafting prompt template

## Approval Integration

Proposed responses are enqueued with:
- Category: send_email
- Source: email-digest
- Metadata: recipient address, subject line, original message ID

The user reviews proposals via their messaging channel and approves or rejects each one.

## Model Requirements

- Provider: Local Ollama only
- Minimum model: gemma4:26b or equivalent
- No cloud escalation — categorization, summarization, and drafting all run locally
